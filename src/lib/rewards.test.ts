import { expect, test } from "bun:test";

import { awardDealWinPoints } from "@/lib/rewards";

function createRewardDb(existing: Record<string, boolean> = {}) {
  const inserts: Array<Record<string, unknown>> = [];
  const lookupFilters: Array<Record<string, unknown>> = [];

  const chain = {
    select() {
      return chain;
    },
    eq(column: string, value: unknown) {
      lookupFilters.push({ column, value });
      return chain;
    },
    maybeSingle() {
      const dealId = String(
        lookupFilters.find((entry) => entry.column === "source_id")?.value ?? "",
      );
      const userId = String(lookupFilters.find((entry) => entry.column === "user_id")?.value ?? "");
      const key = `${dealId}:${userId}`;
      lookupFilters.length = 0;
      return Promise.resolve({ data: existing[key] ? { id: key } : null, error: null });
    },
    insert(payload: Record<string, unknown>) {
      inserts.push(payload);
      return Promise.resolve({ error: null });
    },
  };

  return {
    inserts,
    from() {
      return chain;
    },
  };
}

test("awardDealWinPoints creates one reward event per collaborator", async () => {
  const db = createRewardDb();

  const result = await awardDealWinPoints(db as never, {
    dealId: "deal-123",
    accountName: "ACME",
    product: "Webcam",
    dealAmount: "1000",
    rewardRatePercent: 5,
    collaborators: [
      { userId: "user-a", splitPercent: 60, sortOrder: 0 },
      { userId: "user-b", splitPercent: 40, sortOrder: 1 },
    ],
    partnerId: "partner-123",
    actorId: "admin-1",
  });

  expect(result).toMatchObject({ created: 2, points: 50 });
  expect(db.inserts).toEqual([
    expect.objectContaining({
      source_type: "deal_win",
      source_id: "deal-123",
      user_id: "user-a",
      partner_id: "partner-123",
      points_delta: 30,
    }),
    expect.objectContaining({
      source_type: "deal_win",
      source_id: "deal-123",
      user_id: "user-b",
      partner_id: "partner-123",
      points_delta: 20,
    }),
  ]);
});

test("awardDealWinPoints skips recipients that already have a deal win event", async () => {
  const db = createRewardDb({ "deal-123:user-a": true });

  const result = await awardDealWinPoints(db as never, {
    dealId: "deal-123",
    accountName: "ACME",
    product: "Webcam",
    dealAmount: "1000",
    rewardRatePercent: 5,
    collaborators: [
      { userId: "user-a", splitPercent: 60, sortOrder: 0 },
      { userId: "user-b", splitPercent: 40, sortOrder: 1 },
    ],
    partnerId: "partner-123",
    actorId: "admin-1",
  });

  expect(result).toMatchObject({ created: 1, points: 20 });
  expect(db.inserts).toEqual([
    expect.objectContaining({
      user_id: "user-b",
      points_delta: 20,
    }),
  ]);
});

test("awardDealWinPoints falls back to the original owner when no collaborators exist", async () => {
  const db = createRewardDb();

  const result = await awardDealWinPoints(db as never, {
    dealId: "deal-legacy",
    accountName: "Legacy ACME",
    product: "Webcam",
    dealAmount: "1000",
    rewardRatePercent: 5,
    collaborators: [],
    fallbackUserId: "owner-1",
    partnerId: "partner-123",
    actorId: "admin-1",
  });

  expect(result).toMatchObject({ created: 1, points: 50 });
  expect(db.inserts).toEqual([
    expect.objectContaining({
      user_id: "owner-1",
      points_delta: 50,
    }),
  ]);
});
