import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import type { GovernedActor } from "@/server/governed-actor.server";

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

function buildActor(overrides: Partial<AssignmentRecord> = {}): GovernedActor {
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
    stage: "sourced",
    status: "draft",
    partner_id: "partner-1",
    country: "India",
    region: "India",
    version: 1,
    account_name: "Acme Corp",
    commercial_approved: false,
    ...overrides,
  };
}

type CustomerRow = { id: string; partner_id: string | null; company_name: string };

function baseCustomerRow(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return { id: "customer-1", partner_id: "partner-1", company_name: "Acme Corp", ...overrides };
}

type FakeQuery = { sql: string; params: unknown[] };

function installFakePool(options: { dealRow?: DealRow | null; customerRow?: CustomerRow | null }) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const queries: FakeQuery[] = [];

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params: params ?? [] });
        if (sql.includes("FROM portal_deals")) {
          const row = options.dealRow ?? null;
          return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        if (sql.includes("FROM portal_customers")) {
          const row = options.customerRow ?? null;
          return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };

    const originalConnect = pool.connect.bind(pool);
    pool.connect = (async () => fakeClient) as typeof pool.connect;

    return {
      queries,
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

function insertsInto(queries: FakeQuery[], table: string) {
  return queries.filter((q) => q.sql.includes(`INSERT INTO ${table}`));
}

// ─── tagDealParticipant ─────────────────────────────────────────────────────

test("tagDealParticipant denies for a deal that doesn't exist", async () => {
  const harness = await installFakePool({ dealRow: null })();
  try {
    const { tagDealParticipant } = await import("@/server/participant-commands.server");
    const result = await tagDealParticipant({
      actor: buildActor(),
      data: {
        dealId: "missing",
        participantUserId: "user-9",
        participantType: "PAM",
        reason: "coverage",
      },
    });
    expect(result.ok).toBe(false);
  } finally {
    harness.restore();
  }
});

test("tagDealParticipant denies when a partner-scoped actor doesn't match the deal's partner", async () => {
  const harness = await installFakePool({ dealRow: baseDealRow({ partner_id: "partner-1" }) })();
  try {
    const { tagDealParticipant } = await import("@/server/participant-commands.server");
    const actor = buildActor({ roleKey: "partner_admin", partnerId: "partner-2" });
    const result = await tagDealParticipant({
      actor,
      data: {
        dealId: "deal-1",
        participantUserId: "user-9",
        participantType: "PAM",
        reason: "coverage",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});

test("tagDealParticipant persists participant_user_id and creates a task for the tagged person", async () => {
  const harness = await installFakePool({ dealRow: baseDealRow() })();
  try {
    const { tagDealParticipant } = await import("@/server/participant-commands.server");
    const result = await tagDealParticipant({
      actor: buildActor(),
      data: {
        dealId: "deal-1",
        participantUserId: "user-9",
        participantType: "PAM",
        reason: "coverage",
      },
    });
    expect(result.ok).toBe(true);

    const participantInserts = insertsInto(harness.queries, "deal_participants");
    expect(participantInserts).toHaveLength(1);
    // params: id, deal_id, partner_id, participant_type, actor_id, participant_user_id, reason
    // ('source' is a literal in the SQL, not a bound param)
    expect(participantInserts[0].params[4]).toBe(buildActor().userId); // actor_id
    expect(participantInserts[0].params[5]).toBe("user-9"); // participant_user_id — previously dropped entirely

    const taskInserts = insertsInto(harness.queries, "tasks");
    expect(taskInserts).toHaveLength(1);
    // related_type, related_id, assignee_id, creator_id, partner_id
    expect(taskInserts[0].params[3]).toBe("deal");
    expect(taskInserts[0].params[4]).toBe("deal-1");
    expect(taskInserts[0].params[5]).toBe("user-9");
    expect(taskInserts[0].params[6]).toBe(buildActor().userId);
    expect(taskInserts[0].params[7]).toBe("partner-1");
  } finally {
    harness.restore();
  }
});

test("tagDealParticipant skips task creation when no specific person is tagged", async () => {
  const harness = await installFakePool({ dealRow: baseDealRow() })();
  try {
    const { tagDealParticipant } = await import("@/server/participant-commands.server");
    const result = await tagDealParticipant({
      actor: buildActor(),
      data: {
        dealId: "deal-1",
        participantUserId: "   ",
        participantType: "PAM",
        reason: "coverage",
      },
    });
    expect(result.ok).toBe(true);
    expect(insertsInto(harness.queries, "tasks")).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

// ─── tagCustomerParticipant ─────────────────────────────────────────────────

test("tagCustomerParticipant denies for a customer that doesn't exist", async () => {
  const harness = await installFakePool({ customerRow: null })();
  try {
    const { tagCustomerParticipant } = await import("@/server/participant-commands.server");
    const result = await tagCustomerParticipant({
      actor: buildActor(),
      data: {
        customerId: "missing",
        participantUserId: "user-9",
        participantType: "KAM",
        reason: "coverage",
      },
    });
    expect(result.ok).toBe(false);
  } finally {
    harness.restore();
  }
});

test("tagCustomerParticipant denies when a partner-scoped actor doesn't match the customer's partner", async () => {
  const harness = await installFakePool({
    customerRow: baseCustomerRow({ partner_id: "partner-1" }),
  })();
  try {
    const { tagCustomerParticipant } = await import("@/server/participant-commands.server");
    const actor = buildActor({ roleKey: "partner_user", partnerId: "partner-2" });
    const result = await tagCustomerParticipant({
      actor,
      data: {
        customerId: "customer-1",
        participantUserId: "user-9",
        participantType: "KAM",
        reason: "coverage",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});

test("tagCustomerParticipant persists participant_user_id and creates a task for the tagged person", async () => {
  const harness = await installFakePool({ customerRow: baseCustomerRow() })();
  try {
    const { tagCustomerParticipant } = await import("@/server/participant-commands.server");
    const result = await tagCustomerParticipant({
      actor: buildActor(),
      data: {
        customerId: "customer-1",
        participantUserId: "user-9",
        participantType: "KAM",
        reason: "coverage",
      },
    });
    expect(result.ok).toBe(true);

    const participantInserts = insertsInto(harness.queries, "customer_participants");
    expect(participantInserts).toHaveLength(1);
    expect(participantInserts[0].params[5]).toBe("user-9"); // participant_user_id

    const taskInserts = insertsInto(harness.queries, "tasks");
    expect(taskInserts).toHaveLength(1);
    expect(taskInserts[0].params[3]).toBe("customer");
    expect(taskInserts[0].params[4]).toBe("customer-1");
    expect(taskInserts[0].params[5]).toBe("user-9");
    expect(taskInserts[0].params[7]).toBe("partner-1");
  } finally {
    harness.restore();
  }
});

test("tagCustomerParticipant skips task creation when no specific person is tagged", async () => {
  const harness = await installFakePool({ customerRow: baseCustomerRow() })();
  try {
    const { tagCustomerParticipant } = await import("@/server/participant-commands.server");
    const result = await tagCustomerParticipant({
      actor: buildActor(),
      data: {
        customerId: "customer-1",
        participantUserId: "",
        participantType: "KAM",
        reason: "coverage",
      },
    });
    expect(result.ok).toBe(true);
    expect(insertsInto(harness.queries, "tasks")).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("untagCustomerParticipant denies when a partner-scoped actor doesn't match the customer's partner", async () => {
  const harness = await installFakePool({
    customerRow: baseCustomerRow({ partner_id: "partner-1" }),
  })();
  try {
    const { untagCustomerParticipant } = await import("@/server/participant-commands.server");
    const actor = buildActor({ roleKey: "partner_user", partnerId: "partner-2" });
    const result = await untagCustomerParticipant({
      actor,
      data: { customerId: "customer-1", participantId: "participant-1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});
