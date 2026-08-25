import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import { FEATURE_KEYS, type CrudOperation, type FeatureKey } from "@/domain/contracts/features";
import type { DistributionActor } from "@/server/distribution-policy.server";
import {
  getStockRequest,
  listDistributionExceptions,
  listInventoryBalances,
  listInventoryMovements,
  listRequestableProductSkus,
  listStockLocations,
  listStockRequests,
} from "@/server/distribution-queries.server";
import type { FeatureCapabilities } from "@/server/rbac-policy.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

const ISSUED_AT = "2026-08-25T00:00:00.000Z";
const DISTRIBUTOR_USER = "11111111-1111-1111-1111-111111111111";
const REQUEST_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

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
    expiresAt: "2026-08-25T08:00:00.000Z",
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

const distributor = () => buildActor();
const manager = () =>
  buildActor({
    assignmentId: "assignment-manager",
    userId: "22222222-2222-2222-2222-222222222222",
    roleKey: "rm",
    teamDomain: "sales",
    partnerId: null,
  });
const superAdmin = () =>
  buildActor({
    assignmentId: "assignment-admin",
    userId: "66666666-6666-6666-6666-666666666666",
    roleKey: "super_admin",
    teamDomain: "identity",
    partnerId: null,
  });

function fullCapabilities(): FeatureCapabilities {
  const capabilities = {} as FeatureCapabilities;
  for (const feature of FEATURE_KEYS) {
    capabilities[feature as FeatureKey] = {
      create: true,
      read: true,
      update: true,
      delete: false,
    };
  }
  return capabilities;
}

function noCapabilities(): FeatureCapabilities {
  const capabilities = {} as FeatureCapabilities;
  for (const feature of FEATURE_KEYS) {
    capabilities[feature as FeatureKey] = {
      create: false,
      read: false,
      update: false,
      delete: false,
    };
  }
  return capabilities;
}

type Capture = { sql: string; params: unknown[] };

function harness(
  options: {
    surface?: boolean;
    capabilities?: FeatureCapabilities;
    rowsFor?: (sql: string) => Array<Record<string, unknown>>;
  } = {},
) {
  const captured: Capture[] = [];
  return {
    captured,
    deps: {
      resolveSurface: async () => options.surface ?? true,
      loadCapabilities: async () => options.capabilities ?? fullCapabilities(),
      query: async (sql: string, params: unknown[] = []) => {
        const text = String(sql).replace(/\s+/g, " ").trim();
        captured.push({ sql: text, params });
        return { rows: options.rowsFor?.(text) ?? [], rowCount: 0 };
      },
    },
  };
}

function requestRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: REQUEST_ID,
    human_id: "DMS-000001",
    status: "submitted",
    priority: "high",
    required_by: "2026-09-01",
    reason: "Restock for a tagged deal",
    decision_reason: null,
    exception_reason: null,
    version: 1,
    created_at: "2026-08-25T00:00:00Z",
    updated_at: "2026-08-25T01:00:00Z",
    requester_user_id: DISTRIBUTOR_USER,
    distributor_assignment_id: "assignment-distributor",
    manager_assignment_id: "assignment-manager",
    destination_location_id: "loc-distributor",
    deal_id: null,
    customer_id: null,
    destination_location_name: "Pune Distributor Store",
    destination_custodian_assignment_id: null,
    requester_name: "Dev Distributor",
    manager_name: "Maya Manager",
    line_count: 2,
    requested_total: 8,
    approved_total: 0,
    reserved_total: 0,
    dispatched_total: 0,
    received_total: 0,
    source_custodian_ids: [],
    total_count: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test("every read denies without querying when the surface is disabled", async () => {
  const cases = [
    (h: ReturnType<typeof harness>) => listStockRequests(distributor(), {}, h.deps),
    (h: ReturnType<typeof harness>) => getStockRequest(distributor(), REQUEST_ID, h.deps),
    (h: ReturnType<typeof harness>) => listInventoryBalances(distributor(), {}, h.deps),
    (h: ReturnType<typeof harness>) => listInventoryMovements(distributor(), {}, h.deps),
    (h: ReturnType<typeof harness>) => listDistributionExceptions(distributor(), {}, h.deps),
    (h: ReturnType<typeof harness>) => listRequestableProductSkus(distributor(), null, h.deps),
    (h: ReturnType<typeof harness>) => listStockLocations(distributor(), {}, h.deps),
  ];

  for (const run of cases) {
    const h = harness({ surface: false });
    const result = await run(h);
    expect(result.ok).toBe(false);
    // No DMS query is issued at all — a hidden surface is hidden in the
    // network tab too, not only on screen.
    expect(h.captured).toHaveLength(0);
  }
});

test("a role without distribution read is denied without querying", async () => {
  const h = harness({ capabilities: noCapabilities() });
  const result = await listStockRequests(distributor(), {}, h.deps);
  expect(result.ok).toBe(false);
  expect(h.captured).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

test("a Distributor's request list is bound to its own assignment", async () => {
  const h = harness({ rowsFor: () => [requestRow()] });
  const result = await listStockRequests(distributor(), {}, h.deps);

  expect(result.ok).toBe(true);
  const capture = h.captured[0]!;
  expect(capture.sql).toContain("r.distributor_assignment_id = $1");
  expect(capture.params[0]).toBe("assignment-distributor");
  // Never widened to the partner: two Distributors under one Partner do not
  // see each other's requests.
  expect(capture.sql).not.toContain("partner_id");
});

test("a manager's request list covers what it decides and what it holds", async () => {
  const h = harness({ rowsFor: () => [requestRow()] });
  await listStockRequests(manager(), {}, h.deps);

  const capture = h.captured[0]!;
  expect(capture.sql).toContain("r.manager_assignment_id = $1");
  expect(capture.sql).toContain("dloc.custodian_assignment_id = $1");
  expect(capture.sql).toContain("sloc.custodian_assignment_id = $1");
  expect(capture.params[0]).toBe("assignment-manager");
});

test("filters are bound as parameters after the scope, never interpolated", async () => {
  const h = harness({ rowsFor: () => [requestRow()] });
  await listStockRequests(
    distributor(),
    { status: "submitted", dealId: "deal-1", locationId: "loc-9", openOnly: true },
    h.deps,
  );

  const capture = h.captured[0]!;
  expect(capture.sql).toContain("r.status = $2");
  expect(capture.sql).toContain("r.deal_id = $3");
  expect(capture.sql).toContain("r.destination_location_id = $4");
  expect(capture.sql).toContain("r.status NOT IN ('received', 'rejected', 'cancelled')");
  expect(capture.params.slice(0, 4)).toEqual([
    "assignment-distributor",
    "submitted",
    "deal-1",
    "loc-9",
  ]);
});

test("a page size is always bounded", async () => {
  const h = harness({ rowsFor: () => [requestRow()] });
  await listStockRequests(distributor(), { limit: 100000, offset: -5 }, h.deps);
  const params = h.captured[0]!.params;
  expect(params[params.length - 2]).toBe(200);
  expect(params[params.length - 1]).toBe(0);
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test("a request list row carries the actions the actor may actually take", async () => {
  const asManager = harness({ rowsFor: () => [requestRow()] });
  const managerResult = await listStockRequests(manager(), {}, asManager.deps);
  expect(managerResult.ok).toBe(true);
  if (managerResult.ok) {
    expect(managerResult.rows[0]?.allowedActions).toContain("review");
    expect(managerResult.rows[0]?.nextOwnerLabel).toBe("Approving manager");
    expect(managerResult.total).toBe(1);
  }

  const asDistributor = harness({ rowsFor: () => [requestRow()] });
  const distributorResult = await listStockRequests(distributor(), {}, asDistributor.deps);
  expect(distributorResult.ok).toBe(true);
  if (distributorResult.ok) {
    // The requester can withdraw and can flag a problem, but cannot approve
    // their own request.
    expect(distributorResult.rows[0]?.allowedActions).not.toContain("review");
    expect(distributorResult.rows[0]?.allowedActions).toContain("cancel");
  }
});

test("getStockRequest returns the same denial for a missing id as for one outside scope", async () => {
  const h = harness({ rowsFor: () => [] });
  const result = await getStockRequest(distributor(), REQUEST_ID, h.deps);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failure.code).toBe("POLICY_DENIED");
    expect(result.failure.message).toBe("Access denied");
    expect(result.failure.mayRevealRecordExistence).toBe(false);
  }
});

test("getStockRequest scopes the detail read and loads its lines", async () => {
  const h = harness({
    rowsFor: (sql) => {
      if (sql.startsWith("SELECT l.id")) {
        return [
          {
            id: "line-1",
            product_sku_id: "sku-1",
            sku_code: "LV-100",
            product_name: "LIVEY Panel",
            variant_name: "Standard",
            source_location_id: "loc-warehouse",
            source_location_name: "Mumbai Warehouse",
            requested_quantity: 5,
            approved_quantity: 5,
            reserved_quantity: 5,
            dispatched_quantity: 5,
            received_quantity: 0,
          },
        ];
      }
      return [
        requestRow({
          status: "dispatched",
          approved_total: 5,
          reserved_total: 5,
          dispatched_total: 5,
        }),
      ];
    },
  });

  const result = await getStockRequest(distributor(), REQUEST_ID, h.deps);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.request.humanId).toBe("DMS-000001");
    expect(result.request.lines).toHaveLength(1);
    expect(result.request.lines[0]?.skuCode).toBe("LV-100");
    // Derived from the real lines here, not from the aggregate.
    expect(result.request.allowedActions).toContain("receive");
    expect(result.request.allowedActions).not.toContain("cancel");
  }
  expect(h.captured[0]?.sql).toContain("r.id = $1");
  expect(h.captured[0]?.sql).toContain("r.distributor_assignment_id = $2");
});

// ---------------------------------------------------------------------------
// Balances and movements
// ---------------------------------------------------------------------------

test("available is computed from on hand, reserved, and damaged — in SQL and again on read", async () => {
  const h = harness({
    rowsFor: () => [
      {
        product_sku_id: "sku-1",
        sku_code: "LV-100",
        product_name: "LIVEY Panel",
        location_id: "loc-distributor",
        location_name: "Pune Distributor Store",
        location_type: "distributor",
        on_hand_quantity: 10,
        reserved_quantity: 3,
        damaged_quantity: 2,
        in_transit_quantity: 4,
        // A deliberately wrong stored value: the read must not trust it.
        available_quantity: 99,
        updated_at: "2026-08-25T02:00:00Z",
        total_count: 1,
      },
    ],
  });

  const result = await listInventoryBalances(distributor(), {}, h.deps);
  expect(h.captured[0]?.sql).toContain(
    "(b.on_hand_quantity - b.reserved_quantity - b.damaged_quantity) AS available_quantity",
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.rows[0]?.availableQuantity).toBe(5);
    expect(result.rows[0]?.inTransitQuantity).toBe(4);
  }
});

test("a manager sees balances only for locations it holds", async () => {
  const h = harness({ rowsFor: () => [] });
  await listInventoryBalances(manager(), {}, h.deps);
  expect(h.captured[0]?.sql).toContain("loc.custodian_assignment_id = $1");
  expect(h.captured[0]?.sql).not.toContain("loc.distributor_assignment_id");
});

test("a movement is visible when either end is in scope", async () => {
  const h = harness({ rowsFor: () => [] });
  await listInventoryMovements(distributor(), {}, h.deps);
  const sql = h.captured[0]!.sql;
  expect(sql).toContain(
    "(src.distributor_assignment_id = $1 OR dest.distributor_assignment_id = $2)",
  );
  expect(h.captured[0]!.params.slice(0, 2)).toEqual([
    "assignment-distributor",
    "assignment-distributor",
  ]);
});

test("Super Admin reads are unrestricted but still bounded and ordered", async () => {
  const h = harness({ rowsFor: () => [requestRow()] });
  await listStockRequests(superAdmin(), {}, h.deps);
  const sql = h.captured[0]!.sql;
  expect(sql).toContain("WHERE TRUE");
  expect(sql).toContain("ORDER BY r.updated_at DESC");
  expect(sql).toContain("LIMIT $1 OFFSET $2");
});

test("exceptions list only exception-status requests in scope", async () => {
  const h = harness({
    rowsFor: () => [
      {
        id: REQUEST_ID,
        human_id: "DMS-000001",
        status: "exception",
        problem: "Two units arrived damaged",
        age_hours: 5.44,
        total_count: 1,
      },
    ],
  });
  const result = await listDistributionExceptions(distributor(), {}, h.deps);
  expect(h.captured[0]?.sql).toContain("r.status = 'exception'");
  expect(h.captured[0]?.sql).toContain("r.distributor_assignment_id = $1");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.rows[0]?.ageHours).toBe(5.4);
    expect(result.rows[0]?.problem).toBe("Two units arrived damaged");
  }
});

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

test("only active, unarchived governed SKUs are requestable", async () => {
  const h = harness({ rowsFor: () => [] });
  await listRequestableProductSkus(distributor(), "panel", h.deps);
  const sql = h.captured[0]!.sql;
  expect(sql).toContain("sku.status = 'active'");
  expect(sql).toContain("sku.archived_at IS NULL");
  expect(sql).toContain("variant.status = 'active'");
  expect(sql).toContain("product.status = 'active'");
  expect(h.captured[0]!.params[0]).toBe("%panel%");
});

test("destination locations are the caller's own active locations only", async () => {
  const h = harness({ rowsFor: () => [] });
  await listStockLocations(distributor(), { destinationsOnly: true }, h.deps);
  expect(h.captured[0]?.sql).toContain("loc.active = TRUE AND loc.distributor_assignment_id = $1");

  const asManager = harness({ rowsFor: () => [] });
  await listStockLocations(manager(), { destinationsOnly: true }, asManager.deps);
  // Managers approve; they do not receive.
  expect(asManager.captured[0]?.sql).toContain("WHERE FALSE");
});
