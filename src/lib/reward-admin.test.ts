import { expect, test } from "bun:test";

import {
  buildManualRewardAdjustmentEvent,
  calculateOutstandingRewardPoints,
  readRewardCatalogImportRows,
  validateRewardCatalogImportRows,
} from "@/lib/reward-admin";

test("validateRewardCatalogImportRows normalizes valid rows", () => {
  const result = validateRewardCatalogImportRows([
    {
      title: "LIVEY Hoodie",
      description: "Warm merch",
      category: "Merchandise",
      points_cost: "1200",
      stock: "5",
      availability: "available",
      image_path: "https://cdn.example.com/hoodie.png",
    },
  ]);

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected valid import");
  expect(result.rows).toEqual([
    {
      title: "LIVEY Hoodie",
      description: "Warm merch",
      category: "Merchandise",
      points_cost: 1200,
      stock: 5,
      availability: "available",
      image_path: "https://cdn.example.com/hoodie.png",
    },
  ]);
});

test("validateRewardCatalogImportRows rejects invalid rows without partial success", () => {
  const result = validateRewardCatalogImportRows([
    {
      title: "",
      description: "Missing title",
      category: "Merchandise",
      points_cost: "-2",
      stock: "3",
      availability: "available",
    },
    {
      title: "Mug",
      description: "",
      category: "Swag",
      points_cost: "50",
      stock: "-1",
      availability: "",
    },
  ]);

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected invalid import");
  expect(result.errors).toHaveLength(2);
  expect(result.errors[0]?.rowNumber).toBe(2);
  expect(result.errors[1]?.rowNumber).toBe(3);
});

test("calculateOutstandingRewardPoints sums the reward ledger", () => {
  const outstanding = calculateOutstandingRewardPoints([
    { points_delta: 500 },
    { points_delta: -200 },
    { points_delta: 150 },
  ]);

  expect(outstanding).toBe(450);
});

test("buildManualRewardAdjustmentEvent creates positive or negative point events", () => {
  const credit = buildManualRewardAdjustmentEvent({
    userId: "user-1",
    partnerId: "partner-1",
    pointsDelta: 250,
    reason: "Bonus for Q3 launch",
    actorId: "admin-1",
    now: "2026-07-27T10:00:00.000Z",
  });
  const debit = buildManualRewardAdjustmentEvent({
    userId: "user-1",
    partnerId: "partner-1",
    pointsDelta: -100,
    reason: "Correction",
    actorId: "admin-1",
    now: "2026-07-27T10:00:00.000Z",
  });

  expect(credit.source_type).toBe("manual_adjustment");
  expect(credit.points_delta).toBe(250);
  expect(debit.points_delta).toBe(-100);
  expect(credit.approved_by).toBe("admin-1");
});

test("readRewardCatalogImportRows parses csv files with the template headers", async () => {
  const csv = [
    "title,description,image_path,category,points_cost,stock,availability",
    'LIVEY Mug,Branded mug,https://cdn.example.com/mug.png,Merchandise,250,5,available',
  ].join("\n");

  const rows = await readRewardCatalogImportRows(
    new File([csv], "reward-catalog.csv", { type: "text/csv" }),
  );

  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    title: "LIVEY Mug",
    description: "Branded mug",
    image_path: "https://cdn.example.com/mug.png",
    category: "Merchandise",
    availability: "available",
  });
  expect(String(rows[0]?.points_cost)).toBe("250");
  expect(String(rows[0]?.stock)).toBe("5");
});
