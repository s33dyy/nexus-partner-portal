import { expect, test } from "bun:test";

import {
  buildPresetCollaboratorSplits,
  calculateDealRewardAllocations,
  buildDealCollaboratorPayloads,
  filterAddableCollaboratorMembers,
  isDealCollaboratorEditingLocked,
} from "@/lib/deal-collaboration";

test("buildPresetCollaboratorSplits returns the expected ratios for up to four collaborators", () => {
  expect(buildPresetCollaboratorSplits(1)).toEqual([100]);
  expect(buildPresetCollaboratorSplits(2)).toEqual([60, 40]);
  expect(buildPresetCollaboratorSplits(3)).toEqual([50, 30, 20]);
  expect(buildPresetCollaboratorSplits(4)).toEqual([60, 15, 15, 15]);
});

test("buildPresetCollaboratorSplits rejects deals with five collaborators", () => {
  expect(() => buildPresetCollaboratorSplits(5)).toThrow("Deals can have at most 4 collaborators");
});

test("calculateDealRewardAllocations rounds the total and preserves the full amount", () => {
  const allocations = calculateDealRewardAllocations({
    dealId: "deal-123",
    dealAmount: "1000",
    rewardRatePercent: 5,
    collaborators: [
      { userId: "user-a", splitPercent: 60, sortOrder: 0 },
      { userId: "user-b", splitPercent: 40, sortOrder: 1 },
    ],
  });

  expect(allocations).toEqual([
    { dealId: "deal-123", userId: "user-a", points: 30 },
    { dealId: "deal-123", userId: "user-b", points: 20 },
  ]);
});

test("calculateDealRewardAllocations assigns the rounding remainder to the first recipient", () => {
  const allocations = calculateDealRewardAllocations({
    dealId: "deal-123",
    dealAmount: "100",
    rewardRatePercent: 5,
    collaborators: [
      { userId: "user-a", splitPercent: 60, sortOrder: 0 },
      { userId: "user-b", splitPercent: 30, sortOrder: 1 },
      { userId: "user-c", splitPercent: 10, sortOrder: 2 },
    ],
  });

  expect(allocations).toEqual([
    { dealId: "deal-123", userId: "user-a", points: 2 },
    { dealId: "deal-123", userId: "user-b", points: 2 },
    { dealId: "deal-123", userId: "user-c", points: 1 },
  ]);
});

test("buildDealCollaboratorPayloads keeps invitation order and stamps deal ids", () => {
  expect(
    buildDealCollaboratorPayloads("deal-123", [
      { userId: "user-b", splitPercent: 40, sortOrder: 1 },
      { userId: "user-a", splitPercent: 60, sortOrder: 0 },
    ]),
  ).toEqual([
    {
      deal_id: "deal-123",
      user_id: "user-a",
      split_percent: 60,
      sort_order: 0,
      is_seed: false,
    },
    {
      deal_id: "deal-123",
      user_id: "user-b",
      split_percent: 40,
      sort_order: 1,
      is_seed: false,
    },
  ]);
});

test("isDealCollaboratorEditingLocked returns true for closed deals", () => {
  expect(isDealCollaboratorEditingLocked({ stage: "won", status: "won" })).toBe(true);
  expect(isDealCollaboratorEditingLocked({ stage: "approved", status: "approved" })).toBe(false);
});

test("filterAddableCollaboratorMembers excludes the authenticated user and existing collaborators", () => {
  expect(
    filterAddableCollaboratorMembers(
      [
        { id: "user-a" },
        { id: "user-b" },
        { id: "user-c" },
      ],
      [{ userId: "user-b", splitPercent: 100, sortOrder: 0 }],
      "user-a",
    ),
  ).toEqual([{ id: "user-c" }]);
});
