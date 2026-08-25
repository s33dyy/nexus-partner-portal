import { expect, test } from "bun:test";

import { STOCK_REQUEST_STATUSES, INVENTORY_MOVEMENT_TYPES } from "@/domain/contracts/distribution";
import {
  buildStockRequestFilters,
  hasAction,
  movementTypeLabel,
  movementTypeTone,
  newRequestForCustomerUrl,
  newRequestForDealUrl,
  parseDistributionSearch,
  requestProgressLabel,
  requestProgressPercent,
  stockRequestStatusLabel,
  stockRequestStatusTone,
  trackMovementsForRequestUrl,
} from "@/components/distribution/distribution-view";

test("every status and movement type has a label and a tone", () => {
  for (const status of STOCK_REQUEST_STATUSES) {
    expect(stockRequestStatusLabel(status)).not.toBe(status);
    expect(stockRequestStatusTone(status)).toBeTruthy();
  }
  for (const movementType of INVENTORY_MOVEMENT_TYPES) {
    expect(movementTypeLabel(movementType)).not.toBe(movementType);
    expect(movementTypeTone(movementType)).toBeTruthy();
  }
});

test("an unknown status renders neutrally instead of throwing", () => {
  expect(stockRequestStatusLabel("who_knows")).toBe("who_knows");
  expect(stockRequestStatusTone("who_knows")).toBe("neutral");
  expect(movementTypeTone("teleport")).toBe("neutral");
});

test("progress is a fraction of approved units, never of requested ones", () => {
  // Ten requested, four approved, four received: this request is done.
  expect(
    requestProgressPercent({
      requestedTotal: 10,
      approvedTotal: 4,
      reservedTotal: 4,
      dispatchedTotal: 4,
      receivedTotal: 4,
    }),
  ).toBe(100);

  expect(
    requestProgressPercent({
      requestedTotal: 10,
      approvedTotal: 10,
      reservedTotal: 5,
      dispatchedTotal: 5,
      receivedTotal: 5,
    }),
  ).toBe(50);
});

test("before approval there is no denominator, so progress reads zero", () => {
  const totals = {
    requestedTotal: 8,
    approvedTotal: 0,
    reservedTotal: 0,
    dispatchedTotal: 0,
    receivedTotal: 0,
  };
  expect(requestProgressPercent(totals)).toBe(0);
  expect(requestProgressLabel(totals)).toBe("8 requested");
});

test("progress never exceeds one hundred percent", () => {
  expect(
    requestProgressPercent({
      requestedTotal: 5,
      approvedTotal: 5,
      reservedTotal: 5,
      dispatchedTotal: 5,
      receivedTotal: 9,
    }),
  ).toBe(100);
});

test("actions are drawn only from the server's allowedActions array", () => {
  expect(hasAction(["review", "cancel"], "review")).toBe(true);
  expect(hasAction(["review"], "dispatch")).toBe(false);
  // Absent or empty means nothing is offered — the fail-closed default for a
  // record the server said nothing about.
  expect(hasAction(undefined, "review")).toBe(false);
  expect(hasAction([], "review")).toBe(false);
});

test("search parsing falls back to the requests tab and refuses a fuzzy newRequest", () => {
  expect(parseDistributionSearch({}).tab).toBe("requests");
  expect(parseDistributionSearch({ tab: "nonsense" }).tab).toBe("requests");
  expect(parseDistributionSearch({ tab: "movements" }).tab).toBe("movements");

  expect(parseDistributionSearch({ newRequest: true }).newRequest).toBe(true);
  expect(parseDistributionSearch({ newRequest: "true" }).newRequest).toBe(true);
  expect(parseDistributionSearch({ newRequest: "maybe" }).newRequest).toBe(false);
  expect(parseDistributionSearch({ newRequest: 1 }).newRequest).toBe(false);
});

test("blank contextual ids are dropped rather than passed through as filters", () => {
  const parsed = parseDistributionSearch({
    dealId: "   ",
    customerId: "customer-1",
    requestId: 42,
  });
  expect(parsed.dealId).toBeUndefined();
  expect(parsed.customerId).toBe("customer-1");
  expect(parsed.requestId).toBeUndefined();
});

test("filters serialize the workspace's own state, with no free-text field", () => {
  const search = parseDistributionSearch({ dealId: "deal-1", locationId: "loc-1" });

  const open = buildStockRequestFilters({ search, statusFilter: "open" });
  expect(open.openOnly).toBe(true);
  expect(open.status).toBeUndefined();
  expect(open.dealId).toBe("deal-1");
  expect(open.locationId).toBe("loc-1");

  const all = buildStockRequestFilters({ search, statusFilter: "all" });
  expect(all.openOnly).toBeUndefined();
  expect(all.status).toBeUndefined();

  const single = buildStockRequestFilters({ search, statusFilter: "exception" });
  expect(single.status).toBe("exception");
  expect(single.openOnly).toBeUndefined();

  expect(Object.keys(single)).not.toContain("q");
  expect(Object.keys(single)).not.toContain("search");
});

test("contextual deep links round-trip through the parser", () => {
  const dealUrl = newRequestForDealUrl("deal 1/2");
  expect(dealUrl).toContain("newRequest=true");
  expect(dealUrl).toContain(encodeURIComponent("deal 1/2"));

  const parsedDeal = parseDistributionSearch(
    Object.fromEntries(new URL(`https://x${dealUrl}`).searchParams),
  );
  expect(parsedDeal.tab).toBe("requests");
  expect(parsedDeal.newRequest).toBe(true);
  expect(parsedDeal.dealId).toBe("deal 1/2");

  const parsedCustomer = parseDistributionSearch(
    Object.fromEntries(new URL(`https://x${newRequestForCustomerUrl("customer-9")}`).searchParams),
  );
  expect(parsedCustomer.customerId).toBe("customer-9");
  expect(parsedCustomer.newRequest).toBe(true);

  const parsedMovements = parseDistributionSearch(
    Object.fromEntries(new URL(`https://x${trackMovementsForRequestUrl("req-3")}`).searchParams),
  );
  expect(parsedMovements.tab).toBe("movements");
  expect(parsedMovements.requestId).toBe("req-3");
  expect(parsedMovements.newRequest).toBe(false);
});
