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

function buildActiveContext(
  assignment: AssignmentRecord,
  overrides: Partial<ActiveContextRecord> = {},
): ActiveContextRecord {
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
    ...overrides,
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
  commercial_approved: boolean;
};

function baseDealRow(overrides: Partial<DealRow> = {}): DealRow {
  return {
    id: "deal-1",
    stage: "negotiation",
    status: "submitted",
    partner_id: "partner-1",
    country: "India",
    region: "India West",
    version: 3,
    account_name: "Acme Co",
    commercial_approved: true,
    ...overrides,
  };
}

type RewardDealInfo = {
  account_name: string;
  product: string;
  amount: string;
  amount_usd: string | number | null;
  reward_rate_percent: string | number;
  partner_id: string | null;
  user_id: string;
};

function baseRewardDealInfo(overrides: Partial<RewardDealInfo> = {}): RewardDealInfo {
  return {
    account_name: "Acme Co",
    product: "Widget Pro",
    amount: "$10,000",
    amount_usd: 10000,
    reward_rate_percent: 5,
    partner_id: "partner-1",
    user_id: "owner-user-1",
    ...overrides,
  };
}

function installFakePool(options: {
  dealRow: DealRow;
  rewardDealInfo: RewardDealInfo;
  finalRevisionTotal?: number | null;
  collaborators?: Array<{ user_id: string; split_percent: number; sort_order: number }>;
  existingRewardEvent?: boolean;
}) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const insertedRewardEvents: Array<{ sql: string; params: unknown[] }> = [];
    const updateCalls: Array<{ sql: string; params: unknown[] }> = [];

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        const s = sql.trim();
        if (s.startsWith("BEGIN") || s.startsWith("COMMIT") || s.startsWith("ROLLBACK")) {
          return { rows: [], rowCount: 0 };
        }
        if (s.includes("FROM portal_deals") && s.includes("FOR UPDATE")) {
          return { rows: [options.dealRow], rowCount: 1 };
        }
        if (
          s.includes("UPDATE deal_outcome_reviews") ||
          s.includes("UPDATE portal_deals SET stage")
        ) {
          updateCalls.push({ sql: s, params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        if (s.includes("FROM reward_point_events WHERE source_type")) {
          return {
            rows: options.existingRewardEvent ? [{ exists: true }] : [],
            rowCount: options.existingRewardEvent ? 1 : 0,
          };
        }
        if (s.includes("amount_usd") && s.includes("reward_rate_percent")) {
          return { rows: [options.rewardDealInfo], rowCount: 1 };
        }
        if (s.includes("FROM pricing_revisions")) {
          return {
            rows:
              options.finalRevisionTotal != null
                ? [{ total_dtp_usd: options.finalRevisionTotal }]
                : [],
            rowCount: options.finalRevisionTotal != null ? 1 : 0,
          };
        }
        if (s.includes("FROM portal_deal_collaborators")) {
          const rows = options.collaborators ?? [];
          return { rows, rowCount: rows.length };
        }
        if (s.includes("INSERT INTO reward_point_events")) {
          insertedRewardEvents.push({ sql: s, params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };

    const originalConnect = pool.connect.bind(pool);
    pool.connect = (async () => fakeClient) as typeof pool.connect;

    return {
      insertedRewardEvents,
      updateCalls,
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

test("approvePO awards reward points to the deal owner and moves the deal to won", async () => {
  const harness = await installFakePool({
    dealRow: baseDealRow(),
    rewardDealInfo: baseRewardDealInfo(),
  })();
  try {
    const { approvePO } = await import("@/server/outcome-review-commands.server");
    const result = await approvePO({
      actor: buildActor(),
      data: { dealId: "deal-1", reason: "PO verified" },
    });

    expect(result.ok).toBe(true);
    expect(harness.updateCalls.some((c) => c.sql.includes("UPDATE portal_deals SET stage"))).toBe(
      true,
    );
    expect(harness.insertedRewardEvents).toHaveLength(1);
    const [event] = harness.insertedRewardEvents;
    // 5% of $10,000 = 500 points, sole collaborator = deal owner.
    expect(event.params).toEqual([
      expect.any(String),
      "owner-user-1",
      "partner-1",
      "deal-1",
      500,
      "Acme Co closed won for Widget Pro",
      buildActor().userId,
      expect.any(String),
    ]);
  } finally {
    harness.restore();
  }
});

test("approvePO prefers the final pricing revision total over the free-text deal amount", async () => {
  const harness = await installFakePool({
    dealRow: baseDealRow(),
    rewardDealInfo: baseRewardDealInfo(),
    finalRevisionTotal: 20000,
  })();
  try {
    const { approvePO } = await import("@/server/outcome-review-commands.server");
    await approvePO({
      actor: buildActor(),
      data: { dealId: "deal-1", reason: "PO verified" },
    });

    expect(harness.insertedRewardEvents).toHaveLength(1);
    // 5% of the $20,000 final revision total (not the $10,000 free-text amount) = 1000.
    expect(harness.insertedRewardEvents[0]?.params[4]).toBe(1000);
  } finally {
    harness.restore();
  }
});

test("approvePO splits points across deal collaborators by sort order", async () => {
  const harness = await installFakePool({
    dealRow: baseDealRow(),
    rewardDealInfo: baseRewardDealInfo(),
    collaborators: [
      { user_id: "collab-a", split_percent: 60, sort_order: 0 },
      { user_id: "collab-b", split_percent: 40, sort_order: 1 },
    ],
  })();
  try {
    const { approvePO } = await import("@/server/outcome-review-commands.server");
    await approvePO({
      actor: buildActor(),
      data: { dealId: "deal-1", reason: "PO verified" },
    });

    expect(harness.insertedRewardEvents).toHaveLength(2);
    const byUser = Object.fromEntries(
      harness.insertedRewardEvents.map((event) => [event.params[1], event.params[4]]),
    );
    expect(byUser["collab-a"]).toBe(300);
    expect(byUser["collab-b"]).toBe(200);
  } finally {
    harness.restore();
  }
});

test("approvePO does not double-award if a reward event already exists for the deal", async () => {
  const harness = await installFakePool({
    dealRow: baseDealRow(),
    rewardDealInfo: baseRewardDealInfo(),
    existingRewardEvent: true,
  })();
  try {
    const { approvePO } = await import("@/server/outcome-review-commands.server");
    const result = await approvePO({
      actor: buildActor(),
      data: { dealId: "deal-1", reason: "PO verified" },
    });

    expect(result.ok).toBe(true);
    expect(harness.insertedRewardEvents).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("§2.6/§9.15: submitPO is accepted from negotiation", async () => {
  const harness = await installFakePool({
    dealRow: baseDealRow({ stage: "negotiation" }),
    rewardDealInfo: baseRewardDealInfo(),
  })();
  try {
    const { submitPO } = await import("@/server/outcome-review-commands.server");
    const result = await submitPO({
      actor: buildActor(),
      data: {
        dealId: "deal-1",
        poDocumentUrl: "https://example.com/po.pdf",
        poNumber: "PO-1",
        poDate: "2026-08-05",
        poAmount: 10000,
        currencyCode: "USD",
      },
    });
    expect(result.ok).toBe(true);
  } finally {
    harness.restore();
  }
});

test("§2.6/§9.15: submitPO is also accepted once the deal is already Won (PO Pending), not locked out", async () => {
  const harness = await installFakePool({
    dealRow: baseDealRow({ stage: "won" }),
    rewardDealInfo: baseRewardDealInfo(),
  })();
  try {
    const { submitPO } = await import("@/server/outcome-review-commands.server");
    const result = await submitPO({
      actor: buildActor(),
      data: {
        dealId: "deal-1",
        poDocumentUrl: "https://example.com/po.pdf",
        poNumber: "PO-1",
        poDate: "2026-08-05",
        poAmount: 10000,
        currencyCode: "USD",
      },
    });
    expect(result.ok).toBe(true);
  } finally {
    harness.restore();
  }
});

test("§2.6/§9.15: submitPO is still denied outside negotiation/won (e.g. qualified)", async () => {
  const harness = await installFakePool({
    dealRow: baseDealRow({ stage: "qualified" }),
    rewardDealInfo: baseRewardDealInfo(),
  })();
  try {
    const { submitPO } = await import("@/server/outcome-review-commands.server");
    const result = await submitPO({
      actor: buildActor(),
      data: {
        dealId: "deal-1",
        poDocumentUrl: "https://example.com/po.pdf",
        poNumber: "PO-1",
        poDate: "2026-08-05",
        poAmount: 10000,
        currencyCode: "USD",
      },
    });
    expect(result.ok).toBe(false);
  } finally {
    harness.restore();
  }
});

test("approvePO denies a non-super_admin actor and awards nothing", async () => {
  const harness = await installFakePool({
    dealRow: baseDealRow(),
    rewardDealInfo: baseRewardDealInfo(),
  })();
  try {
    const { approvePO } = await import("@/server/outcome-review-commands.server");
    const result = await approvePO({
      actor: buildActor({ roleKey: "partner_admin", partnerId: "partner-1" }),
      data: { dealId: "deal-1", reason: "PO verified" },
    });

    expect(result.ok).toBe(false);
    expect(harness.insertedRewardEvents).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("§2.7: approvePO now allows a PAM inside their geography scope, not just super_admin", async () => {
  const harness = await installFakePool({
    dealRow: baseDealRow({ country: "India", region: "India West" }),
    rewardDealInfo: baseRewardDealInfo(),
  })();
  try {
    const { approvePO } = await import("@/server/outcome-review-commands.server");
    const result = await approvePO({
      actor: buildActor({
        roleKey: "pam",
        teamDomain: "partner_success",
        geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
      }),
      data: { dealId: "deal-1", reason: "PO verified" },
    });

    expect(result.ok).toBe(true);
    expect(harness.insertedRewardEvents).toHaveLength(1);
  } finally {
    harness.restore();
  }
});

test("§2.7: approvePO still denies an RM outside their geography scope (not a blanket role grant)", async () => {
  const harness = await installFakePool({
    dealRow: baseDealRow({ country: "Singapore", region: "Asia Pacific" }),
    rewardDealInfo: baseRewardDealInfo(),
  })();
  try {
    const { approvePO } = await import("@/server/outcome-review-commands.server");
    const result = await approvePO({
      actor: buildActor({
        roleKey: "rm",
        teamDomain: "sales",
        geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
      }),
      data: { dealId: "deal-1", reason: "PO verified" },
    });

    expect(result.ok).toBe(false);
    expect(harness.insertedRewardEvents).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("§2.7: approvePO still denies a KAM (not a named PO-review role, even in scope)", async () => {
  const harness = await installFakePool({
    dealRow: baseDealRow({ country: "India", region: "India West" }),
    rewardDealInfo: baseRewardDealInfo(),
  })();
  try {
    const { approvePO } = await import("@/server/outcome-review-commands.server");
    const result = await approvePO({
      actor: buildActor({
        roleKey: "kam",
        teamDomain: "partner_success",
        geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
      }),
      data: { dealId: "deal-1", reason: "PO verified" },
    });

    expect(result.ok).toBe(false);
    expect(harness.insertedRewardEvents).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("§2.7: requestChanges and rejectOutcome also accept a scoped RM, not just super_admin", async () => {
  const harnessChanges = await installFakePool({
    dealRow: baseDealRow({ country: "India", region: "India West" }),
    rewardDealInfo: baseRewardDealInfo(),
  })();
  try {
    const { requestChanges } = await import("@/server/outcome-review-commands.server");
    const result = await requestChanges({
      actor: buildActor({
        roleKey: "rm",
        teamDomain: "sales",
        geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
      }),
      data: { dealId: "deal-1", reason: "Need updated PO" },
    });
    expect(result.ok).toBe(true);
  } finally {
    harnessChanges.restore();
  }

  const harnessReject = await installFakePool({
    dealRow: baseDealRow({ country: "India", region: "India West" }),
    rewardDealInfo: baseRewardDealInfo(),
  })();
  try {
    const { rejectOutcome } = await import("@/server/outcome-review-commands.server");
    const result = await rejectOutcome({
      actor: buildActor({
        roleKey: "rm",
        teamDomain: "sales",
        geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
      }),
      data: { dealId: "deal-1", reason: "PO invalid" },
    });
    expect(result.ok).toBe(true);
  } finally {
    harnessReject.restore();
  }
});
