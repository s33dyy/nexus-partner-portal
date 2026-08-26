/**
 * Distribution (DMS) domain contract — product.md §24.
 *
 * Pure and dependency-free on purpose. Every rule in here is one the server
 * enforces inside a transaction and the browser needs to render, so it must
 * be evaluable in both places without a database, a pool, or a governed
 * actor. Nothing here reads or writes; the transaction boundary lives in
 * server/distribution-commands.server.ts.
 */

// ---------------------------------------------------------------------------
// Statuses and transitions
// ---------------------------------------------------------------------------

export const STOCK_REQUEST_STATUSES = [
  "submitted",
  "approved",
  "awaiting_stock",
  "partially_allocated",
  "allocated",
  "dispatched",
  "partially_received",
  "received",
  "exception",
  "rejected",
  "cancelled",
] as const;

export type StockRequestStatus = (typeof STOCK_REQUEST_STATUSES)[number];

export const TERMINAL_STOCK_REQUEST_STATUSES = ["received", "rejected", "cancelled"] as const;

export type TerminalStockRequestStatus = (typeof TERMINAL_STOCK_REQUEST_STATUSES)[number];

/**
 * The complete transition table (§24.3.2). A pair absent from this map is
 * rejected — including every self-transition and every exit from a terminal
 * status, which is why the three terminal entries are explicitly empty
 * rather than omitted.
 *
 * `exception` can return to any non-terminal working state because recovery
 * puts a request back where it actually was, and can be cancelled because a
 * request that broke before dispatch may still be abandoned. It cannot go
 * straight to `received` or `rejected`: both of those are decisions, and a
 * decision is made by its own command with its own authority check.
 */
export const STOCK_REQUEST_TRANSITIONS: Record<StockRequestStatus, readonly StockRequestStatus[]> =
  {
    submitted: ["approved", "rejected", "cancelled", "exception"],
    approved: ["awaiting_stock", "partially_allocated", "allocated", "cancelled", "exception"],
    awaiting_stock: ["partially_allocated", "allocated", "cancelled", "exception"],
    partially_allocated: ["allocated", "dispatched", "cancelled", "exception"],
    allocated: ["dispatched", "cancelled", "exception"],
    dispatched: ["partially_received", "received", "exception"],
    partially_received: ["received", "exception"],
    exception: [
      // "submitted" belongs here: a problem can be reported before the manager
      // has decided anything, and recovery has to be able to put the request
      // back where it was. Omitting it made that one case unrecoverable — the
      // request could not be resolved (the assert threw), reviewed (wrong
      // status), or progressed, leaving cancellation as the only exit.
      "submitted",
      "approved",
      "awaiting_stock",
      "partially_allocated",
      "allocated",
      "dispatched",
      "partially_received",
      "cancelled",
    ],
    received: [],
    rejected: [],
    cancelled: [],
  };

export function isStockRequestStatus(value: string): value is StockRequestStatus {
  return (STOCK_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function isTerminalStockRequestStatus(status: StockRequestStatus): boolean {
  return (TERMINAL_STOCK_REQUEST_STATUSES as readonly string[]).includes(status);
}

export function isAllowedStockRequestTransition(
  from: StockRequestStatus,
  to: StockRequestStatus,
): boolean {
  if (!isStockRequestStatus(from) || !isStockRequestStatus(to)) return false;
  return STOCK_REQUEST_TRANSITIONS[from].includes(to);
}

export function assertStockRequestTransition(
  from: StockRequestStatus,
  to: StockRequestStatus,
): void {
  if (!isAllowedStockRequestTransition(from, to)) {
    throw new Error(`A stock request cannot move from "${from}" to "${to}"`);
  }
}

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

export const INVENTORY_MOVEMENT_TYPES = [
  "opening_balance",
  "receipt",
  "reservation",
  "reservation_release",
  "dispatch",
  "delivery",
  "transfer",
  "damage",
  "adjustment",
] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export type MovementEndpointRule = "required" | "forbidden" | "optional";

/**
 * Which endpoints each movement type may name.
 *
 * `adjustment` is the only "optional/optional" type — a correction can add
 * at a destination or remove at a source — so it carries the extra rule that
 * at least one endpoint must be present, checked below.
 */
export const MOVEMENT_ENDPOINT_RULES: Record<
  InventoryMovementType,
  { source: MovementEndpointRule; destination: MovementEndpointRule }
> = {
  opening_balance: { source: "forbidden", destination: "required" },
  receipt: { source: "forbidden", destination: "required" },
  reservation: { source: "required", destination: "forbidden" },
  reservation_release: { source: "required", destination: "forbidden" },
  dispatch: { source: "required", destination: "required" },
  delivery: { source: "required", destination: "required" },
  transfer: { source: "required", destination: "required" },
  damage: { source: "required", destination: "forbidden" },
  adjustment: { source: "optional", destination: "optional" },
};

export function isInventoryMovementType(value: string): value is InventoryMovementType {
  return (INVENTORY_MOVEMENT_TYPES as readonly string[]).includes(value);
}

/** Movement types that require a human-supplied reason, because nothing else
 * in the system explains why the number changed. The request-driven types
 * (reservation, dispatch, delivery, and their release) are explained by the
 * request line they settle. */
export const REASON_REQUIRED_MOVEMENT_TYPES = [
  "opening_balance",
  "receipt",
  "transfer",
  "damage",
  "adjustment",
] as const satisfies readonly InventoryMovementType[];

export function movementRequiresReason(type: InventoryMovementType): boolean {
  return (REASON_REQUIRED_MOVEMENT_TYPES as readonly string[]).includes(type);
}

export function assertMovementEndpoints(
  type: InventoryMovementType,
  endpoints: { sourceLocationId: string | null; destinationLocationId: string | null },
): void {
  const rule = MOVEMENT_ENDPOINT_RULES[type];
  if (!rule) {
    throw new Error(`Unknown inventory movement type: ${type}`);
  }

  const source = endpoints.sourceLocationId?.trim() || null;
  const destination = endpoints.destinationLocationId?.trim() || null;
  const article = /^[aeiou]/i.test(type) ? "An" : "A";

  if (rule.source === "required" && !source) {
    throw new Error(`${article} "${type}" movement requires a source location`);
  }
  if (rule.source === "forbidden" && source) {
    throw new Error(`${article} "${type}" movement must not name a source location`);
  }
  if (rule.destination === "required" && !destination) {
    throw new Error(`${article} "${type}" movement requires a destination location`);
  }
  if (rule.destination === "forbidden" && destination) {
    throw new Error(`${article} "${type}" movement must not name a destination location`);
  }
  if (rule.source === "optional" && rule.destination === "optional" && !source && !destination) {
    throw new Error(`${article} "${type}" movement requires a source or a destination location`);
  }
  if (source && destination && source === destination) {
    throw new Error(
      `${article} "${type}" movement cannot use the same location as source and destination`,
    );
  }
}

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

function isWholeNumber(value: number): boolean {
  return Number.isSafeInteger(value);
}

export function assertPositiveStockQuantity(value: number, label = "Quantity"): void {
  if (!isWholeNumber(value) || value <= 0) {
    throw new Error(`${label} must be a positive whole number`);
  }
}

export function assertNonNegativeStockQuantity(value: number, label = "Quantity"): void {
  if (!isWholeNumber(value) || value < 0) {
    throw new Error(`${label} must be a non-negative whole number`);
  }
}

export type StockLineQuantities = {
  requested: number;
  approved: number;
  reserved: number;
  dispatched: number;
  received: number;
};

/**
 * The whole quantity ladder for one request line (§24.3).
 *
 * Each rung is bounded by the one above it, so a line can never claim more
 * was shipped than was reserved or more arrived than was shipped. The
 * database carries the same four CHECK constraints; this exists so the
 * refusal happens before a transaction opens and so the browser can show
 * the reason next to the field.
 */
export function assertStockLineQuantities(quantities: StockLineQuantities): void {
  assertPositiveStockQuantity(quantities.requested, "Requested quantity");
  assertNonNegativeStockQuantity(quantities.approved, "Approved quantity");
  assertNonNegativeStockQuantity(quantities.reserved, "Reserved quantity");
  assertNonNegativeStockQuantity(quantities.dispatched, "Dispatched quantity");
  assertNonNegativeStockQuantity(quantities.received, "Received quantity");

  if (quantities.approved > quantities.requested) {
    throw new Error("Approved quantity cannot exceed requested quantity");
  }
  if (quantities.reserved > quantities.approved) {
    throw new Error("Reserved quantity cannot exceed approved quantity");
  }
  if (quantities.dispatched > quantities.reserved) {
    throw new Error("Dispatched quantity cannot exceed reserved quantity");
  }
  if (quantities.received > quantities.dispatched) {
    throw new Error("Received quantity cannot exceed dispatched quantity");
  }
}

export type InventoryBalanceQuantities = {
  onHand: number;
  reserved: number;
  damaged: number;
};

/**
 * §24.2: available is derived, never stored, so it cannot drift from its
 * inputs. Clamped at zero because a negative available would read as "we owe
 * stock", which this model does not represent — the database CHECKs make it
 * unreachable, and this keeps a corrupt row from rendering as one.
 */
export function computeAvailableQuantity(balance: InventoryBalanceQuantities): number {
  return Math.max(0, balance.onHand - balance.reserved - balance.damaged);
}

export function assertInventoryBalance(balance: InventoryBalanceQuantities): void {
  assertNonNegativeStockQuantity(balance.onHand, "On-hand quantity");
  assertNonNegativeStockQuantity(balance.reserved, "Reserved quantity");
  assertNonNegativeStockQuantity(balance.damaged, "Damaged quantity");
  if (balance.reserved + balance.damaged > balance.onHand) {
    throw new Error("Reserved and damaged quantities cannot exceed the on-hand quantity");
  }
}

// ---------------------------------------------------------------------------
// Derived status and cancellation
// ---------------------------------------------------------------------------

function sumBy(
  lines: readonly StockLineQuantities[],
  pick: (line: StockLineQuantities) => number,
): number {
  return lines.reduce((total, line) => total + pick(line), 0);
}

/**
 * §24.3.3. First matching rule wins. No client ever writes the header
 * status; it is recomputed from the lines after every quantity change, so
 * the header and the lines cannot disagree.
 */
export function deriveStockRequestStatus(
  lines: readonly StockLineQuantities[],
): StockRequestStatus {
  if (lines.length === 0) {
    throw new Error("A stock request must have at least one line");
  }
  for (const line of lines) assertStockLineQuantities(line);

  const approved = sumBy(lines, (line) => line.approved);
  const reserved = sumBy(lines, (line) => line.reserved);
  const dispatched = sumBy(lines, (line) => line.dispatched);
  const received = sumBy(lines, (line) => line.received);

  if (approved > 0 && lines.every((line) => line.received === line.approved)) return "received";
  if (received > 0) return "partially_received";
  if (dispatched > 0) return "dispatched";
  if (approved > 0 && lines.every((line) => line.reserved === line.approved)) return "allocated";
  if (reserved > 0) return "partially_allocated";
  return "awaiting_stock";
}

/**
 * §24.3.2: cancellation is a withdrawal, and you cannot withdraw goods that
 * are already on a van. Once any unit has been dispatched the request can
 * only move forward to receipt or sideways to `exception`.
 */
export function canCancelStockRequest(
  status: StockRequestStatus,
  lines: readonly StockLineQuantities[],
): boolean {
  if (!isAllowedStockRequestTransition(status, "cancelled")) return false;
  return sumBy(lines, (line) => line.dispatched) === 0;
}

export function assertStockRequestCancellable(
  status: StockRequestStatus,
  lines: readonly StockLineQuantities[],
): void {
  if (sumBy(lines, (line) => line.dispatched) > 0) {
    throw new Error("A stock request cannot be cancelled once any unit has been dispatched");
  }
  assertStockRequestTransition(status, "cancelled");
}

// ---------------------------------------------------------------------------
// Command inputs
// ---------------------------------------------------------------------------

export const STOCK_REQUEST_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type StockRequestPriority = (typeof STOCK_REQUEST_PRIORITIES)[number];

export function isStockRequestPriority(value: string): value is StockRequestPriority {
  return (STOCK_REQUEST_PRIORITIES as readonly string[]).includes(value);
}

/** Hours a manager has to decide, by priority. Drives the approval Task's
 * due date and therefore the escalation sweep (§24.5.2). */
export const APPROVAL_SLA_HOURS: Record<StockRequestPriority, number> = {
  urgent: 4,
  high: 12,
  medium: 48,
  low: 96,
};

export const STOCK_LOCATION_TYPES = ["livey_warehouse", "distributor"] as const;
export type StockLocationType = (typeof STOCK_LOCATION_TYPES)[number];

export type SubmitStockRequestInput = {
  destinationLocationId: string;
  dealId?: string | null;
  customerId?: string | null;
  requiredBy: string;
  priority: StockRequestPriority;
  reason: string;
  lines: Array<{ productSkuId: string; quantity: number }>;
  idempotencyKey: string;
};

export type ReviewStockRequestInput = {
  requestId: string;
  expectedVersion: number;
  decision: "approve" | "reject";
  reason: string;
  lines: Array<{
    lineId: string;
    approvedQuantity: number;
    sourceLocationId: string | null;
  }>;
};

export type AllocateStockRequestInput = {
  requestId: string;
  expectedVersion: number;
  lines: Array<{ lineId: string; quantity: number }>;
  idempotencyKey: string;
};

export type DispatchStockRequestInput = {
  requestId: string;
  expectedVersion: number;
  lines: Array<{ lineId: string; quantity: number }>;
  reference?: string | null;
  idempotencyKey: string;
};

export type ReceiveStockRequestInput = {
  requestId: string;
  expectedVersion: number;
  lines: Array<{ lineId: string; quantity: number }>;
  idempotencyKey: string;
};

export type CancelStockRequestInput = {
  requestId: string;
  expectedVersion: number;
  reason: string;
};

export type StockRequestExceptionInput = {
  requestId: string;
  expectedVersion: number;
  reason: string;
};

export type CreateStockLocationInput = {
  locationCode: string;
  locationName: string;
  locationType: StockLocationType;
  geographyNodeId: string;
  distributorAssignmentId?: string | null;
  custodianAssignmentId?: string | null;
};

export type PostManualStockMovementInput = {
  movementType: InventoryMovementType;
  productSkuId: string;
  sourceLocationId?: string | null;
  destinationLocationId?: string | null;
  quantity: number;
  reason: string;
  idempotencyKey: string;
};

/** Validates a submission's shape before any transaction opens: at least one
 * line, no repeated SKU, positive integer quantities, a real date, and a
 * reason someone can read later. */
export function assertSubmitStockRequestInput(input: SubmitStockRequestInput): void {
  if (!input.destinationLocationId?.trim()) {
    throw new Error("A destination location is required");
  }
  if (!input.idempotencyKey?.trim()) {
    throw new Error("A request key is required");
  }
  if (!input.reason?.trim()) {
    throw new Error("A reason is required");
  }
  if (!isStockRequestPriority(input.priority)) {
    throw new Error("A valid priority is required");
  }
  if (Number.isNaN(new Date(input.requiredBy).getTime())) {
    throw new Error("A valid required-by date is required");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("A stock request must have at least one line");
  }
  const seen = new Set<string>();
  for (const line of input.lines) {
    const skuId = line.productSkuId?.trim();
    if (!skuId) throw new Error("Every line must name a product SKU");
    if (seen.has(skuId)) {
      throw new Error("A product SKU can appear only once on a stock request");
    }
    seen.add(skuId);
    assertPositiveStockQuantity(line.quantity, "Requested quantity");
  }
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

/** Actions the server has decided this actor may take on this request. The
 * workspace renders from this array and never from a role name; every
 * command re-checks the same authority server-side regardless. */
export const STOCK_REQUEST_ACTIONS = [
  "review",
  "allocate",
  "dispatch",
  "receive",
  "cancel",
  "report_exception",
  "resolve_exception",
] as const;

export type StockRequestAction = (typeof STOCK_REQUEST_ACTIONS)[number];

export type StockRequestLineView = {
  lineId: string;
  productSkuId: string;
  skuCode: string;
  productName: string;
  sourceLocationId: string | null;
  sourceLocationName: string | null;
  requestedQuantity: number;
  approvedQuantity: number;
  reservedQuantity: number;
  dispatchedQuantity: number;
  receivedQuantity: number;
};

export type StockRequestView = {
  id: string;
  humanId: string;
  status: StockRequestStatus;
  priority: StockRequestPriority;
  requiredBy: string;
  reason: string;
  exceptionReason: string | null;
  decisionReason: string | null;
  requesterName: string | null;
  distributorAssignmentId: string;
  managerAssignmentId: string;
  managerName: string | null;
  destinationLocationId: string;
  destinationLocationName: string;
  dealId: string | null;
  customerId: string | null;
  lines: StockRequestLineView[];
  allowedActions: StockRequestAction[];
  nextOwnerLabel: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type InventoryBalanceView = {
  productSkuId: string;
  skuCode: string;
  productName: string;
  locationId: string;
  locationName: string;
  locationType: StockLocationType;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  inTransitQuantity: number;
  damagedQuantity: number;
  updatedAt: string;
};

export type InventoryMovementView = {
  id: string;
  movementType: InventoryMovementType;
  occurredAt: string;
  productSkuId: string;
  skuCode: string;
  sourceLocationName: string | null;
  destinationLocationName: string | null;
  quantity: number;
  requestHumanId: string | null;
  actorName: string | null;
  reason: string | null;
};

export type StockLocationView = {
  id: string;
  locationCode: string;
  locationName: string;
  locationType: StockLocationType;
  geographyNodeId: string;
  distributorAssignmentId: string | null;
  custodianAssignmentId: string | null;
  active: boolean;
};

export type RequestableProductSkuView = {
  productSkuId: string;
  skuCode: string;
  productName: string;
  variantName: string | null;
};

/**
 * The pickers the Super Admin location form needs.
 *
 * Lives in the contract rather than beside the query that produces it because
 * the browser needs the empty value as a fail-closed default, and importing
 * it from a `.server` module would drag the whole server graph — pool, policy,
 * queries — into the client bundle. Vite's import protection rejects exactly
 * that, which is how this landed here.
 */
export type DistributionAdminOptions = {
  geographyNodes: Array<{ nodeId: string; label: string }>;
  distributorAssignments: Array<{ assignmentId: string; label: string }>;
  custodianAssignments: Array<{ assignmentId: string; label: string }>;
};

/** What an actor who may not administer locations gets: nothing to pick. */
export const EMPTY_ADMIN_OPTIONS: DistributionAdminOptions = {
  geographyNodes: [],
  distributorAssignments: [],
  custodianAssignments: [],
};

export type DistributionExceptionView = {
  requestId: string;
  humanId: string;
  problem: string;
  currentOwnerLabel: string | null;
  ageHours: number;
  nextAction: string;
};

/** Progress across a request's whole ladder, for the workspace's progress
 * column. Percentages are of approved units, because requested-but-not-
 * approved units were never promised to anybody. */
export function stockRequestProgress(lines: readonly StockLineQuantities[]): {
  approved: number;
  reserved: number;
  dispatched: number;
  received: number;
  receivedPercent: number;
} {
  const approved = sumBy(lines, (line) => line.approved);
  const reserved = sumBy(lines, (line) => line.reserved);
  const dispatched = sumBy(lines, (line) => line.dispatched);
  const received = sumBy(lines, (line) => line.received);
  return {
    approved,
    reserved,
    dispatched,
    received,
    receivedPercent: approved === 0 ? 0 : Math.round((received / approved) * 100),
  };
}
