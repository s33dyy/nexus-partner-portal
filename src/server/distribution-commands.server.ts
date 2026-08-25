import { randomUUID } from "node:crypto";

import {
  makePolicyDenial,
  type CommandExecutionResult,
  type CommandFailureContract,
} from "@/domain/contracts/commands";
import {
  assertMovementEndpoints,
  assertPositiveStockQuantity,
  computeAvailableQuantity,
  isInventoryMovementType,
  movementRequiresReason,
  type CreateStockLocationInput,
  type InventoryMovementType,
  type PostManualStockMovementInput,
} from "@/domain/contracts/distribution";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { withTransaction, type QueryRunner } from "@/server/command-runtime.server";
import {
  authorizeDistribution,
  isDistributionSuperAdmin,
  type AuthorizeDistributionDeps,
  type DistributionActor,
} from "@/server/distribution-policy.server";
import { recordDistributionActivityAndOutbox } from "@/server/workflow-automation.server";

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
