import type { PolicyDenialErrorContract } from "@/domain/contracts/commands";
import {
  EMPTY_ADMIN_OPTIONS,
  computeAvailableQuantity,
  stockRequestProgress,
  type DistributionAdminOptions,
  type DistributionExceptionView,
  type InventoryBalanceView,
  type InventoryMovementType,
  type InventoryMovementView,
  type RequestableProductSkuView,
  type StockLocationView,
  type StockRequestAction,
  type StockRequestLineView,
  type StockRequestPriority,
  type StockRequestStatus,
  type StockRequestView,
} from "@/domain/contracts/distribution";
import type { QueryRunner } from "@/server/command-runtime.server";
import {
  authorizeDistribution,
  destinationLocationScopePredicate,
  resolveAllowedStockRequestActions,
  stockLocationScopePredicate,
  stockRequestScopePredicate,
  type AuthorizeDistributionDeps,
  type DistributionActor,
  type StockRequestAuthorityFacts,
} from "@/server/distribution-policy.server";
import { pool } from "@/server/postgres.server";

/**
 * Scoped read models for the Distribution workspace (product.md §24.6).
 *
 * Every function here authorises first and queries second, and every query
 * carries a server-computed scope predicate built from the caller's governed
 * Assignment — never from a client-supplied filter. A caller outside scope
 * gets an empty result or a denial, never a count, a total, or the shape of
 * somebody else's stock.
 *
 * `available_quantity` is computed in SQL rather than read from a column, so
 * it can never disagree with the on-hand, reserved, and damaged figures it
 * is derived from.
 */

export type DistributionReadResult<TRow> =
  | { ok: true; rows: TRow[]; total: number }
  | { ok: false; failure: PolicyDenialErrorContract };

export type DistributionQueryDeps = AuthorizeDistributionDeps & {
  query?: QueryRunner["query"];
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function runner(deps: DistributionQueryDeps): QueryRunner["query"] {
  return deps.query ?? ((sql, params) => pool.query(sql, params as unknown[]));
}

function boundedLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function boundedOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset) || !offset || offset <= 0) return 0;
  return Math.floor(offset);
}

function toIso(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/**
 * A `DATE` column has no time and no zone, and `pg` hands it back as a JS
 * Date at LOCAL midnight. Going through toISOString() to slice the first ten
 * characters therefore shifts the calendar day backwards for every timezone
 * east of UTC — a request needed on the 15th displayed as the 14th in IST.
 * Read the local components instead, which is what the column actually means.
 */
function toDateOnly(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    if (match) return match[1]!;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function totalFrom(rows: Array<Record<string, unknown>>, fallback: number): number {
  const first = rows[0];
  return first && first.total_count != null ? num(first.total_count) : fallback;
}

/** Collects params in order so a clause can be composed without hand-counting
 * placeholder indexes — the failure mode there is a silent off-by-one that
 * binds a scope value into the wrong predicate. */
function createParamBuilder() {
  const params: unknown[] = [];
  return {
    params,
    next(): number {
      return params.length + 1;
    },
    add(value: unknown): string {
      params.push(value);
      return `$${params.length}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Stock requests
// ---------------------------------------------------------------------------

export type StockRequestFilters = {
  status?: StockRequestStatus | null;
  priority?: StockRequestPriority | null;
  dealId?: string | null;
  customerId?: string | null;
  locationId?: string | null;
  productSkuId?: string | null;
  /** Open work only — everything that is not terminal. */
  openOnly?: boolean;
  limit?: number;
  offset?: number;
};

type StockRequestRow = Record<string, unknown>;

const STOCK_REQUEST_SELECT = `
  SELECT r.id,
         r.human_id,
         r.status,
         r.priority,
         r.required_by,
         r.reason,
         r.decision_reason,
         r.exception_reason,
         r.version,
         r.created_at,
         r.updated_at,
         r.requester_user_id,
         r.distributor_assignment_id,
         r.manager_assignment_id,
         r.destination_location_id,
         r.deal_id,
         r.customer_id,
         dest.location_name AS destination_location_name,
         dest.custodian_assignment_id AS destination_custodian_assignment_id,
         requester.full_name AS requester_name,
         manager_profile.full_name AS manager_name,
         agg.line_count,
         agg.requested_total,
         agg.approved_total,
         agg.reserved_total,
         agg.dispatched_total,
         agg.received_total,
         agg.source_custodian_ids,
         COUNT(*) OVER () AS total_count
  FROM stock_requests r
  JOIN stock_locations dest ON dest.id = r.destination_location_id
  LEFT JOIN profiles requester ON requester.id = r.requester_user_id
  LEFT JOIN assignments manager_assignment
         ON manager_assignment.assignment_id = r.manager_assignment_id
  LEFT JOIN profiles manager_profile ON manager_profile.id = manager_assignment.user_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS line_count,
           COALESCE(SUM(l.requested_quantity), 0)::int AS requested_total,
           COALESCE(SUM(l.approved_quantity), 0)::int AS approved_total,
           COALESCE(SUM(l.reserved_quantity), 0)::int AS reserved_total,
           COALESCE(SUM(l.dispatched_quantity), 0)::int AS dispatched_total,
           COALESCE(SUM(l.received_quantity), 0)::int AS received_total,
           COALESCE(
             ARRAY_AGG(DISTINCT src.custodian_assignment_id)
               FILTER (WHERE src.custodian_assignment_id IS NOT NULL),
             ARRAY[]::text[]
           ) AS source_custodian_ids
    FROM stock_request_lines l
    LEFT JOIN stock_locations src ON src.id = l.source_location_id
    WHERE l.request_id = r.id
  ) agg ON TRUE
`;

function authorityFacts(row: StockRequestRow): StockRequestAuthorityFacts {
  const custodians = new Set<string>();
  for (const id of (row.source_custodian_ids as string[] | null) ?? []) {
    if (id) custodians.add(String(id));
  }
  if (row.destination_custodian_assignment_id) {
    custodians.add(String(row.destination_custodian_assignment_id));
  }
  return {
    requesterUserId: String(row.requester_user_id),
    distributorAssignmentId: String(row.distributor_assignment_id),
    managerAssignmentId: String(row.manager_assignment_id),
    destinationLocationId: String(row.destination_location_id),
    custodianAssignmentIds: [...custodians],
  };
}

/**
 * Who the request is waiting on, as a role label rather than a name.
 *
 * A label, not a person: telling a Distributor "waiting on Priya Sharma"
 * would expose an internal identity they have no other route to, while
 * "waiting on the approving manager" answers the question they actually
 * have.
 */
function nextOwnerLabel(status: StockRequestStatus): string | null {
  switch (status) {
    case "submitted":
      return "Approving manager";
    case "approved":
    case "awaiting_stock":
    case "partially_allocated":
    case "allocated":
      return "Source location custodian";
    case "dispatched":
    case "partially_received":
      return "Requesting Distributor";
    case "exception":
      return "Approving manager";
    default:
      return null;
  }
}

/** The list view aggregates lines rather than loading them, so actions are
 * derived from one synthetic total line. Every rule that matters at this
 * level — status gates and "has anything shipped?" — reads the same either
 * way; getStockRequest() below uses the real lines. */
function listActions(actor: DistributionActor, row: StockRequestRow): StockRequestAction[] {
  const requested = num(row.requested_total);
  return resolveAllowedStockRequestActions(actor, {
    ...authorityFacts(row),
    status: String(row.status) as StockRequestStatus,
    lines: [
      {
        requested: Math.max(requested, 1),
        approved: num(row.approved_total),
        reserved: num(row.reserved_total),
        dispatched: num(row.dispatched_total),
        received: num(row.received_total),
      },
    ],
  });
}

export type StockRequestListRow = Omit<StockRequestView, "lines"> & {
  lineCount: number;
  requestedTotal: number;
  approvedTotal: number;
  reservedTotal: number;
  dispatchedTotal: number;
  receivedTotal: number;
  receivedPercent: number;
};

function toListRow(actor: DistributionActor, row: StockRequestRow): StockRequestListRow {
  const status = String(row.status) as StockRequestStatus;
  const progress = stockRequestProgress([
    {
      requested: Math.max(num(row.requested_total), 1),
      approved: num(row.approved_total),
      reserved: num(row.reserved_total),
      dispatched: num(row.dispatched_total),
      received: num(row.received_total),
    },
  ]);

  return {
    id: String(row.id),
    humanId: String(row.human_id),
    status,
    priority: String(row.priority) as StockRequestPriority,
    requiredBy: toDateOnly(row.required_by),
    reason: String(row.reason ?? ""),
    exceptionReason: row.exception_reason == null ? null : String(row.exception_reason),
    decisionReason: row.decision_reason == null ? null : String(row.decision_reason),
    requesterName: row.requester_name == null ? null : String(row.requester_name),
    distributorAssignmentId: String(row.distributor_assignment_id),
    managerAssignmentId: String(row.manager_assignment_id),
    managerName: row.manager_name == null ? null : String(row.manager_name),
    destinationLocationId: String(row.destination_location_id),
    destinationLocationName: String(row.destination_location_name ?? ""),
    dealId: row.deal_id == null ? null : String(row.deal_id),
    customerId: row.customer_id == null ? null : String(row.customer_id),
    allowedActions: listActions(actor, row),
    nextOwnerLabel: nextOwnerLabel(status),
    version: num(row.version),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    lineCount: num(row.line_count),
    requestedTotal: num(row.requested_total),
    approvedTotal: num(row.approved_total),
    reservedTotal: num(row.reserved_total),
    dispatchedTotal: num(row.dispatched_total),
    receivedTotal: num(row.received_total),
    receivedPercent: progress.receivedPercent,
  };
}

export async function listStockRequests(
  actor: DistributionActor,
  filters: StockRequestFilters = {},
  deps: DistributionQueryDeps = {},
): Promise<DistributionReadResult<StockRequestListRow>> {
  const authorized = await authorizeDistribution(actor, "read", deps);
  if (!authorized.ok) return authorized;

  const builder = createParamBuilder();
  const scope = stockRequestScopePredicate(actor, "r", builder.next());
  builder.params.push(...scope.params);

  const conditions = [scope.clause];
  if (filters.status) conditions.push(`r.status = ${builder.add(filters.status)}`);
  if (filters.priority) conditions.push(`r.priority = ${builder.add(filters.priority)}`);
  if (filters.dealId) conditions.push(`r.deal_id = ${builder.add(filters.dealId)}`);
  if (filters.customerId) conditions.push(`r.customer_id = ${builder.add(filters.customerId)}`);
  if (filters.locationId) {
    const placeholder = builder.add(filters.locationId);
    conditions.push(`(
      r.destination_location_id = ${placeholder}
      OR EXISTS (
        SELECT 1 FROM stock_request_lines fl
        WHERE fl.request_id = r.id AND fl.source_location_id = ${placeholder}
      )
    )`);
  }
  if (filters.productSkuId) {
    conditions.push(`EXISTS (
      SELECT 1 FROM stock_request_lines pl
      WHERE pl.request_id = r.id AND pl.product_sku_id = ${builder.add(filters.productSkuId)}
    )`);
  }
  if (filters.openOnly) {
    conditions.push(`r.status NOT IN ('received', 'rejected', 'cancelled')`);
  }

  const limit = builder.add(boundedLimit(filters.limit));
  const offset = builder.add(boundedOffset(filters.offset));

  const { rows } = await runner(deps)(
    `${STOCK_REQUEST_SELECT}
     WHERE ${conditions.join(" AND ")}
     ORDER BY r.updated_at DESC, r.human_id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    builder.params,
  );

  const typed = rows as StockRequestRow[];
  return {
    ok: true,
    rows: typed.map((row) => toListRow(actor, row)),
    total: totalFrom(typed, typed.length),
  };
}

export type StockRequestDetailResult =
  | { ok: true; request: StockRequestView }
  | { ok: false; failure: PolicyDenialErrorContract };

export async function getStockRequest(
  actor: DistributionActor,
  requestId: string,
  deps: DistributionQueryDeps = {},
): Promise<StockRequestDetailResult> {
  const authorized = await authorizeDistribution(actor, "read", deps);
  if (!authorized.ok) return authorized;

  const query = runner(deps);
  const builder = createParamBuilder();
  const idPlaceholder = builder.add(requestId);
  const scope = stockRequestScopePredicate(actor, "r", builder.next());
  builder.params.push(...scope.params);

  const { rows } = await query(
    `${STOCK_REQUEST_SELECT}
     WHERE r.id = ${idPlaceholder} AND ${scope.clause}
     LIMIT 1`,
    builder.params,
  );

  const row = (rows as StockRequestRow[])[0];
  if (!row) {
    // Deliberately the same denial an unauthorised caller gets for a request
    // that does exist: "not accessible" must not distinguish "wrong id" from
    // "not yours", or the endpoint becomes an existence oracle.
    const { makePolicyDenial } = await import("@/domain/contracts/commands");
    return { ok: false, failure: makePolicyDenial(null, "Stock request is not accessible") };
  }

  const lineResult = await query(
    `SELECT l.id,
            l.product_sku_id,
            sku.sku_code,
            product.product_name,
            variant.variant_name,
            l.source_location_id,
            src.location_name AS source_location_name,
            l.requested_quantity,
            l.approved_quantity,
            l.reserved_quantity,
            l.dispatched_quantity,
            l.received_quantity
     FROM stock_request_lines l
     JOIN product_skus sku ON sku.id = l.product_sku_id
     JOIN product_variants variant ON variant.id = sku.product_variant_id
     JOIN products product ON product.id = variant.product_id
     LEFT JOIN stock_locations src ON src.id = l.source_location_id
     WHERE l.request_id = $1
     ORDER BY sku.sku_code ASC`,
    [String(row.id)],
  );

  const lines: StockRequestLineView[] = (lineResult.rows as Array<Record<string, unknown>>).map(
    (line) => ({
      lineId: String(line.id),
      productSkuId: String(line.product_sku_id),
      skuCode: String(line.sku_code ?? ""),
      productName: String(line.product_name ?? ""),
      sourceLocationId: line.source_location_id == null ? null : String(line.source_location_id),
      sourceLocationName:
        line.source_location_name == null ? null : String(line.source_location_name),
      requestedQuantity: num(line.requested_quantity),
      approvedQuantity: num(line.approved_quantity),
      reservedQuantity: num(line.reserved_quantity),
      dispatchedQuantity: num(line.dispatched_quantity),
      receivedQuantity: num(line.received_quantity),
    }),
  );

  const listRow = toListRow(actor, row);
  const allowedActions = resolveAllowedStockRequestActions(actor, {
    ...authorityFacts(row),
    status: listRow.status,
    lines: lines.map((line) => ({
      requested: line.requestedQuantity,
      approved: line.approvedQuantity,
      reserved: line.reservedQuantity,
      dispatched: line.dispatchedQuantity,
      received: line.receivedQuantity,
    })),
  });

  return {
    ok: true,
    request: {
      id: listRow.id,
      humanId: listRow.humanId,
      status: listRow.status,
      priority: listRow.priority,
      requiredBy: listRow.requiredBy,
      reason: listRow.reason,
      exceptionReason: listRow.exceptionReason,
      decisionReason: listRow.decisionReason,
      requesterName: listRow.requesterName,
      distributorAssignmentId: listRow.distributorAssignmentId,
      managerAssignmentId: listRow.managerAssignmentId,
      managerName: listRow.managerName,
      destinationLocationId: listRow.destinationLocationId,
      destinationLocationName: listRow.destinationLocationName,
      dealId: listRow.dealId,
      customerId: listRow.customerId,
      lines,
      allowedActions,
      nextOwnerLabel: listRow.nextOwnerLabel,
      version: listRow.version,
      createdAt: listRow.createdAt,
      updatedAt: listRow.updatedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export type InventoryBalanceFilters = {
  locationId?: string | null;
  productSkuId?: string | null;
  /** Hide (SKU, location) pairs that hold nothing at all. */
  nonZeroOnly?: boolean;
  limit?: number;
  offset?: number;
};

export async function listInventoryBalances(
  actor: DistributionActor,
  filters: InventoryBalanceFilters = {},
  deps: DistributionQueryDeps = {},
): Promise<DistributionReadResult<InventoryBalanceView>> {
  const authorized = await authorizeDistribution(actor, "read", deps);
  if (!authorized.ok) return authorized;

  const builder = createParamBuilder();
  const scope = stockLocationScopePredicate(actor, "loc", builder.next());
  builder.params.push(...scope.params);

  const conditions = [scope.clause];
  if (filters.locationId) conditions.push(`b.location_id = ${builder.add(filters.locationId)}`);
  if (filters.productSkuId) {
    conditions.push(`b.product_sku_id = ${builder.add(filters.productSkuId)}`);
  }
  if (filters.nonZeroOnly) {
    conditions.push(
      `(b.on_hand_quantity > 0 OR b.reserved_quantity > 0 OR b.damaged_quantity > 0 OR b.in_transit_quantity > 0)`,
    );
  }

  const limit = builder.add(boundedLimit(filters.limit));
  const offset = builder.add(boundedOffset(filters.offset));

  const { rows } = await runner(deps)(
    `SELECT b.product_sku_id,
            sku.sku_code,
            product.product_name,
            b.location_id,
            loc.location_name,
            loc.location_type,
            b.on_hand_quantity,
            b.reserved_quantity,
            b.damaged_quantity,
            b.in_transit_quantity,
            -- Derived, never stored: it cannot drift from its inputs.
            (b.on_hand_quantity - b.reserved_quantity - b.damaged_quantity) AS available_quantity,
            b.updated_at,
            COUNT(*) OVER () AS total_count
     FROM inventory_balances b
     JOIN stock_locations loc ON loc.id = b.location_id
     JOIN product_skus sku ON sku.id = b.product_sku_id
     JOIN product_variants variant ON variant.id = sku.product_variant_id
     JOIN products product ON product.id = variant.product_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY loc.location_name ASC, sku.sku_code ASC
     LIMIT ${limit} OFFSET ${offset}`,
    builder.params,
  );

  const typed = rows as Array<Record<string, unknown>>;
  return {
    ok: true,
    rows: typed.map((row) => ({
      productSkuId: String(row.product_sku_id),
      skuCode: String(row.sku_code ?? ""),
      productName: String(row.product_name ?? ""),
      locationId: String(row.location_id),
      locationName: String(row.location_name ?? ""),
      locationType: String(row.location_type) as InventoryBalanceView["locationType"],
      onHandQuantity: num(row.on_hand_quantity),
      reservedQuantity: num(row.reserved_quantity),
      // Recomputed from the same three numbers the row carries, so a stale
      // or hand-edited column could never present as available stock.
      availableQuantity: computeAvailableQuantity({
        onHand: num(row.on_hand_quantity),
        reserved: num(row.reserved_quantity),
        damaged: num(row.damaged_quantity),
      }),
      inTransitQuantity: num(row.in_transit_quantity),
      damagedQuantity: num(row.damaged_quantity),
      updatedAt: toIso(row.updated_at),
    })),
    total: totalFrom(typed, typed.length),
  };
}

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

export type InventoryMovementFilters = {
  requestId?: string | null;
  productSkuId?: string | null;
  locationId?: string | null;
  movementType?: InventoryMovementType | null;
  limit?: number;
  offset?: number;
};

export async function listInventoryMovements(
  actor: DistributionActor,
  filters: InventoryMovementFilters = {},
  deps: DistributionQueryDeps = {},
): Promise<DistributionReadResult<InventoryMovementView>> {
  const authorized = await authorizeDistribution(actor, "read", deps);
  if (!authorized.ok) return authorized;

  const builder = createParamBuilder();
  const sourceScope = stockLocationScopePredicate(actor, "src", builder.next());
  builder.params.push(...sourceScope.params);
  const destinationScope = stockLocationScopePredicate(actor, "dest", builder.next());
  builder.params.push(...destinationScope.params);

  // A movement is visible if EITHER end of it is in scope. A dispatch from a
  // warehouse the Distributor cannot see to a location it owns is still its
  // own inbound delivery, and hiding it would leave stock appearing from
  // nowhere.
  const conditions = [`(${sourceScope.clause} OR ${destinationScope.clause})`];
  if (filters.requestId) conditions.push(`m.request_id = ${builder.add(filters.requestId)}`);
  if (filters.productSkuId) {
    conditions.push(`m.product_sku_id = ${builder.add(filters.productSkuId)}`);
  }
  if (filters.locationId) {
    const placeholder = builder.add(filters.locationId);
    conditions.push(
      `(m.source_location_id = ${placeholder} OR m.destination_location_id = ${placeholder})`,
    );
  }
  if (filters.movementType) {
    conditions.push(`m.movement_type = ${builder.add(filters.movementType)}`);
  }

  const limit = builder.add(boundedLimit(filters.limit));
  const offset = builder.add(boundedOffset(filters.offset));

  const { rows } = await runner(deps)(
    `SELECT m.id,
            m.movement_type,
            m.created_at,
            m.product_sku_id,
            sku.sku_code,
            src.location_name AS source_location_name,
            dest.location_name AS destination_location_name,
            m.quantity,
            r.human_id AS request_human_id,
            actor.full_name AS actor_name,
            m.reason,
            COUNT(*) OVER () AS total_count
     FROM inventory_movements m
     JOIN product_skus sku ON sku.id = m.product_sku_id
     LEFT JOIN stock_locations src ON src.id = m.source_location_id
     LEFT JOIN stock_locations dest ON dest.id = m.destination_location_id
     LEFT JOIN stock_requests r ON r.id = m.request_id
     LEFT JOIN profiles actor ON actor.id = m.actor_user_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    builder.params,
  );

  const typed = rows as Array<Record<string, unknown>>;
  return {
    ok: true,
    rows: typed.map((row) => ({
      id: String(row.id),
      movementType: String(row.movement_type) as InventoryMovementType,
      occurredAt: toIso(row.created_at),
      productSkuId: String(row.product_sku_id),
      skuCode: String(row.sku_code ?? ""),
      sourceLocationName:
        row.source_location_name == null ? null : String(row.source_location_name),
      destinationLocationName:
        row.destination_location_name == null ? null : String(row.destination_location_name),
      quantity: num(row.quantity),
      requestHumanId: row.request_human_id == null ? null : String(row.request_human_id),
      actorName: row.actor_name == null ? null : String(row.actor_name),
      reason: row.reason == null ? null : String(row.reason),
    })),
    total: totalFrom(typed, typed.length),
  };
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export type DistributionExceptionFilters = {
  limit?: number;
  offset?: number;
};

export async function listDistributionExceptions(
  actor: DistributionActor,
  filters: DistributionExceptionFilters = {},
  deps: DistributionQueryDeps = {},
): Promise<DistributionReadResult<DistributionExceptionView>> {
  const authorized = await authorizeDistribution(actor, "read", deps);
  if (!authorized.ok) return authorized;

  const builder = createParamBuilder();
  const scope = stockRequestScopePredicate(actor, "r", builder.next());
  builder.params.push(...scope.params);

  const limit = builder.add(boundedLimit(filters.limit));
  const offset = builder.add(boundedOffset(filters.offset));

  const { rows } = await runner(deps)(
    `SELECT r.id,
            r.human_id,
            r.status,
            COALESCE(r.exception_reason, 'Reported without a stated reason') AS problem,
            EXTRACT(EPOCH FROM (now() - r.updated_at)) / 3600 AS age_hours,
            COUNT(*) OVER () AS total_count
     FROM stock_requests r
     WHERE ${scope.clause} AND r.status = 'exception'
     ORDER BY r.updated_at ASC
     LIMIT ${limit} OFFSET ${offset}`,
    builder.params,
  );

  const typed = rows as Array<Record<string, unknown>>;
  return {
    ok: true,
    rows: typed.map((row) => ({
      requestId: String(row.id),
      humanId: String(row.human_id),
      problem: String(row.problem ?? ""),
      currentOwnerLabel: nextOwnerLabel("exception"),
      ageHours: Math.round(num(row.age_hours) * 10) / 10,
      nextAction: "Resolve the exception back to the request's prior state, or cancel it.",
    })),
    total: totalFrom(typed, typed.length),
  };
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

export async function listRequestableProductSkus(
  actor: DistributionActor,
  query: string | null = null,
  deps: DistributionQueryDeps = {},
): Promise<DistributionReadResult<RequestableProductSkuView>> {
  const authorized = await authorizeDistribution(actor, "read", deps);
  if (!authorized.ok) return authorized;

  const builder = createParamBuilder();
  const conditions = [
    `sku.status = 'active'`,
    `sku.archived_at IS NULL`,
    `variant.status = 'active'`,
    `variant.archived_at IS NULL`,
    `product.status = 'active'`,
    `product.archived_at IS NULL`,
  ];

  // A structured contains-match on the SKU/product identity, not a free-text
  // search across records — §4 removed the unscoped search box, and this
  // narrows a picker the caller is already authorised to see.
  const trimmed = query?.trim();
  if (trimmed) {
    const placeholder = builder.add(`%${trimmed}%`);
    conditions.push(
      `(sku.sku_code ILIKE ${placeholder} OR product.product_name ILIKE ${placeholder})`,
    );
  }

  const limit = builder.add(boundedLimit(undefined));

  const { rows } = await runner(deps)(
    `SELECT sku.id AS product_sku_id,
            sku.sku_code,
            product.product_name,
            variant.variant_name,
            COUNT(*) OVER () AS total_count
     FROM product_skus sku
     JOIN product_variants variant ON variant.id = sku.product_variant_id
     JOIN products product ON product.id = variant.product_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY product.product_name ASC, sku.sku_code ASC
     LIMIT ${limit}`,
    builder.params,
  );

  const typed = rows as Array<Record<string, unknown>>;
  return {
    ok: true,
    rows: typed.map((row) => ({
      productSkuId: String(row.product_sku_id),
      skuCode: String(row.sku_code ?? ""),
      productName: String(row.product_name ?? ""),
      variantName: row.variant_name == null ? null : String(row.variant_name),
    })),
    total: totalFrom(typed, typed.length),
  };
}

export type StockLocationFilters = {
  /** Only locations the caller may send stock TO. */
  destinationsOnly?: boolean;
};

export async function listStockLocations(
  actor: DistributionActor,
  filters: StockLocationFilters = {},
  deps: DistributionQueryDeps = {},
): Promise<DistributionReadResult<StockLocationView>> {
  const authorized = await authorizeDistribution(actor, "read", deps);
  if (!authorized.ok) return authorized;

  const builder = createParamBuilder();
  const scope = filters.destinationsOnly
    ? destinationLocationScopePredicate(actor, "loc", builder.next())
    : stockLocationScopePredicate(actor, "loc", builder.next());
  builder.params.push(...scope.params);

  const { rows } = await runner(deps)(
    `SELECT loc.id,
            loc.location_code,
            loc.location_name,
            loc.location_type,
            loc.geography_node_id,
            loc.distributor_assignment_id,
            loc.custodian_assignment_id,
            loc.active,
            COUNT(*) OVER () AS total_count
     FROM stock_locations loc
     WHERE ${scope.clause}
     ORDER BY loc.location_name ASC`,
    builder.params,
  );

  const typed = rows as Array<Record<string, unknown>>;
  return {
    ok: true,
    rows: typed.map((row) => ({
      id: String(row.id),
      locationCode: String(row.location_code ?? ""),
      locationName: String(row.location_name ?? ""),
      locationType: String(row.location_type) as StockLocationView["locationType"],
      geographyNodeId: String(row.geography_node_id ?? ""),
      distributorAssignmentId:
        row.distributor_assignment_id == null ? null : String(row.distributor_assignment_id),
      custodianAssignmentId:
        row.custodian_assignment_id == null ? null : String(row.custodian_assignment_id),
      active: Boolean(row.active),
    })),
    total: totalFrom(typed, typed.length),
  };
}

// ---------------------------------------------------------------------------
// Administration options
// ---------------------------------------------------------------------------

/**
 * The pickers the Super Admin location form needs.
 *
 * Super Admin only, and it returns a label plus an opaque id — never the
 * assignment's tenant, partner, or geography ceiling. Without it the form
 * would have to ask an operator to type an assignment id from memory, which
 * is how a location ends up owned by the wrong Distributor.
 */
export async function listDistributionAdminOptions(
  actor: DistributionActor,
  deps: DistributionQueryDeps = {},
): Promise<
  | { ok: true; options: DistributionAdminOptions }
  | { ok: false; failure: PolicyDenialErrorContract }
> {
  const authorized = await authorizeDistribution(actor, "create", deps);
  if (!authorized.ok) return authorized;

  const { makePolicyDenial } = await import("@/domain/contracts/commands");
  if (actor.assignment.roleKey !== "super_admin") {
    return {
      ok: false,
      failure: makePolicyDenial(null, "Only Super Admin can administer stock locations"),
    };
  }

  const query = runner(deps);

  const [geography, assignments] = await Promise.all([
    query(
      `SELECT node_id, display_name, node_type::text AS node_type
       FROM geography_nodes
       WHERE valid_to IS NULL AND node_type IN ('global', 'sales_region', 'country')
       ORDER BY
         CASE node_type::text
           WHEN 'global' THEN 0
           WHEN 'sales_region' THEN 1
           ELSE 2
         END,
         display_name ASC
       LIMIT 500`,
    ),
    query(
      `SELECT a.assignment_id, a.role_key, p.full_name, p.email
       FROM assignments a
       JOIN profiles p ON p.id = a.user_id
       WHERE a.status = 'active'
         AND a.role_key IN ('restricted_distributor', 'rm', 'pam', 'super_admin')
       ORDER BY p.full_name ASC
       LIMIT 500`,
    ),
  ]);

  const assignmentRows = assignments.rows as Array<Record<string, unknown>>;
  const label = (row: Record<string, unknown>) =>
    `${String(row.full_name ?? row.email ?? "Unnamed")} · ${String(row.role_key)}`;

  return {
    ok: true,
    options: {
      geographyNodes: (geography.rows as Array<Record<string, unknown>>).map((row) => ({
        nodeId: String(row.node_id),
        label: `${String(row.display_name)} (${String(row.node_type)})`,
      })),
      distributorAssignments: assignmentRows
        .filter((row) => String(row.role_key) === "restricted_distributor")
        .map((row) => ({ assignmentId: String(row.assignment_id), label: label(row) })),
      custodianAssignments: assignmentRows
        .filter((row) => String(row.role_key) !== "restricted_distributor")
        .map((row) => ({ assignmentId: String(row.assignment_id), label: label(row) })),
    },
  };
}

export { EMPTY_ADMIN_OPTIONS };
export type { DistributionAdminOptions };
