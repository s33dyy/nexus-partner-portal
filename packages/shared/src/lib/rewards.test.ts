import { expect, test } from "bun:test";

import { rewardBalanceSummary, sumRewardPoints } from "./rewards";

test("rewardBalanceSummary reports available points from the ledger and reserved points separately", () => {
  const summary = rewardBalanceSummary({
    events: [{ points_delta: 500 }, { points_delta: -200 }],
    redemptions: [
      { status: "points_reserved", points_cost: 200 },
      { status: "cancelled", points_cost: 300 },
    ],
  });

  expect(summary).toEqual({ availablePoints: 300, reservedPoints: 200 });
});

test("rewardBalanceSummary counts pending_review redemptions as reserved but never adds them back to available points", () => {
  const summary = rewardBalanceSummary({
    events: [{ points_delta: 500 }, { points_delta: -500 }],
    redemptions: [{ status: "pending_review", points_cost: 500 }],
  });

  expect(summary).toEqual({ availablePoints: 0, reservedPoints: 500 });
});

test("rewardBalanceSummary ignores terminal redemption statuses when summing reserved points", () => {
  const summary = rewardBalanceSummary({
    events: [{ points_delta: 500 }],
    redemptions: [
      { status: "processing", points_cost: 500 },
      { status: "cancelled", points_cost: 200 },
      { status: "failed", points_cost: 100 },
    ],
  });

  expect(summary).toEqual({ availablePoints: 500, reservedPoints: 0 });
});

test("sumRewardPoints tolerates missing or non-numeric deltas", () => {
  expect(sumRewardPoints([{ points_delta: 100 }, { points_delta: -40 }])).toBe(60);
  expect(sumRewardPoints([])).toBe(0);
});
