import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import { FEATURE_KEYS, type FeatureKey } from "@/domain/contracts/features";
import { MIN_AGGREGATE_COHORT } from "@/domain/contracts/recommendations";
import type { DistributionActor } from "@/server/distribution-policy.server";
import type { FeatureCapabilities } from "@/server/rbac-policy.server";
import {
  recommendDealProducts,
  recommendRelatedCatalogueItems,
  recommendStockRequestItems,
} from "@/server/recommendation-queries.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

const ISSUED_AT = "2026-08-26T00:00:00.000Z";
const DISTRIBUTOR_USER = "11111111-1111-1111-1111-111111111111";

function buildActor(overrides: Partial<AssignmentRecord> = {}): DistributionActor {
  const assignment: AssignmentRecord = {
    assignmentId: "assignment-distributor",
    userId: DISTRIBUTOR_USER,
    tenantId: "tenant-livey-org",
    organizationTenantId: "tenant-livey-org",
    roleKey: "restricted_distributor",
    teamDomain: "logistics",
    geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    partnerId: "partner-1",
    accountId: null,
    portfolioId: null,
    queueId: null,
    status: "active",
    validFrom: ISSUED_AT,
    validTo: null,
    managerAssignmentId: "assignment-manager",
    source: "test",
    approverUserId: null,
    predecessorAssignmentId: null,
    successorAssignmentId: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: ISSUED_AT,
    updatedAt: ISSUED_AT,
    version: 1,
    isSeed: true,
    ...overrides,
  };
  const activeContext: ActiveContextRecord = {
    contextId: "context-1",
    userId: assignment.userId,
    assignmentId: assignment.assignmentId,
    assignmentStatus: assignment.status,
    tenantId: assignment.tenantId,
    organizationTenantId: assignment.organizationTenantId,
    workingScope: null,
    issuedAt: ISSUED_AT,
    expiresAt: "2026-08-26T08:00:00.000Z",
    version: 1,
    revocationLink: null,
    correlationId: "corr-1",
    assignmentVersion: assignment.version,
    workingScopeNodeId: null,
    revokedAt: null,
    revocationReason: null,
    isSeed: true,
    createdAt: ISSUED_AT,
    updatedAt: ISSUED_AT,
  };
  return { userId: assignment.userId, assignment, activeContext };
}

function fullCapabilities(): FeatureCapabilities {
  const capabilities = {} as FeatureCapabilities;
  for (const feature of FEATURE_KEYS) {
    capabilities[feature as FeatureKey] = { create: true, read: true, update: true, delete: false };
  }
  return capabilities;
}

type Capture = { sql: string; params: unknown[] };

function harness(
  options: {
    surface?: boolean;
    rowsFor?: (sql: string) => Array<Record<string, unknown>>;
  } = {},
) {
  const captured: Capture[] = [];
  return {
    captured,
    deps: {
      resolveRecommendationSurface: async () => options.surface ?? true,
      resolveSurface: async () => true,
      loadCapabilities: async () => fullCapabilities(),
      query: async (sql: string, params: unknown[] = []) => {
        const text = String(sql).replace(/\s+/g, " ").trim();
        captured.push({ sql: text, params });
        return { rows: options.rowsFor?.(text) ?? [], rowCount: 0 };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test("every surface denies without querying when the recommendation flag is off", async () => {
  for (const run of [
    (h: ReturnType<typeof harness>) =>
      recommendStockRequestItems(buildActor(), { destinationLocationId: "loc-1" }, h.deps),
    (h: ReturnType<typeof harness>) =>
      recommendDealProducts(buildActor(), { dealId: "deal-1" }, h.deps),
    (h: ReturnType<typeof harness>) =>
      recommendRelatedCatalogueItems(buildActor(), { sku: "LIV-AAA" }, h.deps),
  ]) {
    const h = harness({ surface: false });
    const result = await run(h);
    expect(result.ok).toBe(false);
    expect(h.captured).toHaveLength(0);
  }
});

test("stock recommendations inherit the distribution gate, not a second one", async () => {
  const h = harness({ surface: true });
  const result = await recommendStockRequestItems(
    buildActor(),
    { destinationLocationId: "loc-1" },
    { ...h.deps, resolveSurface: async () => false },
  );
  expect(result.ok).toBe(false);
  expect(h.captured).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// The k-anonymity floor reaches SQL
// ---------------------------------------------------------------------------

test("aggregate co-occurrence applies the cohort floor in SQL, not only after the fact", async () => {
  const h = harness({ rowsFor: () => [] });
  await recommendStockRequestItems(
    buildActor(),
    { destinationLocationId: "loc-1", chosenProductSkuIds: ["sku-1"] },
    h.deps,
  );
  const basket = h.captured.find((entry) => entry.sql.includes("FROM stock_request_lines anchor"));
  expect(basket).toBeDefined();
  // Filtering in the database means a below-floor pair is never even loaded
  // into the process, let alone rendered.
  expect(basket!.sql).toContain("HAVING COUNT(DISTINCT other.request_id) >= $2");
  expect(basket!.params[1]).toBe(MIN_AGGREGATE_COHORT);
});

test("with nothing chosen yet there is no anchor, so no market-basket query runs", async () => {
  const h = harness({ rowsFor: () => [] });
  await recommendStockRequestItems(buildActor(), { destinationLocationId: "loc-1" }, h.deps);
  expect(h.captured.some((entry) => entry.sql.includes("FROM stock_request_lines anchor"))).toBe(
    false,
  );
});

test("a below-floor aggregate row is dropped even if the database returns it", async () => {
  const h = harness({
    rowsFor: (sql) =>
      sql.includes("FROM stock_request_lines anchor")
        ? [
            {
              product_sku_id: "sku-2",
              sku_code: "LIV-BBB",
              product_name: "Thing Two",
              anchor_name: "Thing One",
              cohort: 1,
            },
          ]
        : [],
  });
  const result = await recommendStockRequestItems(
    buildActor(),
    { destinationLocationId: "loc-1", chosenProductSkuIds: ["sku-1"] },
    h.deps,
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    // Defence in depth: the contract floors it again on the way out.
    expect(result.recommendations).toEqual([]);
    expect(result.insufficientHistory).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// Own-history signals
// ---------------------------------------------------------------------------

test("a reorder cadence becomes an explainable suggestion", async () => {
  const h = harness({
    rowsFor: (sql) =>
      sql.startsWith("WITH recent")
        ? [
            {
              product_sku_id: "sku-9",
              sku_code: "LIV-CLD-100",
              product_name: "Cloud Suite",
              times: 4,
              window_size: 6,
              typical_quantity: 6,
            },
          ]
        : [],
  });
  const result = await recommendStockRequestItems(
    buildActor(),
    { destinationLocationId: "loc-1" },
    h.deps,
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]?.itemName).toBe("Cloud Suite");
    expect(result.recommendations[0]?.primaryReason.detail).toBe("On 4 of your last 6 requests");
    expect(result.insufficientHistory).toBe(false);
  }
  // Scoped to this Distributor's own requests.
  const history = h.captured.find((entry) => entry.sql.startsWith("WITH recent"))!;
  expect(history.sql).toContain("r.distributor_assignment_id = $1");
  expect(history.params[0]).toBe("assignment-distributor");
});

test("running low is measured against how much they actually order", async () => {
  const rows = (sql: string) => {
    if (sql.startsWith("WITH recent")) {
      return [
        {
          product_sku_id: "sku-9",
          sku_code: "LIV-CLD-100",
          product_name: "Cloud Suite",
          times: 1,
          window_size: 6,
          typical_quantity: 6,
        },
      ];
    }
    if (sql.includes("FROM inventory_balances")) {
      return [
        {
          product_sku_id: "sku-9",
          sku_code: "LIV-CLD-100",
          product_name: "Cloud Suite",
          available: 2,
        },
      ];
    }
    return [];
  };
  const h = harness({ rowsFor: rows });
  const result = await recommendStockRequestItems(
    buildActor(),
    { destinationLocationId: "loc-1" },
    h.deps,
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    const details = result.recommendations[0]!.reasons.map((reason) => reason.detail);
    expect(details).toContain("Only 2 available, and you usually order 6");
  }
});

test("with no order history nothing is called low", async () => {
  // Two units is not a shortage if you have never ordered this at all —
  // calling it one would be an invented signal.
  const h = harness({
    rowsFor: (sql) =>
      sql.includes("FROM inventory_balances")
        ? [
            {
              product_sku_id: "sku-new",
              sku_code: "LIV-NEW",
              product_name: "Never Ordered",
              available: 2,
            },
          ]
        : [],
  });
  const result = await recommendStockRequestItems(
    buildActor(),
    { destinationLocationId: "loc-1" },
    h.deps,
  );
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.recommendations).toEqual([]);
});

test("the low-stock read is bound to a location this Distributor owns", async () => {
  const h = harness({ rowsFor: () => [] });
  await recommendStockRequestItems(buildActor(), { destinationLocationId: "loc-1" }, h.deps);
  const lowStock = h.captured.find((entry) => entry.sql.includes("FROM inventory_balances"))!;
  expect(lowStock.sql).toContain("loc.distributor_assignment_id = $2");
  expect(lowStock.params).toEqual(["loc-1", "assignment-distributor"]);
});

test("an already-chosen SKU is never suggested back", async () => {
  const h = harness({
    rowsFor: (sql) =>
      sql.startsWith("WITH recent")
        ? [
            {
              product_sku_id: "sku-9",
              sku_code: "LIV-CLD-100",
              product_name: "Cloud Suite",
              times: 5,
              window_size: 6,
              typical_quantity: 6,
            },
          ]
        : [],
  });
  const result = await recommendStockRequestItems(
    buildActor(),
    { destinationLocationId: "loc-1", chosenProductSkuIds: ["sku-9"] },
    h.deps,
  );
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.recommendations).toEqual([]);
});

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

test("a deal the actor cannot see yields a denial, not an empty list", async () => {
  // An empty list would confirm the deal exists; the denial must read the same
  // as it does for a deal that does not.
  const h = harness({ rowsFor: () => [] });
  const result = await recommendDealProducts(buildActor(), { dealId: "deal-x" }, h.deps);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.failure.message).toBe("Access denied");
  // Exactly one query ran: the visibility check. No evidence was gathered.
  expect(h.captured).toHaveLength(1);
});

test("deal evidence comes from won deals only", async () => {
  const h = harness({
    rowsFor: (sql) => (sql.startsWith("SELECT d.id") ? [{ id: "deal-1" }] : []),
  });
  await recommendDealProducts(
    buildActor(),
    { dealId: "deal-1", chosenSkus: ["LIV-CLD-100"] },
    h.deps,
  );
  const evidence = h.captured.filter((entry) => entry.sql.includes("deal_line_items"));
  expect(evidence.length).toBeGreaterThan(0);
  for (const entry of evidence) {
    // An open deal's line items are a proposal and a lost deal's are a
    // counter-example; neither is evidence of what sells.
    expect(entry.sql).toContain("d.stage = 'won'");
  }
});

test("Super Admin passes the deal visibility check without a participant row", async () => {
  const h = harness({ rowsFor: (sql) => (sql.startsWith("SELECT d.id") ? [{ id: "d" }] : []) });
  await recommendDealProducts(
    buildActor({ roleKey: "super_admin", teamDomain: "identity", partnerId: null }),
    { dealId: "deal-1" },
    h.deps,
  );
  expect(h.captured[0]?.params[1]).toBe(true);
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

test("catalogue suggestions need a product and floor their aggregate evidence", async () => {
  const blank = harness({ rowsFor: () => [] });
  const missing = await recommendRelatedCatalogueItems(null, { sku: "  " }, blank.deps);
  expect(missing.ok).toBe(false);
  expect(blank.captured).toHaveLength(0);

  const h = harness({ rowsFor: () => [] });
  await recommendRelatedCatalogueItems(null, { sku: "LIV-CLD-100" }, h.deps);
  const basket = h.captured.find((entry) => entry.sql.includes("FROM deal_line_items anchor"))!;
  expect(basket.sql).toContain("HAVING COUNT(DISTINCT other.deal_id) >= $2");
  expect(basket.params[1]).toBe(MIN_AGGREGATE_COHORT);
});

test("a same-category peer alone never surfaces", async () => {
  const h = harness({
    rowsFor: (sql) =>
      sql.includes("JOIN portal_catalog_items peer")
        ? [
            {
              item_id: "cat-2",
              sku: "LIV-BBB",
              product_name: "Sibling Product",
              category: "Software",
              cohort: 12,
            },
          ]
        : [],
  });
  const result = await recommendRelatedCatalogueItems(null, { sku: "LIV-CLD-100" }, h.deps);
  expect(result.ok).toBe(true);
  if (result.ok) {
    // "Also in Software" is a fact about the catalogue, not a recommendation.
    expect(result.recommendations).toEqual([]);
    expect(result.insufficientHistory).toBe(true);
  }
});

test("category sharpens an item that already has real evidence", async () => {
  const h = harness({
    rowsFor: (sql) => {
      if (sql.includes("FROM deal_line_items anchor")) {
        return [
          {
            item_id: "cat-2",
            sku: "LIV-BBB",
            product_name: "Sibling Product",
            category: "Software",
            cohort: 5,
          },
        ];
      }
      if (sql.includes("JOIN portal_catalog_items peer")) {
        return [
          {
            item_id: "cat-2",
            sku: "LIV-BBB",
            product_name: "Sibling Product",
            category: "Software",
            cohort: 12,
          },
        ];
      }
      return [];
    },
  });
  const result = await recommendRelatedCatalogueItems(null, { sku: "LIV-CLD-100" }, h.deps);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]?.reasons).toHaveLength(2);
    expect(result.recommendations[0]?.primaryReason.code).toBe("ordered_together");
  }
});

test("the deal visibility clause uses the same participant columns as the table policy", async () => {
  // A fake query cannot catch a column that does not exist — this one only
  // surfaced by running the page, where Postgres said "column dp.user_id does
  // not exist". Pinning the names here means a rename has to break this test
  // before it breaks the panel.
  const h = harness({ rowsFor: () => [] });
  await recommendDealProducts(buildActor(), { dealId: "deal-1" }, h.deps);
  const check = h.captured[0]!.sql;
  expect(check).toContain("FROM deal_participants pt");
  expect(check).toContain("pt.participant_user_id = $3");
  expect(check).toContain("pt.valid_to IS NULL");
  expect(check).not.toContain("removed_at");
});
