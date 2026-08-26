import { randomUUID } from "node:crypto";

import {
  makePolicyDenial,
  type CommandExecutionResult,
  type CommandFailureContract,
} from "@/domain/contracts/commands";
import {
  APPROVAL_SLA_HOURS,
  assertMovementEndpoints,
  assertPositiveStockQuantity,
  assertStockLineQuantities,
  assertStockRequestCancellable,
  assertStockRequestTransition,
  assertSubmitStockRequestInput,
  computeAvailableQuantity,
  deriveStockRequestStatus,
  isAllowedStockRequestTransition,
  isInventoryMovementType,
  movementRequiresReason,
  type AllocateStockRequestInput,
  type CancelStockRequestInput,
  type CreateStockLocationInput,
  type DispatchStockRequestInput,
  type InventoryMovementType,
  type PostManualStockMovementInput,
  type ReceiveStockRequestInput,
  type ReviewStockRequestInput,
  type StockLineQuantities,
  type StockRequestAction,
  type StockRequestExceptionInput,
  type StockRequestPriority,
  type StockRequestStatus,
  type SubmitStockRequestInput,
} from "@/domain/contracts/distribution";
import type { CrudOperation } from "@/domain/contracts/features";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { withTransaction, type QueryRunner } from "@/server/command-runtime.server";
import {
  authorizeDistribution,
  canReadStockRequest,
  isDistributionSuperAdmin,
  resolveAllowedStockRequestActions,
  resolveSubmissionAuthority,
  type AuthorizeDistributionDeps,
  type DistributionActor,
  type StockRequestAuthorityFacts,
} from "@/server/distribution-policy.server";
import {
  completeAutomatedTask,
  ensureAutomatedTask,
  ensureNotification,
  recordDistributionActivityAndOutbox,
  recordStockRequestTransition,
} from "@/server/workflow-automation.server";

/**
 * Distribution commands — product.md §24.2.
 *
 * Every stock effect in the product goes through exactly one function,
 * applyInventoryMovement() below. Nothing else in the codebase writes
 * inventory_balances, and nothing writes portal_catalog_items.stock, which
 * is a legacy global catalogue count and not an inventory ledger (§24.1).
 *
 * The movement ledger is truth; the balance table is a projection of it.
 * Both are written in the same transaction, under row locks taken in a
 * stable order, so two concurrent allocations of the last units serialise
 * into one winner and one clean refusal instead of a deadlock or an
 * oversell.
 */

export type DistributionCommandDeps = AuthorizeDistributionDeps;

export function validationFailure(message: string, field: string): CommandFailureContract {
  return {
    code: "VALIDATION_FAILED",
    message,
    fieldErrors: [{ field, message }],
    retryable: false,
  };
}

/** A 23505 inside one of these transactions can only come from an
 * idempotency-key unique index — every other inserted id is a fresh
 * randomUUID(). Treated as "a concurrent call with the same key already
 * committed", never as a real failure. */
export function isIdempotencyConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

// ---------------------------------------------------------------------------
// The movement primitive
// ---------------------------------------------------------------------------

type BalanceSigns = {
  onHand?: 1 | -1;
  reserved?: 1 | -1;
  damaged?: 1 | -1;
  inTransit?: 1 | -1;
};

/**
 * What each movement type does to each end (§24.2).
 *
 * `dispatch` reduces on-hand AND reserved at the source in one step: the
 * units leave the shelf and stop being a commitment at the same moment. The
 * matching `delivery` only touches the destination — the source was already
 * decremented at dispatch, and decrementing it again would destroy stock
 * that is merely in transit.
 *
 * `adjustment` is the only type where both ends are optional; whichever end
 * is supplied gets its delta and the other is ignored.
 */
const MOVEMENT_EFFECTS: Record<
  InventoryMovementType,
  { source: BalanceSigns; destination: BalanceSigns }
> = {
  opening_balance: { source: {}, destination: { onHand: 1 } },
  receipt: { source: {}, destination: { onHand: 1 } },
  reservation: { source: { reserved: 1 }, destination: {} },
  reservation_release: { source: { reserved: -1 }, destination: {} },
  dispatch: { source: { onHand: -1, reserved: -1 }, destination: { inTransit: 1 } },
  delivery: { source: {}, destination: { inTransit: -1, onHand: 1 } },
  transfer: { source: { onHand: -1 }, destination: { onHand: 1 } },
  damage: { source: { damaged: 1 }, destination: {} },
  adjustment: { source: { onHand: -1 }, destination: { onHand: 1 } },
};

export type BalanceSnapshot = {
  id: string;
  productSkuId: string;
  locationId: string;
  onHand: number;
  reserved: number;
  damaged: number;
  inTransit: number;
  version: number;
};

export type ApplyInventoryMovementInput = {
  movementType: InventoryMovementType;
  productSkuId: string;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  quantity: number;
  requestId?: string | null;
  requestLineId?: string | null;
  actor: DistributionActor;
  reason: string | null;
  idempotencyKey: string;
  correlationId: string;
};

export type ApplyInventoryMovementResult = {
  movementId: string;
  /** True when this exact idempotency key had already been applied. The
   * caller must treat it as success and must not apply a second effect. */
  replayed: boolean;
};

export class DistributionCommandError extends Error {
  readonly field: string;
  constructor(message: string, field = "quantity") {
    super(message);
    this.name = "DistributionCommandError";
    this.field = field;
  }
}

async function loadActiveSku(tx: QueryRunner, productSkuId: string): Promise<void> {
  const { rows } = await tx.query(
    `SELECT sku.id
     FROM product_skus sku
     JOIN product_variants variant ON variant.id = sku.product_variant_id
     JOIN products product ON product.id = variant.product_id
     WHERE sku.id = $1
       AND sku.status = 'active' AND sku.archived_at IS NULL
       AND variant.status = 'active' AND variant.archived_at IS NULL
       AND product.status = 'active' AND product.archived_at IS NULL`,
    [productSkuId],
  );
  if (!rows[0]) {
    throw new DistributionCommandError(
      "That product SKU is not available for stock movements",
      "productSkuId",
    );
  }
}

async function assertActiveLocation(tx: QueryRunner, locationId: string): Promise<void> {
  const { rows } = await tx.query(
    `SELECT id FROM stock_locations WHERE id = $1 AND active = TRUE`,
    [locationId],
  );
  if (!rows[0]) {
    throw new DistributionCommandError("That stock location is not available", "locationId");
  }
}

/**
 * Locks (or creates then locks) the balance row for one (SKU, location).
 *
 * The INSERT ... DO NOTHING before the lock is what lets a first-ever
 * movement into a location work without a separate "initialise balance"
 * step, and it is safe under concurrency because the SELECT ... FOR UPDATE
 * that follows is what actually serialises the two callers.
 */
async function lockBalance(
  tx: QueryRunner,
  productSkuId: string,
  locationId: string,
): Promise<BalanceSnapshot> {
  await tx.query(
    `INSERT INTO inventory_balances (product_sku_id, location_id)
     VALUES ($1, $2)
     ON CONFLICT (product_sku_id, location_id) DO NOTHING`,
    [productSkuId, locationId],
  );

  const { rows } = await tx.query(
    `SELECT id, product_sku_id, location_id, on_hand_quantity, reserved_quantity,
            damaged_quantity, in_transit_quantity, version
     FROM inventory_balances
     WHERE product_sku_id = $1 AND location_id = $2
     FOR UPDATE`,
    [productSkuId, locationId],
  );

  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw new DistributionCommandError("Stock balance could not be locked", "locationId");
  }
  return {
    id: String(row.id),
    productSkuId: String(row.product_sku_id),
    locationId: String(row.location_id),
    onHand: Number(row.on_hand_quantity ?? 0),
    reserved: Number(row.reserved_quantity ?? 0),
    damaged: Number(row.damaged_quantity ?? 0),
    inTransit: Number(row.in_transit_quantity ?? 0),
    version: Number(row.version ?? 1),
  };
}

function applySigns(
  balance: BalanceSnapshot,
  signs: BalanceSigns,
  quantity: number,
): BalanceSnapshot {
  return {
    ...balance,
    onHand: balance.onHand + (signs.onHand ?? 0) * quantity,
    reserved: balance.reserved + (signs.reserved ?? 0) * quantity,
    damaged: balance.damaged + (signs.damaged ?? 0) * quantity,
    inTransit: balance.inTransit + (signs.inTransit ?? 0) * quantity,
  };
}

/**
 * Refuses an impossible result with a sentence an operator can act on.
 *
 * The database carries the same non-negative and reserved+damaged<=on_hand
 * constraints, so this is not the only guard — but a constraint violation
 * surfaces as a 23514 with a constraint name, and "Not enough available
 * stock at the source location" is what the person allocating actually
 * needs to read.
 */
function assertBalanceIsPossible(next: BalanceSnapshot, side: "source" | "destination"): void {
  const where = side === "source" ? "source" : "destination";
  if (next.onHand < 0) {
    throw new DistributionCommandError(`Not enough on-hand stock at the ${where} location`);
  }
  if (next.reserved < 0) {
    throw new DistributionCommandError(`Not enough reserved stock at the ${where} location`);
  }
  if (next.damaged < 0) {
    throw new DistributionCommandError(`Not enough damaged stock at the ${where} location`);
  }
  if (next.inTransit < 0) {
    throw new DistributionCommandError(`Not enough in-transit stock at the ${where} location`);
  }
  if (next.reserved + next.damaged > next.onHand) {
    throw new DistributionCommandError(`Not enough available stock at the ${where} location`);
  }
}

async function writeBalance(tx: QueryRunner, next: BalanceSnapshot): Promise<void> {
  const updated = await tx.query(
    `UPDATE inventory_balances
     SET on_hand_quantity = $2, reserved_quantity = $3, damaged_quantity = $4,
         in_transit_quantity = $5, version = $6, updated_at = now()
     WHERE id = $1 AND version = $7`,
    [
      next.id,
      next.onHand,
      next.reserved,
      next.damaged,
      next.inTransit,
      next.version + 1,
      next.version,
    ],
  );
  if (!updated.rowCount) {
    // Unreachable while the row lock above is held; if it ever fires, the
    // lock was not taken and the safe outcome is to abort rather than
    // overwrite whatever the other writer stored.
    throw new DistributionCommandError("Stock balance changed concurrently", "quantity");
  }
}

/**
 * The single primitive every stock effect in the product goes through.
 *
 * Runs inside the caller's transaction, never its own. The order matters:
 * balance rows are locked FIRST — in a stable location-id order so two
 * transactions touching the same pair never deadlock — and the idempotency
 * check happens after, so a replayed key is serialised behind the original
 * rather than racing it.
 */
export async function applyInventoryMovement(
  tx: QueryRunner,
  input: ApplyInventoryMovementInput,
): Promise<ApplyInventoryMovementResult> {
  if (!isInventoryMovementType(input.movementType)) {
    throw new DistributionCommandError("Unknown stock movement type", "movementType");
  }
  assertPositiveStockQuantity(input.quantity);
  assertMovementEndpoints(input.movementType, {
    sourceLocationId: input.sourceLocationId,
    destinationLocationId: input.destinationLocationId,
  });

  const reason = input.reason?.trim() || null;
  if (movementRequiresReason(input.movementType) && !reason) {
    throw new DistributionCommandError("A reason is required for this stock correction", "reason");
  }
  if (!input.idempotencyKey?.trim()) {
    throw new DistributionCommandError("A movement key is required", "idempotencyKey");
  }

  await loadActiveSku(tx, input.productSkuId);
  for (const locationId of [input.sourceLocationId, input.destinationLocationId]) {
    if (locationId) await assertActiveLocation(tx, locationId);
  }

  // Stable lock order: sorted by location id, so a transfer A→B and a
  // concurrent transfer B→A take the two locks in the same sequence and one
  // simply waits instead of both deadlocking.
  const endpoints = [input.sourceLocationId, input.destinationLocationId]
    .filter((value): value is string => Boolean(value))
    .sort();

  const locked = new Map<string, BalanceSnapshot>();
  for (const locationId of endpoints) {
    locked.set(locationId, await lockBalance(tx, input.productSkuId, locationId));
  }

  const existing = await tx.query(`SELECT id FROM inventory_movements WHERE idempotency_key = $1`, [
    input.idempotencyKey,
  ]);
  const existingRow = existing.rows[0] as { id?: string } | undefined;
  if (existingRow?.id) {
    return { movementId: existingRow.id, replayed: true };
  }

  const effect = MOVEMENT_EFFECTS[input.movementType];
  const sourceBefore = input.sourceLocationId ? locked.get(input.sourceLocationId)! : null;
  const destinationBefore = input.destinationLocationId
    ? locked.get(input.destinationLocationId)!
    : null;

  let sourceAfter: BalanceSnapshot | null = null;
  let destinationAfter: BalanceSnapshot | null = null;

  if (sourceBefore) {
    sourceAfter = applySigns(sourceBefore, effect.source, input.quantity);
    assertBalanceIsPossible(sourceAfter, "source");
  }
  if (destinationBefore) {
    destinationAfter = applySigns(destinationBefore, effect.destination, input.quantity);
    assertBalanceIsPossible(destinationAfter, "destination");
  }

  if (sourceAfter) await writeBalance(tx, sourceAfter);
  if (destinationAfter) await writeBalance(tx, destinationAfter);

  const movementId = randomUUID();
  await tx.query(
    `INSERT INTO inventory_movements (
       id, movement_type, product_sku_id, source_location_id, destination_location_id,
       quantity, request_id, request_line_id, actor_user_id, assignment_id, reason,
       correlation_id, idempotency_key,
       source_on_hand_before, source_on_hand_after,
       source_reserved_before, source_reserved_after,
       source_damaged_before, source_damaged_after,
       destination_on_hand_before, destination_on_hand_after,
       destination_in_transit_before, destination_in_transit_after
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
       $14,$15,$16,$17,$18,$19,$20,$21,$22,$23
     )`,
    [
      movementId,
      input.movementType,
      input.productSkuId,
      input.sourceLocationId,
      input.destinationLocationId,
      input.quantity,
      input.requestId ?? null,
      input.requestLineId ?? null,
      input.actor.userId,
      input.actor.assignment.assignmentId,
      reason,
      input.correlationId,
      input.idempotencyKey,
      sourceBefore?.onHand ?? null,
      sourceAfter?.onHand ?? null,
      sourceBefore?.reserved ?? null,
      sourceAfter?.reserved ?? null,
      sourceBefore?.damaged ?? null,
      sourceAfter?.damaged ?? null,
      destinationBefore?.onHand ?? null,
      destinationAfter?.onHand ?? null,
      destinationBefore?.inTransit ?? null,
      destinationAfter?.inTransit ?? null,
    ],
  );

  await recordDistributionActivityAndOutbox(tx, {
    actor: input.actor,
    correlationId: input.correlationId,
    eventName: `inventory.${input.movementType}`,
    subjectId: movementId,
    subjectType: "inventory_movement",
    idempotencyKey: input.idempotencyKey,
    payload: {
      movementType: input.movementType,
      productSkuId: input.productSkuId,
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
      quantity: input.quantity,
      requestId: input.requestId ?? null,
      requestLineId: input.requestLineId ?? null,
      reason,
    },
  });

  return { movementId, replayed: false };
}

/** Available stock at one (SKU, location), for callers deciding how much
 * they can reserve. Reads the locked snapshot rather than re-querying, so it
 * cannot disagree with what the movement is about to write. */
export function availableAt(balance: BalanceSnapshot): number {
  return computeAvailableQuantity({
    onHand: balance.onHand,
    reserved: balance.reserved,
    damaged: balance.damaged,
  });
}

export async function readBalance(
  tx: QueryRunner,
  productSkuId: string,
  locationId: string,
): Promise<BalanceSnapshot> {
  return lockBalance(tx, productSkuId, locationId);
}

// ---------------------------------------------------------------------------
// Locations (Super Admin)
// ---------------------------------------------------------------------------

function superAdminOnly(actor: DistributionActor, correlationId: string) {
  if (!isDistributionSuperAdmin(actor)) {
    return {
      ok: false as const,
      failure: makePolicyDenial(null, "Only Super Admin can administer stock locations"),
      correlationId,
    };
  }
  return null;
}

function commandError(error: unknown, correlationId: string): CommandExecutionResult | null {
  if (error instanceof DistributionCommandError) {
    return { ok: false, failure: validationFailure(error.message, error.field), correlationId };
  }
  // The pure contract validators throw plain Errors with the same
  // operator-readable sentences; surfacing them as validation failures keeps
  // "Received quantity cannot exceed dispatched quantity" in front of the
  // person who typed the number instead of turning it into a 500.
  if (error instanceof Error && /quantity|movement|location|line|request/i.test(error.message)) {
    return { ok: false, failure: validationFailure(error.message, "quantity"), correlationId };
  }
  return null;
}

export async function createStockLocation(input: {
  actor: DistributionActor;
  data: CreateStockLocationInput;
  deps?: DistributionCommandDeps;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const denied = superAdminOnly(input.actor, correlationId);
  if (denied) return denied;

  const authorized = await authorizeDistribution(input.actor, "create", input.deps ?? {});
  if (!authorized.ok) return { ok: false, failure: authorized.failure, correlationId };

  const locationCode = input.data.locationCode?.trim();
  const locationName = input.data.locationName?.trim();
  if (!locationCode || !locationName) {
    return {
      ok: false,
      failure: validationFailure("A location code and name are required", "locationCode"),
      correlationId,
    };
  }
  if (input.data.locationType !== "livey_warehouse" && input.data.locationType !== "distributor") {
    return {
      ok: false,
      failure: validationFailure("A valid location type is required", "locationType"),
      correlationId,
    };
  }
  // The database enforces the same rule; refusing here keeps the message
  // specific instead of surfacing a CHECK constraint name.
  const distributorAssignmentId = input.data.distributorAssignmentId?.trim() || null;
  if ((input.data.locationType === "distributor") !== Boolean(distributorAssignmentId)) {
    return {
      ok: false,
      failure: validationFailure(
        "A distributor location needs exactly one owning Distributor assignment, and a warehouse needs none",
        "distributorAssignmentId",
      ),
      correlationId,
    };
  }

  try {
    return await withTransaction<CommandExecutionResult>(async (tx) => {
      const locationId = randomUUID();
      await tx.query(
        `INSERT INTO stock_locations (
           id, location_code, location_name, location_type, tenant_id,
           organization_tenant_id, geography_node_id, distributor_assignment_id,
           custodian_assignment_id, active, version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,1)`,
        [
          locationId,
          locationCode,
          locationName,
          input.data.locationType,
          input.actor.assignment.tenantId,
          input.actor.assignment.organizationTenantId,
          input.data.geographyNodeId,
          distributorAssignmentId,
          input.data.custodianAssignmentId?.trim() || null,
        ],
      );

      await recordDistributionActivityAndOutbox(tx, {
        actor: input.actor,
        correlationId,
        eventName: "stock_location.created",
        subjectId: locationId,
        subjectType: "stock_location",
        payload: {
          locationCode,
          locationName,
          locationType: input.data.locationType,
          distributorAssignmentId,
        },
      });

      return {
        ok: true,
        commandName: "distribution.location.create",
        subjectId: locationId,
        newVersion: 1,
        nextAuthorisedActions: ["distribution.movement.post"],
        correlationId,
      };
    });
  } catch (error) {
    if (isIdempotencyConflict(error)) {
      return {
        ok: false,
        failure: validationFailure("That location code is already in use", "locationCode"),
        correlationId,
      };
    }
    const mapped = commandError(error, correlationId);
    if (mapped) return mapped;
    throw error;
  }
}

export async function retireStockLocation(input: {
  actor: DistributionActor;
  locationId: string;
  expectedVersion: number;
  reason: string;
  deps?: DistributionCommandDeps;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const denied = superAdminOnly(input.actor, correlationId);
  if (denied) return denied;

  const authorized = await authorizeDistribution(input.actor, "update", input.deps ?? {});
  if (!authorized.ok) return { ok: false, failure: authorized.failure, correlationId };

  const reason = input.reason?.trim();
  if (!reason) {
    return {
      ok: false,
      failure: validationFailure("A reason is required to retire a location", "reason"),
      correlationId,
    };
  }

  return withTransaction<CommandExecutionResult>(async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, version, active FROM stock_locations WHERE id = $1 FOR UPDATE`,
      [input.locationId],
    );
    const row = rows[0] as { id: string; version: number; active: boolean } | undefined;
    if (!row) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Stock location is not accessible"),
        correlationId,
      };
    }
    if (Number(row.version) !== input.expectedVersion) {
      const { makeConcurrencyError } = await import("@/domain/contracts/commands");
      return {
        ok: false,
        failure: makeConcurrencyError(row.id, input.expectedVersion, Number(row.version)),
        correlationId,
      };
    }

    // Retiring is deactivation, never deletion: the location is named by
    // every movement that ever passed through it, and §24.2 keeps that
    // history intact.
    const newVersion = Number(row.version) + 1;
    await tx.query(
      `UPDATE stock_locations SET active = FALSE, version = $2, updated_at = now()
       WHERE id = $1 AND version = $3`,
      [row.id, newVersion, row.version],
    );

    await recordDistributionActivityAndOutbox(tx, {
      actor: input.actor,
      correlationId,
      eventName: "stock_location.retired",
      subjectId: row.id,
      subjectType: "stock_location",
      payload: { reason },
    });

    return {
      ok: true,
      commandName: "distribution.location.retire",
      subjectId: row.id,
      newVersion,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

// ---------------------------------------------------------------------------
// Manual movements (Super Admin)
// ---------------------------------------------------------------------------

/** Movement types an operator may post by hand. The request-driven types —
 * reservation, dispatch, delivery, and reservation_release — are excluded on
 * purpose: they belong to a request line's quantity ladder, and posting one
 * by hand would move stock without moving the request that promised it. */
const MANUAL_MOVEMENT_TYPES = new Set<InventoryMovementType>([
  "opening_balance",
  "receipt",
  "transfer",
  "damage",
  "adjustment",
]);

export async function postManualStockMovement(input: {
  actor: DistributionActor;
  data: PostManualStockMovementInput;
  deps?: DistributionCommandDeps;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const denied = superAdminOnly(input.actor, correlationId);
  if (denied) {
    return {
      ...denied,
      failure: makePolicyDenial(null, "Only Super Admin can post a manual stock movement"),
    };
  }

  const authorized = await authorizeDistribution(input.actor, "update", input.deps ?? {});
  if (!authorized.ok) return { ok: false, failure: authorized.failure, correlationId };

  if (!MANUAL_MOVEMENT_TYPES.has(input.data.movementType)) {
    return {
      ok: false,
      failure: validationFailure(
        "That movement type belongs to a stock request and cannot be posted by hand",
        "movementType",
      ),
      correlationId,
    };
  }
  if (!input.data.reason?.trim()) {
    return {
      ok: false,
      failure: validationFailure("A reason is required for every stock correction", "reason"),
      correlationId,
    };
  }

  try {
    return await withTransaction<CommandExecutionResult>(async (tx) => {
      const result = await applyInventoryMovement(tx, {
        movementType: input.data.movementType,
        productSkuId: input.data.productSkuId,
        sourceLocationId: input.data.sourceLocationId ?? null,
        destinationLocationId: input.data.destinationLocationId ?? null,
        quantity: input.data.quantity,
        actor: input.actor,
        reason: input.data.reason,
        idempotencyKey: input.data.idempotencyKey,
        correlationId,
      });

      return {
        ok: true,
        commandName: "distribution.movement.post",
        subjectId: result.movementId,
        newVersion: 1,
        nextAuthorisedActions: [],
        correlationId,
      };
    });
  } catch (error) {
    const mapped = commandError(error, correlationId);
    if (mapped) return mapped;
    if (isIdempotencyConflict(error)) {
      // Another caller committed the same key first; the effect is already
      // applied exactly once, which is what the key promised.
      return {
        ok: true,
        commandName: "distribution.movement.post",
        subjectId: input.data.idempotencyKey,
        newVersion: 1,
        nextAuthorisedActions: [],
        correlationId,
      };
    }
    throw error;
  }
}

// ===========================================================================
// Stock request workflow — product.md §24.3, §24.5
// ===========================================================================

export const STOCK_REQUEST_AUTOMATION_SOURCE = "stock_request";
export const STOCK_REQUEST_TEMPLATE_VERSION = 1;

export function approvalTaskKey(requestId: string, managerAssignmentId: string): string {
  return `stock-request:${requestId}:manager-approval:${managerAssignmentId}`;
}
export function fulfilmentTaskKey(requestId: string, custodianAssignmentId: string): string {
  return `stock-request:${requestId}:fulfilment:${custodianAssignmentId}`;
}
export function confirmReceiptTaskKey(requestId: string, requesterUserId: string): string {
  return `stock-request:${requestId}:confirm-receipt:${requesterUserId}`;
}
export function escalationTaskKey(requestId: string, escalationAssignmentId: string): string {
  return `stock-request:${requestId}:approval-escalation:${escalationAssignmentId}`;
}

/** Deep link into the workspace. Every generated Notification carries one,
 * so "you have a stock request to approve" is one click from the request
 * rather than a hunt through a table. */
export function stockRequestUrl(requestId: string): string {
  return `/distribution?tab=requests&requestId=${requestId}`;
}

type RequestLineSnapshot = {
  id: string;
  productSkuId: string;
  skuCode: string;
  sourceLocationId: string | null;
  sourceCustodianAssignmentId: string | null;
  requested: number;
  approved: number;
  reserved: number;
  dispatched: number;
  received: number;
};

type RequestSnapshot = {
  id: string;
  humanId: string;
  status: StockRequestStatus;
  priority: StockRequestPriority;
  version: number;
  reason: string;
  requesterUserId: string;
  distributorAssignmentId: string;
  managerAssignmentId: string;
  destinationLocationId: string;
  destinationCustodianAssignmentId: string | null;
  dealId: string | null;
  customerId: string | null;
  exceptionFromStatus: StockRequestStatus | null;
  partnerId: string | null;
  lines: RequestLineSnapshot[];
};

function lineQuantities(line: RequestLineSnapshot): StockLineQuantities {
  return {
    requested: line.requested,
    approved: line.approved,
    reserved: line.reserved,
    dispatched: line.dispatched,
    received: line.received,
  };
}

async function loadRequestForUpdate(
  tx: QueryRunner,
  requestId: string,
): Promise<RequestSnapshot | null> {
  const { rows } = await tx.query(
    `SELECT r.id, r.human_id, r.status, r.priority, r.version, r.reason,
            r.requester_user_id, r.distributor_assignment_id, r.manager_assignment_id,
            r.destination_location_id, r.deal_id, r.customer_id, r.exception_from_status,
            dest.custodian_assignment_id AS destination_custodian_assignment_id,
            distributor.partner_id AS partner_id
     FROM stock_requests r
     JOIN stock_locations dest ON dest.id = r.destination_location_id
     LEFT JOIN assignments distributor
            ON distributor.assignment_id = r.distributor_assignment_id
     WHERE r.id = $1
     FOR UPDATE OF r`,
    [requestId],
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const lineResult = await tx.query(
    `SELECT l.id, l.product_sku_id, sku.sku_code, l.source_location_id,
            src.custodian_assignment_id AS source_custodian_assignment_id,
            l.requested_quantity, l.approved_quantity, l.reserved_quantity,
            l.dispatched_quantity, l.received_quantity
     FROM stock_request_lines l
     JOIN product_skus sku ON sku.id = l.product_sku_id
     LEFT JOIN stock_locations src ON src.id = l.source_location_id
     WHERE l.request_id = $1
     ORDER BY sku.sku_code ASC`,
    [requestId],
  );

  return {
    id: String(row.id),
    humanId: String(row.human_id),
    status: String(row.status) as StockRequestStatus,
    priority: String(row.priority) as StockRequestPriority,
    version: Number(row.version),
    reason: String(row.reason ?? ""),
    requesterUserId: String(row.requester_user_id),
    distributorAssignmentId: String(row.distributor_assignment_id),
    managerAssignmentId: String(row.manager_assignment_id),
    destinationLocationId: String(row.destination_location_id),
    destinationCustodianAssignmentId:
      row.destination_custodian_assignment_id == null
        ? null
        : String(row.destination_custodian_assignment_id),
    dealId: row.deal_id == null ? null : String(row.deal_id),
    customerId: row.customer_id == null ? null : String(row.customer_id),
    exceptionFromStatus:
      row.exception_from_status == null
        ? null
        : (String(row.exception_from_status) as StockRequestStatus),
    partnerId: row.partner_id == null ? null : String(row.partner_id),
    lines: (lineResult.rows as Array<Record<string, unknown>>).map((line) => ({
      id: String(line.id),
      productSkuId: String(line.product_sku_id),
      skuCode: String(line.sku_code ?? ""),
      sourceLocationId: line.source_location_id == null ? null : String(line.source_location_id),
      sourceCustodianAssignmentId:
        line.source_custodian_assignment_id == null
          ? null
          : String(line.source_custodian_assignment_id),
      requested: Number(line.requested_quantity ?? 0),
      approved: Number(line.approved_quantity ?? 0),
      reserved: Number(line.reserved_quantity ?? 0),
      dispatched: Number(line.dispatched_quantity ?? 0),
      received: Number(line.received_quantity ?? 0),
    })),
  };
}

function authorityFactsFor(request: RequestSnapshot): StockRequestAuthorityFacts {
  const custodians = new Set<string>();
  if (request.destinationCustodianAssignmentId) {
    custodians.add(request.destinationCustodianAssignmentId);
  }
  for (const line of request.lines) {
    if (line.sourceCustodianAssignmentId) custodians.add(line.sourceCustodianAssignmentId);
  }
  return {
    requesterUserId: request.requesterUserId,
    distributorAssignmentId: request.distributorAssignmentId,
    managerAssignmentId: request.managerAssignmentId,
    destinationLocationId: request.destinationLocationId,
    custodianAssignmentIds: [...custodians],
  };
}

async function resolveAssignmentUserId(
  tx: QueryRunner,
  assignmentId: string | null,
): Promise<string | null> {
  if (!assignmentId) return null;
  const { rows } = await tx.query(
    `SELECT user_id FROM assignments WHERE assignment_id = $1 AND status = 'active'`,
    [assignmentId],
  );
  const row = rows[0] as { user_id?: unknown } | undefined;
  return row?.user_id ? String(row.user_id) : null;
}

/** Custodian Assignment ids actually named on this request's approved
 * lines, plus the destination's own custodian. Deduplicated, because one
 * person holding two source locations should get one fulfilment Task. */
function custodianAssignmentIds(request: RequestSnapshot): string[] {
  const ids = new Set<string>();
  for (const line of request.lines) {
    if (line.approved > 0 && line.sourceCustodianAssignmentId) {
      ids.add(line.sourceCustodianAssignmentId);
    }
  }
  return [...ids];
}

type StatusChange = {
  from: StockRequestStatus;
  to: StockRequestStatus;
  newVersion: number;
};

/**
 * Writes the request's new status, version, and evidence.
 *
 * The status is derived from the line quantities wherever a derivation
 * exists (§24.3.3) — no caller passes a status through from the client, so
 * the header and the lines cannot disagree. A no-op transition (derived
 * status unchanged) still bumps the version and records nothing, because
 * "allocated three more units" is a quantity event, not a state change.
 */
async function writeRequestStatus(
  tx: QueryRunner,
  input: {
    request: RequestSnapshot;
    nextStatus: StockRequestStatus;
    actor: DistributionActor;
    commandName: string;
    reason: string | null;
    correlationId: string;
    decisionReason?: string | null;
    exceptionReason?: string | null;
    exceptionFromStatus?: StockRequestStatus | null;
  },
): Promise<StatusChange> {
  const { request, nextStatus } = input;
  if (nextStatus !== request.status) {
    assertStockRequestTransition(request.status, nextStatus);
  }

  const newVersion = request.version + 1;
  const updated = await tx.query(
    `UPDATE stock_requests
     SET status = $2,
         version = $3,
         decision_reason = COALESCE($4, decision_reason),
         exception_reason = $5,
         exception_from_status = $6,
         updated_at = now()
     WHERE id = $1 AND version = $7`,
    [
      request.id,
      nextStatus,
      newVersion,
      input.decisionReason ?? null,
      input.exceptionReason ?? null,
      input.exceptionFromStatus ?? null,
      request.version,
    ],
  );
  if (!updated.rowCount) {
    throw new DistributionCommandError("Stock request changed concurrently", "version");
  }

  if (nextStatus !== request.status) {
    await recordStockRequestTransition(tx, {
      requestId: request.id,
      commandName: input.commandName,
      fromStatus: request.status,
      toStatus: nextStatus,
      actor: input.actor,
      reason: input.reason,
      correlationId: input.correlationId,
    });
  }

  return { from: request.status, to: nextStatus, newVersion };
}

async function writeLineQuantities(
  tx: QueryRunner,
  lineId: string,
  quantities: StockLineQuantities,
  sourceLocationId?: string | null,
): Promise<void> {
  assertStockLineQuantities(quantities);
  await tx.query(
    `UPDATE stock_request_lines
     SET approved_quantity = $2,
         reserved_quantity = $3,
         dispatched_quantity = $4,
         received_quantity = $5,
         source_location_id = COALESCE($6, source_location_id),
         updated_at = now()
     WHERE id = $1`,
    [
      lineId,
      quantities.approved,
      quantities.reserved,
      quantities.dispatched,
      quantities.received,
      sourceLocationId ?? null,
    ],
  );
}

// --- Notification fan-out ---------------------------------------------------

type NotificationRecipient = {
  userId: string | null;
  partnerId: string | null;
};

/**
 * Sends one Notification per distinct recipient for one event.
 *
 * The event key is scoped per recipient, so all three of requester, manager,
 * and custodian receive a shortage notice — a globally-unique key would have
 * delivered it to whichever row happened to be inserted first and silently
 * dropped the other two.
 */
async function notifyRequestEvent(
  tx: QueryRunner,
  input: {
    request: RequestSnapshot;
    event: string;
    title: string;
    message: string;
    recipients: NotificationRecipient[];
  },
): Promise<void> {
  const seen = new Set<string>();
  for (const recipient of input.recipients) {
    if (!recipient.userId || seen.has(recipient.userId)) continue;
    seen.add(recipient.userId);
    await ensureNotification(tx, {
      userId: recipient.userId,
      partnerId: recipient.partnerId,
      title: input.title,
      message: input.message,
      type: "stock_request",
      subjectType: "stock_request",
      subjectId: input.request.id,
      actionUrl: stockRequestUrl(input.request.id),
      eventKey: `stock-request:${input.request.id}:${input.event}`,
    });
  }
}

type RequestParticipants = {
  requesterUserId: string;
  managerUserId: string | null;
  custodianUserIds: Map<string, string>;
  partnerId: string | null;
};

async function loadRequestParticipants(
  tx: QueryRunner,
  request: RequestSnapshot,
): Promise<RequestParticipants> {
  const custodianUserIds = new Map<string, string>();
  for (const assignmentId of authorityFactsFor(request).custodianAssignmentIds) {
    const userId = await resolveAssignmentUserId(tx, assignmentId);
    if (userId) custodianUserIds.set(assignmentId, userId);
  }
  return {
    requesterUserId: request.requesterUserId,
    managerUserId: await resolveAssignmentUserId(tx, request.managerAssignmentId),
    custodianUserIds,
    partnerId: request.partnerId,
  };
}

function custodianRecipients(participants: RequestParticipants): NotificationRecipient[] {
  return [...participants.custodianUserIds.values()].map((userId) => ({
    userId,
    // Custodians are LIVEY-internal; a partner id on their Notification
    // would scope it to a Partner they do not belong to.
    partnerId: null,
  }));
}

function approvalDueAt(priority: StockRequestPriority, now: Date): string {
  const hours = APPROVAL_SLA_HOURS[priority] ?? APPROVAL_SLA_HOURS.medium;
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

async function replayStockRequest(
  tx: QueryRunner,
  idempotencyKey: string,
  requesterUserId: string,
  correlationId: string,
): Promise<CommandExecutionResult | null> {
  const { rows } = await tx.query(
    `SELECT id, version, requester_user_id FROM stock_requests WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  const row = rows[0] as { id: string; version: number; requester_user_id: string } | undefined;
  if (!row) return null;
  if (String(row.requester_user_id) !== requesterUserId) {
    return {
      ok: false,
      failure: makePolicyDenial(null, "This request key was already used by a different actor"),
      correlationId,
    };
  }
  return {
    ok: true,
    commandName: "distribution.request.submit",
    subjectId: String(row.id),
    newVersion: Number(row.version),
    nextAuthorisedActions: ["distribution.request.review"],
    correlationId,
  };
}

export async function submitStockRequest(input: {
  actor: DistributionActor;
  data: SubmitStockRequestInput;
  deps?: DistributionCommandDeps;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();

  const authorized = await authorizeDistribution(input.actor, "create", input.deps ?? {});
  if (!authorized.ok) return { ok: false, failure: authorized.failure, correlationId };

  try {
    assertSubmitStockRequestInput(input.data);
  } catch (error) {
    // The pure validator only ever throws shape complaints, and every one of
    // them names something the person filling in the form can fix — so they
    // are all validation failures, never a 500.
    return {
      ok: false,
      failure: validationFailure(
        error instanceof Error ? error.message : "That stock request is not valid",
        "lines",
      ),
      correlationId,
    };
  }

  const now = new Date();

  const run = () =>
    withTransaction<CommandExecutionResult>(async (tx) => {
      const replay = await replayStockRequest(
        tx,
        input.data.idempotencyKey,
        input.actor.userId,
        correlationId,
      );
      if (replay) return replay;

      const authority = await resolveSubmissionAuthority(tx, input.actor);
      if (!authority.ok) return { ok: false, failure: authority.failure, correlationId };

      const destination = await tx.query(
        `SELECT id, location_name FROM stock_locations
         WHERE id = $1 AND active = TRUE AND distributor_assignment_id = $2`,
        [input.data.destinationLocationId, authority.authority.distributorAssignmentId],
      );
      if (!destination.rows[0]) {
        // Same denial whether the location does not exist or belongs to a
        // different Distributor — this must not be an existence oracle for
        // somebody else's warehouse.
        return {
          ok: false,
          failure: makePolicyDenial(null, "That destination location is not accessible"),
          correlationId,
        };
      }

      for (const line of input.data.lines) {
        await loadActiveSku(tx, line.productSkuId);
      }

      const requestId = randomUUID();
      const inserted = await tx.query(
        `INSERT INTO stock_requests (
           id, distributor_assignment_id, requester_user_id, manager_assignment_id,
           destination_location_id, deal_id, customer_id, status, priority,
           required_by, reason, version, idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'submitted',$8,$9,$10,1,$11)
         RETURNING human_id`,
        [
          requestId,
          authority.authority.distributorAssignmentId,
          input.actor.userId,
          authority.authority.managerAssignmentId,
          input.data.destinationLocationId,
          input.data.dealId ?? null,
          input.data.customerId ?? null,
          input.data.priority,
          input.data.requiredBy,
          input.data.reason.trim(),
          input.data.idempotencyKey,
        ],
      );
      const humanId = String(
        (inserted.rows[0] as { human_id?: unknown } | undefined)?.human_id ?? requestId,
      );

      for (const line of input.data.lines) {
        await tx.query(
          `INSERT INTO stock_request_lines (request_id, product_sku_id, requested_quantity)
           VALUES ($1,$2,$3)`,
          [requestId, line.productSkuId, line.quantity],
        );
      }

      await recordStockRequestTransition(tx, {
        requestId,
        commandName: "distribution.request.submit",
        fromStatus: "(created)",
        toStatus: "submitted",
        actor: input.actor,
        reason: input.data.reason.trim(),
        correlationId,
      });

      await recordDistributionActivityAndOutbox(tx, {
        actor: input.actor,
        correlationId,
        eventName: "stock_request.submitted",
        subjectId: requestId,
        idempotencyKey: input.data.idempotencyKey,
        payload: {
          humanId,
          destinationLocationId: input.data.destinationLocationId,
          managerAssignmentId: authority.authority.managerAssignmentId,
          lineCount: input.data.lines.length,
          dealId: input.data.dealId ?? null,
          customerId: input.data.customerId ?? null,
        },
      });

      const managerUserId = await resolveAssignmentUserId(
        tx,
        authority.authority.managerAssignmentId,
      );

      await ensureAutomatedTask(tx, {
        automationKey: approvalTaskKey(requestId, authority.authority.managerAssignmentId),
        automationSource: STOCK_REQUEST_AUTOMATION_SOURCE,
        templateVersion: STOCK_REQUEST_TEMPLATE_VERSION,
        assigneeId: managerUserId,
        creatorId: input.actor.userId,
        relatedType: "stock_request",
        relatedId: requestId,
        title: `Review stock request ${humanId}`,
        description: "Review requested quantities and select source locations.",
        priority: input.data.priority === "urgent" ? "urgent" : "high",
        dueAt: approvalDueAt(input.data.priority, now),
        partnerId: null,
      });

      await notifyRequestEvent(tx, {
        request: {
          id: requestId,
          humanId,
        } as RequestSnapshot,
        event: "submitted",
        title: `Stock request ${humanId} needs your approval`,
        message: `${input.data.lines.length} line(s) requested, needed by ${input.data.requiredBy}.`,
        recipients: [{ userId: managerUserId, partnerId: null }],
      });

      return {
        ok: true,
        commandName: "distribution.request.submit",
        subjectId: requestId,
        newVersion: 1,
        nextAuthorisedActions: ["distribution.request.review"],
        correlationId,
      };
    });

  try {
    return await run();
  } catch (error) {
    if (isIdempotencyConflict(error)) {
      // A concurrent caller committed the same key first; return its result
      // rather than reporting a failure for work that did happen.
      const replayed = await withTransaction((tx) =>
        replayStockRequest(tx, input.data.idempotencyKey, input.actor.userId, correlationId),
      );
      if (replayed) return replayed;
    }
    const mapped = commandError(error, correlationId);
    if (mapped) return mapped;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Shared command shell
// ---------------------------------------------------------------------------

type RequestCommandContext = {
  tx: QueryRunner;
  request: RequestSnapshot;
  participants: RequestParticipants;
  actor: DistributionActor;
  correlationId: string;
};

type RequestCommandHandler = (context: RequestCommandContext) => Promise<CommandExecutionResult>;

/**
 * Loads, locks, version-checks, and authorises one request, then runs the
 * command body.
 *
 * Every request command shares this shell so the four things that must never
 * be skipped — the row lock, the optimistic version check, the "can this
 * actor act on THIS record" check, and the not-accessible denial that does
 * not distinguish a missing id from someone else's — happen in exactly one
 * place.
 */
async function withStockRequest(
  input: {
    actor: DistributionActor;
    requestId: string;
    expectedVersion: number;
    operation: CrudOperation;
    requiredAction: StockRequestAction;
    deps?: DistributionCommandDeps;
  },
  handler: RequestCommandHandler,
): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();

  const authorized = await authorizeDistribution(input.actor, input.operation, input.deps ?? {});
  if (!authorized.ok) return { ok: false, failure: authorized.failure, correlationId };

  try {
    return await withTransaction<CommandExecutionResult>(async (tx) => {
      const request = await loadRequestForUpdate(tx, input.requestId);
      if (!request || !canReadStockRequest(input.actor, authorityFactsFor(request))) {
        return {
          ok: false,
          failure: makePolicyDenial(null, "Stock request is not accessible"),
          correlationId,
        };
      }

      if (request.version !== input.expectedVersion) {
        const { makeConcurrencyError } = await import("@/domain/contracts/commands");
        return {
          ok: false,
          failure: makeConcurrencyError(request.id, input.expectedVersion, request.version),
          correlationId,
        };
      }

      const allowed = resolveAllowedStockRequestActions(input.actor, {
        ...authorityFactsFor(request),
        status: request.status,
        lines: request.lines.map(lineQuantities),
      });
      if (!allowed.includes(input.requiredAction)) {
        return {
          ok: false,
          failure: makePolicyDenial(
            request.id,
            `This actor cannot ${input.requiredAction.replace("_", " ")} this stock request`,
          ),
          correlationId,
        };
      }

      const participants = await loadRequestParticipants(tx, request);
      return handler({ tx, request, participants, actor: input.actor, correlationId });
    });
  } catch (error) {
    const mapped = commandError(error, correlationId);
    if (mapped) return mapped;
    if (isIdempotencyConflict(error)) {
      return {
        ok: false,
        failure: validationFailure(
          "That action was already recorded; reload the request",
          "idempotencyKey",
        ),
        correlationId,
      };
    }
    throw error;
  }
}

function success(
  commandName: string,
  request: RequestSnapshot,
  change: StatusChange,
  correlationId: string,
  nextActions: readonly string[] = [],
): CommandExecutionResult {
  return {
    ok: true,
    commandName,
    subjectId: request.id,
    newVersion: change.newVersion,
    nextAuthorisedActions: nextActions,
    correlationId,
  };
}

// ---------------------------------------------------------------------------
// Review: approve / reject
// ---------------------------------------------------------------------------

export async function reviewStockRequest(input: {
  actor: DistributionActor;
  data: ReviewStockRequestInput;
  deps?: DistributionCommandDeps;
}): Promise<CommandExecutionResult> {
  return withStockRequest(
    {
      actor: input.actor,
      requestId: input.data.requestId,
      expectedVersion: input.data.expectedVersion,
      operation: "update",
      requiredAction: "review",
      deps: input.deps,
    },
    async ({ tx, request, participants, actor, correlationId }) => {
      const reason = input.data.reason?.trim();
      if (!reason) {
        return {
          ok: false,
          failure: validationFailure("A decision reason is required", "reason"),
          correlationId,
        };
      }

      if (input.data.decision === "reject") {
        const change = await writeRequestStatus(tx, {
          request,
          nextStatus: "rejected",
          actor,
          commandName: "distribution.request.review",
          reason,
          correlationId,
          decisionReason: reason,
        });

        await completeAutomatedTask(tx, {
          automationKey: approvalTaskKey(request.id, request.managerAssignmentId),
          actor,
          correlationId,
          reason: "Rejected",
          commandName: "distribution.request.review",
        });

        await recordDistributionActivityAndOutbox(tx, {
          actor,
          correlationId,
          eventName: "stock_request.rejected",
          subjectId: request.id,
          payload: { reason },
        });

        await notifyRequestEvent(tx, {
          request,
          event: "rejected",
          title: `Stock request ${request.humanId} was declined`,
          message: reason,
          recipients: [{ userId: participants.requesterUserId, partnerId: participants.partnerId }],
        });

        return success("distribution.request.review", request, change, correlationId);
      }

      // --- approve ---------------------------------------------------------
      const decisions = new Map(input.data.lines.map((line) => [line.lineId, line]));
      let approvedTotal = 0;

      for (const line of request.lines) {
        const decision = decisions.get(line.id);
        const approved = decision ? Math.trunc(Number(decision.approvedQuantity ?? 0)) : 0;
        const sourceLocationId = decision?.sourceLocationId?.trim() || null;

        if (approved > 0 && !sourceLocationId) {
          throw new DistributionCommandError(
            `Choose a source location for ${line.skuCode}`,
            "sourceLocationId",
          );
        }
        if (sourceLocationId) {
          await assertActiveLocation(tx, sourceLocationId);
        }

        approvedTotal += approved;
        await writeLineQuantities(
          tx,
          line.id,
          { ...lineQuantities(line), approved },
          approved > 0 ? sourceLocationId : null,
        );
        line.approved = approved;
        line.sourceLocationId = approved > 0 ? sourceLocationId : line.sourceLocationId;
      }

      if (approvedTotal === 0) {
        // Approving nothing is a rejection wearing an approval's clothes, and
        // it would leave the request permanently unfulfillable with no reason
        // recorded against it. Say so instead — and throw rather than return,
        // because the loop above has already written every line's approved
        // quantity and a return would commit those writes.
        throw new DistributionCommandError(
          "Approve at least one unit, or reject the request with a reason",
          "lines",
        );
      }

      const change = await writeRequestStatus(tx, {
        request,
        nextStatus: "approved",
        actor,
        commandName: "distribution.request.review",
        reason,
        correlationId,
        decisionReason: reason,
      });

      await completeAutomatedTask(tx, {
        automationKey: approvalTaskKey(request.id, request.managerAssignmentId),
        actor,
        correlationId,
        reason: "Approved",
        commandName: "distribution.request.review",
      });

      // Re-read custodians AFTER the source locations were written: before
      // approval the lines have no source, so the fulfilment Tasks would have
      // had nobody to go to.
      const refreshed = await loadRequestForUpdate(tx, request.id);
      const custodians = refreshed ? custodianAssignmentIds(refreshed) : [];
      const custodianRecipientList: NotificationRecipient[] = [];

      for (const custodianAssignmentId of custodians) {
        const custodianUserId = await resolveAssignmentUserId(tx, custodianAssignmentId);
        custodianRecipientList.push({ userId: custodianUserId, partnerId: null });
        await ensureAutomatedTask(tx, {
          automationKey: fulfilmentTaskKey(request.id, custodianAssignmentId),
          automationSource: STOCK_REQUEST_AUTOMATION_SOURCE,
          templateVersion: STOCK_REQUEST_TEMPLATE_VERSION,
          assigneeId: custodianUserId,
          creatorId: actor.userId,
          relatedType: "stock_request",
          relatedId: request.id,
          title: `Allocate and dispatch stock request ${request.humanId}`,
          description: "Reserve the approved quantities, then dispatch them to the destination.",
          priority: request.priority === "urgent" ? "urgent" : "high",
          dueAt: null,
          partnerId: null,
        });
      }

      await recordDistributionActivityAndOutbox(tx, {
        actor,
        correlationId,
        eventName: "stock_request.approved",
        subjectId: request.id,
        payload: { reason, approvedTotal, custodianAssignmentIds: custodians },
      });

      await notifyRequestEvent(tx, {
        request,
        event: "approved",
        title: `Stock request ${request.humanId} was approved`,
        message: `${approvedTotal} unit(s) approved. Fulfilment is with the source location.`,
        recipients: [
          { userId: participants.requesterUserId, partnerId: participants.partnerId },
          ...custodianRecipientList,
        ],
      });

      return success("distribution.request.review", request, change, correlationId, [
        "distribution.request.allocate",
      ]);
    },
  );
}

// ---------------------------------------------------------------------------
// Allocate
// ---------------------------------------------------------------------------

function requestedPerLine(
  request: RequestSnapshot,
  lines: Array<{ lineId: string; quantity: number }> | undefined,
): Map<string, number> | null {
  if (!lines || lines.length === 0) return null;
  const map = new Map<string, number>();
  for (const line of lines) {
    map.set(line.lineId, Math.trunc(Number(line.quantity ?? 0)));
  }
  return map;
}

export async function allocateStockRequest(input: {
  actor: DistributionActor;
  data: AllocateStockRequestInput;
  deps?: DistributionCommandDeps;
}): Promise<CommandExecutionResult> {
  return withStockRequest(
    {
      actor: input.actor,
      requestId: input.data.requestId,
      expectedVersion: input.data.expectedVersion,
      operation: "update",
      requiredAction: "allocate",
      deps: input.deps,
    },
    async ({ tx, request, participants, actor, correlationId }) => {
      if (!input.data.idempotencyKey?.trim()) {
        return {
          ok: false,
          failure: validationFailure("An allocation key is required", "idempotencyKey"),
          correlationId,
        };
      }

      // Two modes on purpose. With explicit quantities the custodian is
      // asserting exactly how much to commit, and asking for more than exists
      // is an error they need to see. With no quantities the command means
      // "reserve whatever you can" — which is what produces the honest
      // awaiting_stock / partially_allocated / allocated outcomes when a
      // warehouse is short.
      const explicit = requestedPerLine(request, input.data.lines);
      let reservedNow = 0;
      let shortfall = 0;

      for (const line of request.lines) {
        const outstanding = line.approved - line.reserved;
        if (outstanding <= 0) continue;
        if (!line.sourceLocationId) {
          throw new DistributionCommandError(
            `Line ${line.skuCode} has no source location to reserve from`,
            "sourceLocationId",
          );
        }

        const balance = await readBalance(tx, line.productSkuId, line.sourceLocationId);
        const available = availableAt(balance);

        let quantity: number;
        if (explicit) {
          quantity = explicit.get(line.id) ?? 0;
          if (quantity <= 0) continue;
          if (quantity > outstanding) {
            throw new DistributionCommandError(
              `Cannot reserve more than the approved quantity for ${line.skuCode}`,
              "quantity",
            );
          }
          if (quantity > available) {
            // Thrown, not returned: earlier lines in this loop may already
            // have posted reservations, and withTransaction only rolls back on
            // a throw. Returning here would commit those reservations against
            // a request whose header still claims nothing is allocated.
            throw new DistributionCommandError(
              `Not enough available stock for ${line.skuCode} at the source location`,
              "quantity",
            );
          }
        } else {
          quantity = Math.min(outstanding, available);
          if (quantity <= 0) {
            shortfall += outstanding;
            continue;
          }
          if (quantity < outstanding) shortfall += outstanding - quantity;
        }

        await applyInventoryMovement(tx, {
          movementType: "reservation",
          productSkuId: line.productSkuId,
          sourceLocationId: line.sourceLocationId,
          destinationLocationId: null,
          quantity,
          requestId: request.id,
          requestLineId: line.id,
          actor,
          reason: null,
          idempotencyKey: `${input.data.idempotencyKey}:${line.id}`,
          correlationId,
        });

        line.reserved += quantity;
        reservedNow += quantity;
        await writeLineQuantities(tx, line.id, lineQuantities(line));
      }

      const nextStatus = deriveStockRequestStatus(request.lines.map(lineQuantities));
      const change = await writeRequestStatus(tx, {
        request,
        nextStatus,
        actor,
        commandName: "distribution.request.allocate",
        reason: null,
        correlationId,
      });

      await recordDistributionActivityAndOutbox(tx, {
        actor,
        correlationId,
        eventName: `stock_request.${nextStatus}`,
        subjectId: request.id,
        payload: { reservedNow, shortfall, status: nextStatus },
      });

      if (shortfall > 0) {
        // §24.5.1: a shortage is the one event all three parties need, because
        // each of them can do something different about it.
        await notifyRequestEvent(tx, {
          request,
          event: `shortage:${nextStatus}`,
          title: `Stock request ${request.humanId} is short by ${shortfall} unit(s)`,
          message:
            nextStatus === "awaiting_stock"
              ? "No approved units could be reserved from the source location."
              : `${reservedNow} unit(s) reserved; ${shortfall} still unavailable.`,
          recipients: [
            { userId: participants.requesterUserId, partnerId: participants.partnerId },
            { userId: participants.managerUserId, partnerId: null },
            ...custodianRecipients(participants),
          ],
        });
      } else if (reservedNow > 0) {
        await notifyRequestEvent(tx, {
          request,
          event: `allocated:${change.newVersion}`,
          title: `Stock request ${request.humanId} is allocated`,
          message: `${reservedNow} unit(s) reserved and ready to dispatch.`,
          recipients: [
            { userId: participants.requesterUserId, partnerId: participants.partnerId },
            ...custodianRecipients(participants),
          ],
        });
      }

      return success("distribution.request.allocate", request, change, correlationId, [
        "distribution.request.dispatch",
      ]);
    },
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function dispatchStockRequest(input: {
  actor: DistributionActor;
  data: DispatchStockRequestInput;
  deps?: DistributionCommandDeps;
}): Promise<CommandExecutionResult> {
  return withStockRequest(
    {
      actor: input.actor,
      requestId: input.data.requestId,
      expectedVersion: input.data.expectedVersion,
      operation: "update",
      requiredAction: "dispatch",
      deps: input.deps,
    },
    async ({ tx, request, participants, actor, correlationId }) => {
      if (!input.data.idempotencyKey?.trim()) {
        return {
          ok: false,
          failure: validationFailure("A dispatch key is required", "idempotencyKey"),
          correlationId,
        };
      }

      const explicit = requestedPerLine(request, input.data.lines);
      let dispatchedNow = 0;

      for (const line of request.lines) {
        const outstanding = line.reserved - line.dispatched;
        if (outstanding <= 0) continue;
        const quantity = explicit ? (explicit.get(line.id) ?? 0) : outstanding;
        if (quantity <= 0) continue;
        if (quantity > outstanding) {
          throw new DistributionCommandError(
            `Cannot dispatch more than is reserved for ${line.skuCode}`,
            "quantity",
          );
        }
        if (!line.sourceLocationId) {
          throw new DistributionCommandError(
            `Line ${line.skuCode} has no source location to dispatch from`,
            "sourceLocationId",
          );
        }

        await applyInventoryMovement(tx, {
          movementType: "dispatch",
          productSkuId: line.productSkuId,
          sourceLocationId: line.sourceLocationId,
          destinationLocationId: request.destinationLocationId,
          quantity,
          requestId: request.id,
          requestLineId: line.id,
          actor,
          reason: input.data.reference?.trim() || null,
          idempotencyKey: `${input.data.idempotencyKey}:${line.id}`,
          correlationId,
        });

        line.dispatched += quantity;
        dispatchedNow += quantity;
        await writeLineQuantities(tx, line.id, lineQuantities(line));
      }

      if (dispatchedNow === 0) {
        return {
          ok: false,
          failure: validationFailure("There is nothing reserved left to dispatch", "lines"),
          correlationId,
        };
      }

      const nextStatus = deriveStockRequestStatus(request.lines.map(lineQuantities));
      const change = await writeRequestStatus(tx, {
        request,
        nextStatus,
        actor,
        commandName: "distribution.request.dispatch",
        reason: input.data.reference?.trim() || null,
        correlationId,
      });

      for (const custodianAssignmentId of participants.custodianUserIds.keys()) {
        await completeAutomatedTask(tx, {
          automationKey: fulfilmentTaskKey(request.id, custodianAssignmentId),
          actor,
          correlationId,
          reason: "Dispatched",
          commandName: "distribution.request.dispatch",
        });
      }

      await ensureAutomatedTask(tx, {
        automationKey: confirmReceiptTaskKey(request.id, request.requesterUserId),
        automationSource: STOCK_REQUEST_AUTOMATION_SOURCE,
        templateVersion: STOCK_REQUEST_TEMPLATE_VERSION,
        assigneeId: request.requesterUserId,
        creatorId: actor.userId,
        relatedType: "stock_request",
        relatedId: request.id,
        title: `Confirm receipt of stock request ${request.humanId}`,
        description: "Confirm the quantities that actually arrived at your location.",
        priority: "medium",
        dueAt: null,
        // The requester is a Distributor, so the Task must carry their
        // Partner scope or their own Task list will not admit it.
        partnerId: participants.partnerId,
      });

      await recordDistributionActivityAndOutbox(tx, {
        actor,
        correlationId,
        eventName: "stock_request.dispatched",
        subjectId: request.id,
        payload: { dispatchedNow, reference: input.data.reference?.trim() || null },
      });

      await notifyRequestEvent(tx, {
        request,
        event: `dispatched:${change.newVersion}`,
        title: `Stock request ${request.humanId} is on its way`,
        message: `${dispatchedNow} unit(s) dispatched. Confirm receipt when they arrive.`,
        recipients: [{ userId: participants.requesterUserId, partnerId: participants.partnerId }],
      });

      return success("distribution.request.dispatch", request, change, correlationId, [
        "distribution.request.receive",
      ]);
    },
  );
}

// ---------------------------------------------------------------------------
// Receive
// ---------------------------------------------------------------------------

export async function receiveStockRequest(input: {
  actor: DistributionActor;
  data: ReceiveStockRequestInput;
  deps?: DistributionCommandDeps;
}): Promise<CommandExecutionResult> {
  return withStockRequest(
    {
      actor: input.actor,
      requestId: input.data.requestId,
      expectedVersion: input.data.expectedVersion,
      operation: "update",
      requiredAction: "receive",
      deps: input.deps,
    },
    async ({ tx, request, participants, actor, correlationId }) => {
      if (!input.data.idempotencyKey?.trim()) {
        return {
          ok: false,
          failure: validationFailure("A receipt key is required", "idempotencyKey"),
          correlationId,
        };
      }

      const explicit = requestedPerLine(request, input.data.lines);
      let receivedNow = 0;

      for (const line of request.lines) {
        const outstanding = line.dispatched - line.received;
        if (outstanding <= 0) continue;
        const quantity = explicit ? (explicit.get(line.id) ?? 0) : outstanding;
        if (quantity <= 0) continue;
        if (quantity > outstanding) {
          throw new DistributionCommandError(
            `Cannot receive more than was dispatched for ${line.skuCode}`,
            "quantity",
          );
        }

        await applyInventoryMovement(tx, {
          movementType: "delivery",
          productSkuId: line.productSkuId,
          sourceLocationId: line.sourceLocationId,
          destinationLocationId: request.destinationLocationId,
          quantity,
          requestId: request.id,
          requestLineId: line.id,
          actor,
          reason: null,
          idempotencyKey: `${input.data.idempotencyKey}:${line.id}`,
          correlationId,
        });

        line.received += quantity;
        receivedNow += quantity;
        await writeLineQuantities(tx, line.id, lineQuantities(line));
      }

      if (receivedNow === 0) {
        return {
          ok: false,
          failure: validationFailure("There is nothing dispatched left to confirm", "lines"),
          correlationId,
        };
      }

      const nextStatus = deriveStockRequestStatus(request.lines.map(lineQuantities));
      const change = await writeRequestStatus(tx, {
        request,
        nextStatus,
        actor,
        commandName: "distribution.request.receive",
        reason: null,
        correlationId,
      });

      if (nextStatus === "received") {
        await completeAutomatedTask(tx, {
          automationKey: confirmReceiptTaskKey(request.id, request.requesterUserId),
          actor,
          correlationId,
          reason: "Received",
          commandName: "distribution.request.receive",
        });
      }

      await recordDistributionActivityAndOutbox(tx, {
        actor,
        correlationId,
        eventName: `stock_request.${nextStatus}`,
        subjectId: request.id,
        payload: { receivedNow, status: nextStatus },
      });

      await notifyRequestEvent(tx, {
        request,
        event: `${nextStatus}:${change.newVersion}`,
        title:
          nextStatus === "received"
            ? `Stock request ${request.humanId} is complete`
            : `Stock request ${request.humanId} was partly received`,
        message: `${receivedNow} unit(s) confirmed at ${request.humanId}'s destination.`,
        recipients: [
          { userId: participants.requesterUserId, partnerId: participants.partnerId },
          { userId: participants.managerUserId, partnerId: null },
          ...custodianRecipients(participants),
        ],
      });

      return success("distribution.request.receive", request, change, correlationId);
    },
  );
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelStockRequest(input: {
  actor: DistributionActor;
  data: CancelStockRequestInput;
  deps?: DistributionCommandDeps;
}): Promise<CommandExecutionResult> {
  return withStockRequest(
    {
      actor: input.actor,
      requestId: input.data.requestId,
      expectedVersion: input.data.expectedVersion,
      operation: "update",
      requiredAction: "cancel",
      deps: input.deps,
    },
    async ({ tx, request, participants, actor, correlationId }) => {
      const reason = input.data.reason?.trim();
      if (!reason) {
        return {
          ok: false,
          failure: validationFailure("A reason is required to cancel a request", "reason"),
          correlationId,
        };
      }

      // Belt and braces: resolveAllowedStockRequestActions already withheld
      // "cancel" past first dispatch, but this is the rule that protects real
      // stock, so it is asserted again at the point of effect.
      assertStockRequestCancellable(request.status, request.lines.map(lineQuantities));

      let releasedTotal = 0;
      for (const line of request.lines) {
        if (line.reserved <= 0 || !line.sourceLocationId) continue;
        const quantity = line.reserved;
        await applyInventoryMovement(tx, {
          movementType: "reservation_release",
          productSkuId: line.productSkuId,
          sourceLocationId: line.sourceLocationId,
          destinationLocationId: null,
          quantity,
          requestId: request.id,
          requestLineId: line.id,
          actor,
          reason: null,
          idempotencyKey: `stock-request:${request.id}:cancel:${line.id}`,
          correlationId,
        });
        line.reserved = 0;
        releasedTotal += quantity;
        await writeLineQuantities(tx, line.id, lineQuantities(line));
      }

      const change = await writeRequestStatus(tx, {
        request,
        nextStatus: "cancelled",
        actor,
        commandName: "distribution.request.cancel",
        reason,
        correlationId,
      });

      // Every open work item for this request closes: leaving a manager an
      // approval Task for a withdrawn request is how a queue fills with
      // things nobody can act on.
      await completeAutomatedTask(tx, {
        automationKey: approvalTaskKey(request.id, request.managerAssignmentId),
        actor,
        correlationId,
        reason: "Request cancelled",
        commandName: "distribution.request.cancel",
      });
      for (const custodianAssignmentId of participants.custodianUserIds.keys()) {
        await completeAutomatedTask(tx, {
          automationKey: fulfilmentTaskKey(request.id, custodianAssignmentId),
          actor,
          correlationId,
          reason: "Request cancelled",
          commandName: "distribution.request.cancel",
        });
      }
      await completeAutomatedTask(tx, {
        automationKey: confirmReceiptTaskKey(request.id, request.requesterUserId),
        actor,
        correlationId,
        reason: "Request cancelled",
        commandName: "distribution.request.cancel",
      });

      await recordDistributionActivityAndOutbox(tx, {
        actor,
        correlationId,
        eventName: "stock_request.cancelled",
        subjectId: request.id,
        payload: { reason, releasedTotal },
      });

      await notifyRequestEvent(tx, {
        request,
        event: "cancelled",
        title: `Stock request ${request.humanId} was withdrawn`,
        message: reason,
        recipients: [
          { userId: participants.managerUserId, partnerId: null },
          ...(releasedTotal > 0 ? custodianRecipients(participants) : []),
        ],
      });

      return success("distribution.request.cancel", request, change, correlationId);
    },
  );
}

// ---------------------------------------------------------------------------
// Exception and recovery
// ---------------------------------------------------------------------------

export async function reportStockRequestException(input: {
  actor: DistributionActor;
  data: StockRequestExceptionInput;
  deps?: DistributionCommandDeps;
}): Promise<CommandExecutionResult> {
  return withStockRequest(
    {
      actor: input.actor,
      requestId: input.data.requestId,
      expectedVersion: input.data.expectedVersion,
      operation: "update",
      requiredAction: "report_exception",
      deps: input.deps,
    },
    async ({ tx, request, participants, actor, correlationId }) => {
      const reason = input.data.reason?.trim();
      if (!reason) {
        return {
          ok: false,
          failure: validationFailure("Describe what went wrong", "reason"),
          correlationId,
        };
      }

      const change = await writeRequestStatus(tx, {
        request,
        nextStatus: "exception",
        actor,
        commandName: "distribution.request.exception",
        reason,
        correlationId,
        exceptionReason: reason,
        // Remembered so recovery puts the request back where it actually
        // was, rather than guessing a state from the quantities.
        exceptionFromStatus: request.status,
      });

      await ensureAutomatedTask(tx, {
        automationKey: `stock-request:${request.id}:exception:${request.managerAssignmentId}`,
        automationSource: STOCK_REQUEST_AUTOMATION_SOURCE,
        templateVersion: STOCK_REQUEST_TEMPLATE_VERSION,
        assigneeId: participants.managerUserId,
        creatorId: actor.userId,
        relatedType: "stock_request",
        relatedId: request.id,
        title: `Resolve exception on stock request ${request.humanId}`,
        description: reason,
        priority: "high",
        dueAt: null,
        partnerId: null,
      });

      await recordDistributionActivityAndOutbox(tx, {
        actor,
        correlationId,
        eventName: "stock_request.exception_reported",
        subjectId: request.id,
        payload: { reason, fromStatus: request.status },
      });

      await notifyRequestEvent(tx, {
        request,
        event: `exception:${change.newVersion}`,
        title: `Stock request ${request.humanId} needs attention`,
        message: reason,
        recipients: [
          { userId: participants.requesterUserId, partnerId: participants.partnerId },
          { userId: participants.managerUserId, partnerId: null },
          ...custodianRecipients(participants),
        ],
      });

      return success("distribution.request.exception", request, change, correlationId);
    },
  );
}

export async function resolveStockRequestException(input: {
  actor: DistributionActor;
  data: StockRequestExceptionInput;
  deps?: DistributionCommandDeps;
}): Promise<CommandExecutionResult> {
  return withStockRequest(
    {
      actor: input.actor,
      requestId: input.data.requestId,
      expectedVersion: input.data.expectedVersion,
      operation: "update",
      requiredAction: "resolve_exception",
      deps: input.deps,
    },
    async ({ tx, request, participants, actor, correlationId }) => {
      const reason = input.data.reason?.trim();
      if (!reason) {
        return {
          ok: false,
          failure: validationFailure("Record how the exception was resolved", "reason"),
          correlationId,
        };
      }

      // Recovery returns the request to where it was, then lets the quantity
      // ladder speak: if work happened while it was parked, the derived
      // status is the honest answer, and the transition table still has to
      // permit it.
      //
      // The stored status is checked against the transition table rather than
      // trusted. A value the table forbids would make writeRequestStatus throw
      // on every attempt, and since an actor cannot edit stored state that is
      // an unrecoverable request rather than a fixable input — so fall back to
      // the derived status instead of failing forever.
      const stored = request.exceptionFromStatus;
      const recovered =
        stored && isAllowedStockRequestTransition("exception", stored)
          ? stored
          : deriveStockRequestStatus(request.lines.map(lineQuantities));

      const change = await writeRequestStatus(tx, {
        request,
        nextStatus: recovered,
        actor,
        commandName: "distribution.request.exception_resolve",
        reason,
        correlationId,
        exceptionReason: null,
        exceptionFromStatus: null,
      });

      await completeAutomatedTask(tx, {
        automationKey: `stock-request:${request.id}:exception:${request.managerAssignmentId}`,
        actor,
        correlationId,
        reason,
        commandName: "distribution.request.exception_resolve",
      });

      await recordDistributionActivityAndOutbox(tx, {
        actor,
        correlationId,
        eventName: "stock_request.exception_resolved",
        subjectId: request.id,
        payload: { reason, recoveredStatus: recovered },
      });

      await notifyRequestEvent(tx, {
        request,
        event: `exception_resolved:${change.newVersion}`,
        title: `Stock request ${request.humanId} is back on track`,
        message: reason,
        recipients: [
          { userId: participants.requesterUserId, partnerId: participants.partnerId },
          { userId: participants.managerUserId, partnerId: null },
          ...custodianRecipients(participants),
        ],
      });

      return success("distribution.request.exception_resolve", request, change, correlationId);
    },
  );
}
