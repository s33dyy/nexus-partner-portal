import { expect, test } from "bun:test";

import {
  buildGlobalSearchResults,
  getDashboardMetricDestination,
  type GlobalSearchSourceData,
} from "@/lib/global-search";

const sourceData: GlobalSearchSourceData = {
  deals: [
    { id: "deal-1", account_name: "Acme Foods", company_name: "Acme Foods", stage: "proposal" },
    { id: "deal-2", account_name: "Beta Labs", company_name: "Beta Labs", stage: "won" },
  ],
  partners: [
    { id: "partner-1", company_name: "Acme Partners", status: "approved", tier: "gold" },
  ],
  catalogItems: [
    { id: "catalog-1", product_name: "Acme Analytics", category: "Software", partner_tier: "Gold" },
  ],
};

test("buildGlobalSearchResults groups matches by entity type", () => {
  const results = buildGlobalSearchResults("acme", sourceData);

  expect(results.map((group) => group.group)).toEqual(["Deals", "Partners", "Catalog"]);
  expect(results[0]?.items[0]?.href).toBe("/deals");
  expect(results[1]?.items[0]?.title).toBe("Acme Partners");
  expect(results[2]?.items[0]?.subtitle).toContain("Software");
});

test("buildGlobalSearchResults returns no groups for a blank query", () => {
  expect(buildGlobalSearchResults("   ", sourceData)).toEqual([]);
});

test("getDashboardMetricDestination maps metrics to existing portal routes", () => {
  expect(getDashboardMetricDestination("pipeline", true)).toBe("/pipeline");
  expect(getDashboardMetricDestination("deals", true)).toBe("/deals");
  expect(getDashboardMetricDestination("partners", true)).toBe("/admin/partners");
  expect(getDashboardMetricDestination("partners", false)).toBe("/partner");
  expect(getDashboardMetricDestination("customers", false)).toBe("/customers");
  expect(getDashboardMetricDestination("rewards", false)).toBe("/rewards");
});
