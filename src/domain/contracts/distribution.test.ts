import { expect, test } from "bun:test";

import {
  INVENTORY_MOVEMENT_TYPES,
  MOVEMENT_ENDPOINT_RULES,
  STOCK_REQUEST_STATUSES,
  STOCK_REQUEST_TRANSITIONS,
  TERMINAL_STOCK_REQUEST_STATUSES,
  assertMovementEndpoints,
  assertPositiveStockQuantity,
  assertStockRequestCancellable,
  assertStockRequestTransition,
  assertStockLineQuantities,
  canCancelStockRequest,
  computeAvailableQuantity,
  deriveStockRequestStatus,
  isAllowedStockRequestTransition,
  isTerminalStockRequestStatus,
  type StockLineQuantities,
  type StockRequestStatus,
} from "@/domain/contracts/distribution";

function lines(...quantities: Array<Partial<StockLineQuantities>>): StockLineQuantities[] {
  return quantities.map((quantity) => ({
    requested: 0,
    approved: 0,
    reserved: 0,
    dispatched: 0,
    received: 0,
    ...quantity,
  }));
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

test("every listed transition is accepted", () => {
  for (const from of STOCK_REQUEST_STATUSES) {
    for (const to of STOCK_REQUEST_TRANSITIONS[from]) {
      expect(isAllowedStockRequestTransition(from, to)).toBe(true);
      expect(() => assertStockRequestTransition(from, to)).not.toThrow();
    }
  }
});

test("every unlisted transition is rejected", () => {
  for (const from of STOCK_REQUEST_STATUSES) {
    const allowed = new Set<StockRequestStatus>(STOCK_REQUEST_TRANSITIONS[from]);
    for (const to of STOCK_REQUEST_STATUSES) {
      if (allowed.has(to)) continue;
      expect(isAllowedStockRequestTransition(from, to)).toBe(false);
      expect(() => assertStockRequestTransition(from, to)).toThrow(
        `A stock request cannot move from "${from}" to "${to}"`,
      );
    }
  }
});

test("a self-transition is never allowed", () => {
  for (const status of STOCK_REQUEST_STATUSES) {
    expect(isAllowedStockRequestTransition(status, status)).toBe(false);
  }
});

test("terminal statuses have no exit", () => {
  for (const status of TERMINAL_STOCK_REQUEST_STATUSES) {
    expect(isTerminalStockRequestStatus(status)).toBe(true);
    expect(STOCK_REQUEST_TRANSITIONS[status]).toHaveLength(0);
  }
  expect(isTerminalStockRequestStatus("submitted")).toBe(false);
  expect(isTerminalStockRequestStatus("exception")).toBe(false);
});

test("an unknown status is rejected rather than silently allowed", () => {
  expect(isAllowedStockRequestTransition("not_a_status" as StockRequestStatus, "approved")).toBe(
    false,
  );
  expect(isAllowedStockRequestTransition("submitted", "not_a_status" as StockRequestStatus)).toBe(
    false,
  );
});

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

test("available is on hand less reserved and damaged", () => {
  expect(computeAvailableQuantity({ onHand: 10, reserved: 3, damaged: 2 })).toBe(5);
  expect(computeAvailableQuantity({ onHand: 4, reserved: 4, damaged: 0 })).toBe(0);
});

test("available never reports a negative number even from an inconsistent projection", () => {
  // A negative available would read as "we owe stock", which is not a thing
  // this model represents; the balance checks make it unreachable in the
  // database, and this keeps a corrupt row from rendering as one.
  expect(computeAvailableQuantity({ onHand: 1, reserved: 5, damaged: 0 })).toBe(0);
});

test("quantities must be positive safe integers", () => {
  expect(() => assertPositiveStockQuantity(1)).not.toThrow();
  expect(() => assertPositiveStockQuantity(0)).toThrow("Quantity must be a positive whole number");
  expect(() => assertPositiveStockQuantity(-1)).toThrow("Quantity must be a positive whole number");
  expect(() => assertPositiveStockQuantity(1.5)).toThrow(
    "Quantity must be a positive whole number",
  );
  expect(() => assertPositiveStockQuantity(Number.NaN)).toThrow(
    "Quantity must be a positive whole number",
  );
  expect(() => assertPositiveStockQuantity(Number.POSITIVE_INFINITY)).toThrow(
    "Quantity must be a positive whole number",
  );
  expect(() => assertPositiveStockQuantity(Number.MAX_SAFE_INTEGER + 2)).toThrow(
    "Quantity must be a positive whole number",
  );
});

test("approved quantity cannot exceed requested quantity", () => {
  expect(() =>
    assertStockLineQuantities({
      requested: 5,
      approved: 6,
      reserved: 0,
      dispatched: 0,
      received: 0,
    }),
  ).toThrow("Approved quantity cannot exceed requested quantity");
});

test("reserved quantity cannot exceed approved quantity", () => {
  expect(() =>
    assertStockLineQuantities({
      requested: 5,
      approved: 3,
      reserved: 4,
      dispatched: 0,
      received: 0,
    }),
  ).toThrow("Reserved quantity cannot exceed approved quantity");
});

test("dispatched quantity cannot exceed reserved quantity", () => {
  expect(() =>
    assertStockLineQuantities({
      requested: 5,
      approved: 5,
      reserved: 2,
      dispatched: 3,
      received: 0,
    }),
  ).toThrow("Dispatched quantity cannot exceed reserved quantity");
});

test("received quantity cannot exceed dispatched quantity", () => {
  expect(() =>
    assertStockLineQuantities({
      requested: 5,
      approved: 5,
      reserved: 5,
      dispatched: 3,
      received: 4,
    }),
  ).toThrow("Received quantity cannot exceed dispatched quantity");
});

test("a requested quantity of zero or less is rejected", () => {
  expect(() =>
    assertStockLineQuantities({
      requested: 0,
      approved: 0,
      reserved: 0,
      dispatched: 0,
      received: 0,
    }),
  ).toThrow("Requested quantity must be a positive whole number");
});

test("a negative settled quantity is rejected", () => {
  expect(() =>
    assertStockLineQuantities({
      requested: 5,
      approved: -1,
      reserved: 0,
      dispatched: 0,
      received: 0,
    }),
  ).toThrow("Approved quantity must be a non-negative whole number");
});

test("a fully consistent ladder is accepted", () => {
  expect(() =>
    assertStockLineQuantities({
      requested: 5,
      approved: 5,
      reserved: 5,
      dispatched: 5,
      received: 5,
    }),
  ).not.toThrow();
});

// ---------------------------------------------------------------------------
// Derived status
// ---------------------------------------------------------------------------

test("header status derives deterministically from line quantities", () => {
  expect(deriveStockRequestStatus(lines({ requested: 5, approved: 5 }))).toBe("awaiting_stock");
  expect(deriveStockRequestStatus(lines({ requested: 5, approved: 5, reserved: 3 }))).toBe(
    "partially_allocated",
  );
  expect(deriveStockRequestStatus(lines({ requested: 5, approved: 5, reserved: 5 }))).toBe(
    "allocated",
  );
  expect(
    deriveStockRequestStatus(lines({ requested: 5, approved: 5, reserved: 5, dispatched: 5 })),
  ).toBe("dispatched");
  // No partially_dispatched state: in-transit units make the header say
  // dispatched and the line quantities carry the detail.
  expect(
    deriveStockRequestStatus(lines({ requested: 5, approved: 5, reserved: 5, dispatched: 3 })),
  ).toBe("dispatched");
  expect(
    deriveStockRequestStatus(
      lines({ requested: 5, approved: 5, reserved: 5, dispatched: 5, received: 3 }),
    ),
  ).toBe("partially_received");
  expect(
    deriveStockRequestStatus(
      lines({ requested: 5, approved: 5, reserved: 5, dispatched: 5, received: 5 }),
    ),
  ).toBe("received");
});

test("received requires every approved unit, not merely every dispatched unit", () => {
  // Line one is fully received; line two was approved but never fulfilled.
  // Closing this request as received would strand the second line forever.
  const status = deriveStockRequestStatus(
    lines(
      { requested: 5, approved: 5, reserved: 5, dispatched: 5, received: 5 },
      { requested: 3, approved: 3 },
    ),
  );
  expect(status).toBe("partially_received");
});

test("derived status validates its lines and rejects an empty request", () => {
  expect(() => deriveStockRequestStatus([])).toThrow("A stock request must have at least one line");
  expect(() =>
    deriveStockRequestStatus(lines({ requested: 2, approved: 2, reserved: 2, received: 1 })),
  ).toThrow("Received quantity cannot exceed dispatched quantity");
});

// ---------------------------------------------------------------------------
// Cancellation boundary
// ---------------------------------------------------------------------------

test("cancellation is permitted before any dispatch and refused after", () => {
  const undispatched = lines({ requested: 5, approved: 5, reserved: 5 });
  expect(canCancelStockRequest("allocated", undispatched)).toBe(true);
  expect(() => assertStockRequestCancellable("allocated", undispatched)).not.toThrow();

  const partiallyDispatched = lines({
    requested: 5,
    approved: 5,
    reserved: 5,
    dispatched: 1,
  });
  expect(canCancelStockRequest("dispatched", partiallyDispatched)).toBe(false);
  expect(() => assertStockRequestCancellable("dispatched", partiallyDispatched)).toThrow(
    "A stock request cannot be cancelled once any unit has been dispatched",
  );
});

test("a terminal request cannot be cancelled again", () => {
  const settled = lines({ requested: 1, approved: 1, reserved: 1, dispatched: 1, received: 1 });
  expect(canCancelStockRequest("received", settled)).toBe(false);
  expect(canCancelStockRequest("cancelled", lines({ requested: 1 }))).toBe(false);
  expect(canCancelStockRequest("rejected", lines({ requested: 1 }))).toBe(false);
});

// ---------------------------------------------------------------------------
// Movement endpoints
// ---------------------------------------------------------------------------

test("every movement type declares its endpoint rule", () => {
  for (const type of INVENTORY_MOVEMENT_TYPES) {
    expect(MOVEMENT_ENDPOINT_RULES[type]).toBeDefined();
  }
});

test("movement endpoints are enforced per type", () => {
  expect(() =>
    assertMovementEndpoints("opening_balance", {
      sourceLocationId: null,
      destinationLocationId: "loc-1",
    }),
  ).not.toThrow();
  expect(() =>
    assertMovementEndpoints("opening_balance", {
      sourceLocationId: "loc-1",
      destinationLocationId: "loc-2",
    }),
  ).toThrow('An "opening_balance" movement must not name a source location');
  expect(() =>
    assertMovementEndpoints("dispatch", { sourceLocationId: "loc-1", destinationLocationId: null }),
  ).toThrow('A "dispatch" movement requires a destination location');
  expect(() =>
    assertMovementEndpoints("reservation", {
      sourceLocationId: "loc-1",
      destinationLocationId: null,
    }),
  ).not.toThrow();
  expect(() =>
    assertMovementEndpoints("transfer", {
      sourceLocationId: "loc-1",
      destinationLocationId: "loc-1",
    }),
  ).toThrow('A "transfer" movement cannot use the same location as source and destination');
  expect(() =>
    assertMovementEndpoints("adjustment", {
      sourceLocationId: null,
      destinationLocationId: null,
    }),
  ).toThrow('An "adjustment" movement requires a source or a destination location');
});
