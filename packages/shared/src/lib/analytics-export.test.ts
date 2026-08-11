import { expect, test } from "bun:test";

import { buildAnalyticsWorkbook } from "./analytics-export";

test("buildAnalyticsWorkbook creates summary and raw-data worksheets", () => {
  const workbook = buildAnalyticsWorkbook({
    generatedAt: "2026-07-27T10:00:00.000Z",
    metrics: {
      pipelineValue: "$100,000",
      wonDeals: 2,
      openDeals: 3,
      avgHealth: "80%",
    },
    deals: [{ account_name: "Acme", amount: "$100,000", stage: "proposal" }],
    customers: [{ company_name: "Acme", health_score: 80, status: "active" }],
    catalog: [{ product_name: "LIVEY Cam", partner_tier: "Gold", stock: 10 }],
  });

  expect(workbook.SheetNames).toEqual(["Summary", "Deals", "Customers", "Catalog"]);
  expect(workbook.Sheets.Summary).toBeDefined();
  expect(workbook.Sheets.Deals).toBeDefined();
});
