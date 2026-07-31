import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import type { DealCommandActor } from "@/server/deal-commands.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

const ISSUED_AT = "2026-07-30T00:00:00.000Z";

function buildAssignment(overrides: Partial<AssignmentRecord> = {}): AssignmentRecord {
  return {
    assignmentId: "assignment-1",
    userId: "11111111-1111-1111-1111-111111111111",
    tenantId: "tenant-livey-org",
    organizationTenantId: "tenant-livey-org",
    roleKey: "super_admin",
    teamDomain: "identity",
    geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    partnerId: null,
    accountId: null,
    portfolioId: null,
    queueId: null,
    status: "active",
    validFrom: ISSUED_AT,
    validTo: null,
    managerAssignmentId: null,
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
}

function buildActiveContext(assignment: AssignmentRecord): ActiveContextRecord {
  return {
    contextId: "context-1",
    userId: assignment.userId,
    assignmentId: assignment.assignmentId,
    assignmentStatus: assignment.status,
    tenantId: assignment.tenantId,
    organizationTenantId: assignment.organizationTenantId,
    workingScope: null,
    issuedAt: ISSUED_AT,
    expiresAt: "2026-07-30T08:00:00.000Z",
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
}

function buildActor(overrides: Partial<AssignmentRecord> = {}): DealCommandActor {
  const assignment = buildAssignment(overrides);
  return {
    userId: assignment.userId,
    assignment,
    activeContext: buildActiveContext(assignment),
  };
}

type DealRow = {
  id: string;
  stage: string;
  status: string;
  partner_id: string | null;
  country: string | null;
  region: string | null;
  version: number;
  account_name: string;
};

function baseDealRow(overrides: Partial<DealRow> = {}): DealRow {
  return {
    id: "deal-1",
    stage: "proposal",
    status: "submitted",
    partner_id: "partner-1",
    country: "India",
    region: "India",
    version: 3,
    account_name: "Acme Co",
    ...overrides,
  };
}

function installFakePool(dealRow: DealRow | null) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const updateCalls: Array<{ sql: string; params: unknown[] }> = [];

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        const text = sql.trim();
        if (text.includes("FROM portal_deals") && text.includes("FOR UPDATE")) {
          return { rows: dealRow ? [dealRow] : [], rowCount: dealRow ? 1 : 0 };
        }
        if (text.startsWith("UPDATE discount_requests")) {
          updateCalls.push({ sql: text, params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        if (text.includes("FROM discount_requests WHERE id")) {
          return {
            rows: [{ line_item_id: "line-1", requested_discount_pct: 10 }],
            rowCount: 1,
          };
        }
        if (text.startsWith("UPDATE deal_line_items")) {
          updateCalls.push({ sql: text, params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };

    const originalConnect = pool.connect.bind(pool);
    pool.connect = (async () => fakeClient) as typeof pool.connect;

    return {
      updateCalls,
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

test("approveDiscount denies a PAM whose geography ceiling doesn't cover the deal's country (tenant/region isolation)", async () => {
  const harness = await installFakePool(baseDealRow({ country: "India", region: "India" }))();
  try {
    const { approveDiscount } = await import("@/server/pricing-commands.server");
    const actor = buildActor({
      roleKey: "pam",
      teamDomain: "sales",
      partnerId: null,
      geographyCeilingNodeId: "geo-region-europe",
    });
    const result = await approveDiscount({
      actor,
      data: { dealId: "deal-1", requestId: "req-1", approved: true },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
    }
    expect(harness.updateCalls).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("approveDiscount allows a PAM with Global geography ceiling", async () => {
  const harness = await installFakePool(baseDealRow())();
  try {
    const { approveDiscount } = await import("@/server/pricing-commands.server");
    const actor = buildActor({
      roleKey: "pam",
      teamDomain: "sales",
      partnerId: null,
      geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    });
    const result = await approveDiscount({
      actor,
      data: { dealId: "deal-1", requestId: "req-1", approved: true },
    });
    expect(result.ok).toBe(true);
    expect(harness.updateCalls.some((c) => c.sql.startsWith("UPDATE deal_line_items"))).toBe(true);
  } finally {
    harness.restore();
  }
});

test("approveDiscount still denies a partner_admin (role check, unchanged)", async () => {
  const harness = await installFakePool(baseDealRow())();
  try {
    const { approveDiscount } = await import("@/server/pricing-commands.server");
    const actor = buildActor({
      roleKey: "partner_admin",
      teamDomain: "partner_success",
      partnerId: "partner-1",
    });
    const result = await approveDiscount({
      actor,
      data: { dealId: "deal-1", requestId: "req-1", approved: true },
    });
    expect(result.ok).toBe(false);
    expect(harness.updateCalls).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("approveDiscount denies existence-safe when the deal is missing", async () => {
  const harness = await installFakePool(null)();
  try {
    const { approveDiscount } = await import("@/server/pricing-commands.server");
    const result = await approveDiscount({
      actor: buildActor(),
      data: { dealId: "missing-deal", requestId: "req-1", approved: true },
    });
    expect(result.ok).toBe(false);
  } finally {
    harness.restore();
  }
});
