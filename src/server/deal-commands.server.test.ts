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
  commercial_approved?: boolean;
  customer_id?: string | null;
};

function installFakePool(dealRow: DealRow | null) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const calls: string[] = [];
    const updateCalls: Array<{ sql: string; params: unknown[] }> = [];
    let currentRow = dealRow;

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        const verb = sql.trim().split(/\s+/)[0]?.toUpperCase();
        calls.push(verb);

        if (verb === "SELECT") {
          return { rows: currentRow ? [currentRow] : [], rowCount: currentRow ? 1 : 0 };
        }
        if (verb === "UPDATE" && sql.includes("portal_deals")) {
          updateCalls.push({ sql, params: params ?? [] });
          if (currentRow) {
            currentRow = { ...currentRow, stage: String(params?.[1]), status: String(params?.[2]) };
          }
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };

    const originalConnect = pool.connect.bind(pool);
    pool.connect = (async () => fakeClient) as typeof pool.connect;

    return {
      calls,
      updateCalls,
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

function baseDealRow(overrides: Partial<DealRow> = {}): DealRow {
  return {
    id: "deal-1",
    stage: "sourced",
    status: "submitted",
    partner_id: "partner-1",
    country: "India",
    region: "India West",
    version: 3,
    account_name: "Acme Co",
    // §2.5: forward movement now requires registration approval — default
    // to already-approved so every pre-existing test in this file (written
    // before that gate existed) keeps exercising what it actually intends
    // to test, unless a test deliberately overrides this to prove the gate.
    commercial_approved: true,
    ...overrides,
  };
}

// Unlike installFakePool (which returns the deal row for every SELECT
// regardless of target table — fine when a test never issues a second kind
// of SELECT, but wrong for the §2.4 Distributor tag check, which runs its
// own `SELECT 1 FROM deal_participants ...`), this discriminates by SQL
// text so a distributor-tag test can control that query's result
// independently of the deal-row SELECT.
function installFakePoolWithParticipants(dealRow: DealRow | null, isTagged: boolean) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const calls: string[] = [];

    const fakeClient = {
      query: async (sql: string, _params?: unknown[]) => {
        const verb = sql.trim().split(/\s+/)[0]?.toUpperCase();
        calls.push(verb);
        if (verb === "SELECT" && sql.includes("deal_participants")) {
          return { rows: isTagged ? [{ "?column?": 1 }] : [], rowCount: isTagged ? 1 : 0 };
        }
        if (verb === "SELECT") {
          return { rows: dealRow ? [dealRow] : [], rowCount: dealRow ? 1 : 0 };
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };

    const originalConnect = pool.connect.bind(pool);
    pool.connect = (async () => fakeClient) as typeof pool.connect;

    return {
      calls,
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

// Discriminates by SQL text (unlike installFakePool, which returns the same
// deal row for every SELECT) so a submitDealForRegistration test can control
// the pricing_revisions lookup independently of the deal row.
function installFakePoolForRegistration(dealRow: DealRow, finalRevisionTotalDtpUsd: number | null) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const updateCalls: Array<{ sql: string; params: unknown[] }> = [];

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        const s = sql.trim();
        if (s.startsWith("BEGIN") || s.startsWith("COMMIT") || s.startsWith("ROLLBACK")) {
          return { rows: [], rowCount: 0 };
        }
        if (s.includes("FROM pricing_revisions")) {
          return {
            rows:
              finalRevisionTotalDtpUsd != null ? [{ total_dtp_usd: finalRevisionTotalDtpUsd }] : [],
            rowCount: finalRevisionTotalDtpUsd != null ? 1 : 0,
          };
        }
        if (s.includes("SELECT amount_usd, amount_value")) {
          return { rows: [{ amount_usd: null, amount_value: 0 }], rowCount: 1 };
        }
        if (s.includes("FROM portal_deals") && s.includes("FOR UPDATE")) {
          return { rows: [dealRow], rowCount: 1 };
        }
        if (s.startsWith("UPDATE")) {
          updateCalls.push({ sql: s, params: params ?? [] });
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

test("§2.5/§9.1/§9.7: submitDealForRegistration auto-approves without touching stage", async () => {
  const harness = await installFakePoolForRegistration(
    baseDealRow({ stage: "sourced", status: "draft" }),
    2000,
  )();
  try {
    const { submitDealForRegistration } = await import("@/server/deal-commands.server");
    const result = await submitDealForRegistration({
      actor: buildActor(),
      data: { dealId: "deal-1" },
    });
    expect(result.ok).toBe(true);
    expect(harness.updateCalls).toHaveLength(1);
    const sql = harness.updateCalls[0]?.sql ?? "";
    expect(sql).not.toContain("stage");
    expect(sql).toContain("status");
    expect(sql).toContain("commercial_approved");
    // status=$1, commercial_approved=$2 — approved + true for a $2,000 deal (below the $5,000 threshold).
    expect(harness.updateCalls[0]?.params[0]).toBe("approved");
    expect(harness.updateCalls[0]?.params[1]).toBe(true);
  } finally {
    harness.restore();
  }
});

test("§2.5/§9.1/§9.7: submitDealForRegistration requires manual review above the threshold, still without touching stage", async () => {
  const harness = await installFakePoolForRegistration(
    baseDealRow({ stage: "sourced", status: "draft" }),
    50000,
  )();
  try {
    const { submitDealForRegistration } = await import("@/server/deal-commands.server");
    const result = await submitDealForRegistration({
      actor: buildActor(),
      data: { dealId: "deal-1" },
    });
    expect(result.ok).toBe(true);
    const sql = harness.updateCalls[0]?.sql ?? "";
    expect(sql).not.toContain("stage");
    expect(harness.updateCalls[0]?.params[0]).toBe("submitted");
    expect(harness.updateCalls[0]?.params[1]).toBe(false);
  } finally {
    harness.restore();
  }
});

test("§2.5 path 2: reviewDealRegistration approves without touching stage", async () => {
  const harness = await installFakePoolForRegistration(
    baseDealRow({ stage: "demo", status: "submitted", commercial_approved: false }),
    null,
  )();
  try {
    const { reviewDealRegistration } = await import("@/server/deal-commands.server");
    const result = await reviewDealRegistration({
      actor: buildActor(),
      expectedVersion: 3,
      data: { dealId: "deal-1", decision: "approved", reason: "Looks good" },
    });
    expect(result.ok).toBe(true);
    expect(harness.updateCalls).toHaveLength(1);
    const sql = harness.updateCalls[0]?.sql ?? "";
    expect(sql).not.toContain("stage");
    expect(sql).toContain("status");
    expect(sql).toContain("commercial_approved");
    expect(harness.updateCalls[0]?.params[0]).toBe("approved");
    expect(harness.updateCalls[0]?.params[1]).toBe(true);
  } finally {
    harness.restore();
  }
});

test("§2.5 path 2: reviewDealRegistration rejects without flipping commercial_approved or touching stage", async () => {
  const harness = await installFakePoolForRegistration(
    baseDealRow({ stage: "proposal", status: "submitted", commercial_approved: false }),
    null,
  )();
  try {
    const { reviewDealRegistration } = await import("@/server/deal-commands.server");
    const result = await reviewDealRegistration({
      actor: buildActor(),
      expectedVersion: 3,
      data: { dealId: "deal-1", decision: "rejected", reason: "Missing paperwork" },
    });
    expect(result.ok).toBe(true);
    const sql = harness.updateCalls[0]?.sql ?? "";
    expect(sql).not.toContain("stage");
    expect(harness.updateCalls[0]?.params[0]).toBe("rejected");
    expect(harness.updateCalls[0]?.params[1]).toBe(false);
  } finally {
    harness.restore();
  }
});

test("§2.5 path 2: reviewDealRegistration records need_more_info without changing commercial_approved", async () => {
  const harness = await installFakePoolForRegistration(
    baseDealRow({ stage: "sourced", status: "submitted", commercial_approved: false }),
    null,
  )();
  try {
    const { reviewDealRegistration } = await import("@/server/deal-commands.server");
    const result = await reviewDealRegistration({
      actor: buildActor(),
      expectedVersion: 3,
      data: { dealId: "deal-1", decision: "need_more_info", reason: "Need a PO estimate" },
    });
    expect(result.ok).toBe(true);
    expect(harness.updateCalls[0]?.params[0]).toBe("need_more_info");
    expect(harness.updateCalls[0]?.params[1]).toBe(false);
  } finally {
    harness.restore();
  }
});

test("§2.5 path 2: reviewDealRegistration denies a non-super_admin actor, matching the UI's existing super_admin-only gate", async () => {
  const harness = await installFakePoolForRegistration(
    baseDealRow({ stage: "sourced", status: "submitted", partner_id: "partner-1" }),
    null,
  )();
  try {
    const { reviewDealRegistration } = await import("@/server/deal-commands.server");
    const actor = buildActor({
      roleKey: "pam",
      teamDomain: "sales",
      geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    });
    const result = await reviewDealRegistration({
      actor,
      expectedVersion: 3,
      data: { dealId: "deal-1", decision: "approved", reason: null },
    });
    expect(result.ok).toBe(false);
    expect(harness.updateCalls).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("§2.5 path 2: reviewDealRegistration rejects a stale expectedVersion with an optimistic-concurrency conflict", async () => {
  const harness = await installFakePoolForRegistration(
    baseDealRow({ stage: "sourced", status: "submitted", version: 5 }),
    null,
  )();
  try {
    const { reviewDealRegistration } = await import("@/server/deal-commands.server");
    const result = await reviewDealRegistration({
      actor: buildActor(),
      expectedVersion: 3,
      data: { dealId: "deal-1", decision: "approved", reason: null },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("OPTIMISTIC_CONFLICT");
    }
    expect(harness.updateCalls).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("moveDealStageForward denies when assignment is not active", async () => {
  const harness = await installFakePool(baseDealRow())();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const actor = buildActor({ status: "suspended" });
    const result = await moveDealStageForward({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
    }
  } finally {
    harness.restore();
  }
});

test("moveDealStageForward denies when partner-scoped assignment does not match the deal's partner", async () => {
  const harness = await installFakePool(baseDealRow({ partner_id: "partner-1" }))();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const actor = buildActor({
      roleKey: "partner_admin",
      teamDomain: "partner_success",
      partnerId: "partner-2",
    });
    const result = await moveDealStageForward({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
    }
  } finally {
    harness.restore();
  }
});

test("§2.4/§8.7a: moveDealStageForward denies a restricted_distributor whose own partner matches but who is not a tagged participant on the deal", async () => {
  const harness = await installFakePoolWithParticipants(
    baseDealRow({ partner_id: "partner-1" }),
    false,
  )();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const actor = buildActor({
      roleKey: "restricted_distributor",
      teamDomain: "partner_success",
      partnerId: "partner-1",
    });
    const result = await moveDealStageForward({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.failure.code === "POLICY_DENIED") {
      expect(result.failure.reason).toContain("not tagged");
    }
  } finally {
    harness.restore();
  }
});

test("§2.4/§8.7a: moveDealStageForward allows a restricted_distributor who is an active tagged participant on the deal", async () => {
  const harness = await installFakePoolWithParticipants(
    baseDealRow({ partner_id: "partner-1" }),
    true,
  )();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const actor = buildActor({
      roleKey: "restricted_distributor",
      teamDomain: "partner_success",
      partnerId: "partner-1",
    });
    const result = await moveDealStageForward({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(true);
  } finally {
    harness.restore();
  }
});

test("§2.4/§8.7a: createDeal never runs the participant-tag check (nothing to tag yet on a brand-new deal)", async () => {
  const harness = await installFakePoolWithParticipants(null, false)();
  try {
    const { createDeal } = await import("@/server/deal-commands.server");
    const actor = buildActor({
      roleKey: "restricted_distributor",
      teamDomain: "partner_success",
      partnerId: "partner-1",
    });
    const result = await createDeal({
      actor,
      data: {
        accountName: "Acme Co",
        contactName: "Jane Doe",
        product: "Widget",
        amount: "1000",
        partnerId: "partner-1",
        source: "manual",
      },
    });
    // isTagged is deliberately false in this harness — if createDeal's new
    // actor/deal literal (no `id` yet) ever started running the tag check
    // against a not-yet-created deal, this would fail closed and the
    // assertion below would catch it.
    expect(result.ok).toBe(true);
  } finally {
    harness.restore();
  }
});

test("moveDealStageForward denies a LIVEY-side assignment outside its geography ceiling", async () => {
  const harness = await installFakePool(
    baseDealRow({ country: "Singapore", region: "Asia Pacific" }),
  )();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const actor = buildActor({
      roleKey: "rm",
      teamDomain: "sales",
      geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
    });
    const result = await moveDealStageForward({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
    }
  } finally {
    harness.restore();
  }
});

test("moveDealStageForward allows a LIVEY-side assignment inside its geography ceiling", async () => {
  const harness = await installFakePool(baseDealRow({ country: "India", region: "India West" }))();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const actor = buildActor({
      roleKey: "rm",
      teamDomain: "sales",
      geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
    });
    const result = await moveDealStageForward({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(true);
  } finally {
    harness.restore();
  }
});

test("moveDealStageForward rejects a stale expectedVersion with an optimistic-concurrency conflict", async () => {
  const harness = await installFakePool(baseDealRow({ version: 5 }))();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await moveDealStageForward({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("OPTIMISTIC_CONFLICT");
      if (result.failure.code === "OPTIMISTIC_CONFLICT") {
        expect(result.failure.actualVersion).toBe(5);
      }
    }
  } finally {
    harness.restore();
  }
});

test("moveDealStageForward advances exactly one stage and bumps the version", async () => {
  const harness = await installFakePool(baseDealRow({ stage: "sourced", version: 3 }))();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await moveDealStageForward({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newVersion).toBe(4);
      expect(result.commandName).toBe("deal.move_stage_forward");
    }
    expect(harness.updateCalls).toHaveLength(1);
    expect(harness.updateCalls[0]?.params[1]).toBe("demo");
    expect(harness.calls).toEqual([
      "BEGIN",
      "SELECT",
      "UPDATE",
      "INSERT",
      "INSERT",
      "INSERT",
      "COMMIT",
    ]);
  } finally {
    harness.restore();
  }
});

test("§2.5/§9.9: moveDealStageForward denies a deal that has never been approved for registration", async () => {
  const harness = await installFakePool(
    baseDealRow({ stage: "sourced", version: 3, commercial_approved: false }),
  )();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const result = await moveDealStageForward({
      actor: buildActor(),
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain("registration approval");
    }
    expect(harness.updateCalls).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("§2.5/§9.9: moveDealStageForward allows a deal already approved for registration, at any pre-negotiation stage", async () => {
  const harness = await installFakePool(
    baseDealRow({ stage: "qualified", version: 3, commercial_approved: true }),
  )();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const result = await moveDealStageForward({
      actor: buildActor(),
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(true);
    expect(harness.updateCalls[0]?.params[1]).toBe("proposal");
  } finally {
    harness.restore();
  }
});

// 9g/§9.11: Testing -> Qualified must add the Partner's assigned PAM and
// Customer's assigned KAM in the same transaction, or block with a Coverage
// Exception when either mapping is missing. Discriminates by SQL text
// (unlike installFakePool) since this transition issues several different
// SELECTs (deal row, PAM assignment lookup, KAM participant lookup, an
// existing-participant check) plus INSERTs into deal_participants and/or
// coverage_exceptions on top of the usual transition writes.
function installFakePoolForHandoff(input: {
  dealRow: DealRow;
  pamUserId: string | null;
  kamUserId: string | null;
}) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const participantInserts: Array<{ sql: string; params: unknown[] }> = [];
    const coverageInserts: Array<{ sql: string; params: unknown[] }> = [];
    const dealUpdates: Array<{ sql: string; params: unknown[] }> = [];

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        const s = sql.trim();
        if (s.startsWith("BEGIN") || s.startsWith("COMMIT") || s.startsWith("ROLLBACK")) {
          return { rows: [], rowCount: 0 };
        }
        if (s.includes("FROM portal_deals") && s.includes("FOR UPDATE")) {
          return { rows: [input.dealRow], rowCount: 1 };
        }
        if (s.startsWith("SELECT user_id FROM assignments")) {
          return {
            rows: input.pamUserId ? [{ user_id: input.pamUserId }] : [],
            rowCount: input.pamUserId ? 1 : 0,
          };
        }
        if (s.startsWith("SELECT participant_user_id FROM customer_participants")) {
          return {
            rows: input.kamUserId ? [{ participant_user_id: input.kamUserId }] : [],
            rowCount: input.kamUserId ? 1 : 0,
          };
        }
        if (s.startsWith("SELECT 1 FROM deal_participants")) {
          // No pre-existing PAM/KAM tag in any of these tests.
          return { rows: [], rowCount: 0 };
        }
        if (s.startsWith("INSERT INTO deal_participants")) {
          participantInserts.push({ sql: s, params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        if (s.startsWith("INSERT INTO coverage_exceptions")) {
          coverageInserts.push({ sql: s, params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        if (s.startsWith("UPDATE portal_deals")) {
          dealUpdates.push({ sql: s, params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        if (
          s.startsWith("INSERT INTO deal_transitions") ||
          s.startsWith("INSERT INTO domain_activity_events") ||
          s.startsWith("INSERT INTO command_outbox")
        ) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unexpected query in handoff test: ${s}`);
      },
      release: () => undefined,
    };

    const originalConnect = pool.connect.bind(pool);
    pool.connect = (async () => fakeClient) as typeof pool.connect;

    return {
      participantInserts,
      coverageInserts,
      dealUpdates,
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

test("9g/§9.11: moveDealStageForward Testing->Qualified adds PAM and KAM and commits the stage move when both resolve", async () => {
  const harness = await installFakePoolForHandoff({
    dealRow: baseDealRow({
      stage: "testing",
      version: 3,
      partner_id: "partner-1",
      customer_id: "cust-1",
    }),
    pamUserId: "pam-user-1",
    kamUserId: "kam-user-1",
  })();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const result = await moveDealStageForward({
      actor: buildActor(),
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(true);
    expect(harness.dealUpdates).toHaveLength(1);
    expect(harness.dealUpdates[0]?.params[1]).toBe("qualified");
    expect(harness.participantInserts).toHaveLength(2);
    const participantTypes = harness.participantInserts.map((row) => row.params[3]);
    expect(participantTypes).toEqual(["PAM", "KAM"]);
    expect(harness.coverageInserts).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("9g/§9.11: moveDealStageForward Testing->Qualified blocks and opens a Coverage Exception when PAM is unresolved", async () => {
  const harness = await installFakePoolForHandoff({
    dealRow: baseDealRow({
      stage: "testing",
      version: 3,
      partner_id: "partner-1",
      customer_id: "cust-1",
    }),
    pamUserId: null,
    kamUserId: "kam-user-1",
  })();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const result = await moveDealStageForward({
      actor: buildActor(),
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain("PAM");
    }
    // The whole transition is blocked, not partially committed.
    expect(harness.dealUpdates).toHaveLength(0);
    // KAM still resolved, but its participant row must not be added either —
    // "creates a Coverage Exception rather than a partially tagged Deal."
    expect(harness.participantInserts).toHaveLength(0);
    expect(harness.coverageInserts).toHaveLength(1);
    expect(harness.coverageInserts[0]?.params[1]).toBe("pam");
    expect(harness.coverageInserts[0]?.params[2]).toBe("partner-1");
  } finally {
    harness.restore();
  }
});

test("9g/§9.11: moveDealStageForward Testing->Qualified blocks and opens a Coverage Exception when KAM is unresolved", async () => {
  const harness = await installFakePoolForHandoff({
    dealRow: baseDealRow({
      stage: "testing",
      version: 3,
      partner_id: "partner-1",
      customer_id: "cust-1",
    }),
    pamUserId: "pam-user-1",
    kamUserId: null,
  })();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const result = await moveDealStageForward({
      actor: buildActor(),
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.message).toContain("KAM");
    }
    expect(harness.dealUpdates).toHaveLength(0);
    expect(harness.participantInserts).toHaveLength(0);
    expect(harness.coverageInserts).toHaveLength(1);
    expect(harness.coverageInserts[0]?.params[1]).toBe("kam");
    expect(harness.coverageInserts[0]?.params[2]).toBe("cust-1");
  } finally {
    harness.restore();
  }
});

test("moveDealStageForward rejects moving forward out of a terminal stage", async () => {
  const harness = await installFakePool(baseDealRow({ stage: "won" }))();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await moveDealStageForward({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_FAILED");
    }
  } finally {
    harness.restore();
  }
});

test("moveDealStageForward requires the dedicated mark-won command from the last pre-close stage", async () => {
  const harness = await installFakePool(baseDealRow({ stage: "approved" }))();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await moveDealStageForward({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_FAILED");
    }
  } finally {
    harness.restore();
  }
});

test("moveDealStageBackward requires a non-empty reason", async () => {
  const harness = await installFakePool(baseDealRow({ stage: "negotiation" }))();
  try {
    const { moveDealStageBackward } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await moveDealStageBackward({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
      toStage: "demo",
      reason: "   ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_FAILED");
    }
    expect(harness.calls).toEqual([]);
  } finally {
    harness.restore();
  }
});

test("moveDealStageBackward moves to any earlier stage when reasoned", async () => {
  const harness = await installFakePool(baseDealRow({ stage: "negotiation", version: 3 }))();
  try {
    const { moveDealStageBackward } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await moveDealStageBackward({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
      toStage: "demo",
      reason: "Customer paused evaluation",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newVersion).toBe(4);
    }
    expect(harness.updateCalls[0]?.params[1]).toBe("demo");
  } finally {
    harness.restore();
  }
});

test("moveDealStageBackward rejects moving to a later stage", async () => {
  const harness = await installFakePool(baseDealRow({ stage: "demo" }))();
  try {
    const { moveDealStageBackward } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await moveDealStageBackward({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
      toStage: "negotiation",
      reason: "Not actually a backward move",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_FAILED");
    }
  } finally {
    harness.restore();
  }
});

test("markDealWon closes the deal and sets probability to 100", async () => {
  const harness = await installFakePool(baseDealRow({ stage: "negotiation", version: 3 }))();
  try {
    const { markDealWon } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await markDealWon({ actor, dealId: "deal-1", expectedVersion: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commandName).toBe("deal.mark_won");
      // A closed deal still advertises the reasoned reopen; the command
      // refuses it once the win has released reward points.
      expect(result.nextAuthorisedActions).toEqual(["deal.move_stage_backward"]);
    }
    const params = harness.updateCalls[0]?.params ?? [];
    expect(params[1]).toBe("won");
    expect(params[2]).toBe("won");
    expect(params[5]).toBe(100);
  } finally {
    harness.restore();
  }
});

// §9.15 "Selecting Won requires ... fulfilled stage requirements", and
// nextAuthorisedActions only ever advertised deal.mark_won from negotiation.
// Before this guard the command accepted any non-terminal stage, so a deal
// could be closed Won straight out of sourced — skipping every qualification
// gate and still becoming reward-eligible once its PO was approved.
test("markDealWon is rejected from any stage other than negotiation", async () => {
  for (const stage of ["sourced", "demo", "testing", "qualified", "proposal"]) {
    const harness = await installFakePool(baseDealRow({ stage, version: 3 }))();
    try {
      const { markDealWon } = await import("@/server/deal-commands.server");
      const result = await markDealWon({
        actor: buildActor(),
        dealId: "deal-1",
        expectedVersion: 3,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe("VALIDATION_FAILED");
        expect(result.failure.message).toContain("negotiation");
      }
      // Nothing may be written on a refused transition.
      expect(harness.updateCalls.length).toBe(0);
    } finally {
      harness.restore();
    }
  }
});

test("markDealLost is rejected once the deal is already closed", async () => {
  const harness = await installFakePool(baseDealRow({ stage: "lost" }))();
  try {
    const { markDealLost } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await markDealLost({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
      reason: "Partner went with a competitor",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_FAILED");
    }
  } finally {
    harness.restore();
  }
});

test("§9b/§9.15: markDealLost requires a non-empty reason", async () => {
  const harness = await installFakePool(baseDealRow())();
  try {
    const { markDealLost } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await markDealLost({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
      reason: "   ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_FAILED");
    }
    expect(harness.updateCalls).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("§9b/§9.15: markDealWon accepts an outcome date and PO choice, recording both without touching stage semantics", async () => {
  const harness = await installFakePool(baseDealRow({ stage: "negotiation" }))();
  try {
    const { markDealWon } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await markDealWon({
      actor,
      dealId: "deal-1",
      expectedVersion: 3,
      outcomeDate: "2026-08-06",
      poChoice: "later",
    });
    expect(result.ok).toBe(true);
    const params = harness.updateCalls[0]?.params ?? [];
    // stage=$2, status=$3, version=$4, last_touch=$5, probability=$6, close_date=$7, po_choice=$8
    expect(params[1]).toBe("won");
    expect(params[6]).toBe("2026-08-06");
    expect(params[7]).toBe("later");
  } finally {
    harness.restore();
  }
});

test("§9b/§9.15: markDealWon falls back to today's date and a null PO choice when neither is supplied", async () => {
  const harness = await installFakePool(baseDealRow({ stage: "negotiation" }))();
  try {
    const { markDealWon } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await markDealWon({ actor, dealId: "deal-1", expectedVersion: 3 });
    expect(result.ok).toBe(true);
    const params = harness.updateCalls[0]?.params ?? [];
    expect(typeof params[6]).toBe("string");
    expect(params[6]).not.toBe("");
    expect(params[7]).toBeNull();
  } finally {
    harness.restore();
  }
});

test("commands deny access without leaking whether the deal exists when the deal is missing", async () => {
  const harness = await installFakePool(null)();
  try {
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await moveDealStageForward({
      actor,
      dealId: "missing-deal",
      expectedVersion: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
      if (result.failure.code === "POLICY_DENIED") {
        expect(result.failure.subjectId).toBeNull();
        expect(result.failure.mayRevealRecordExistence).toBe(false);
      }
    }
  } finally {
    harness.restore();
  }
});

test("resolveDealCommandActor denies when the caller has no active context", async () => {
  const { resolveDealCommandActor } = await import("@/server/deal-commands.server");
  const result = resolveDealCommandActor({ userId: null, assignment: null, activeContext: null });
  expect(result.ok).toBe(false);
});

function installFakeCreatePool() {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const calls: string[] = [];
    const insertCalls: Array<{ sql: string; params: unknown[] }> = [];

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        const verb = sql.trim().split(/\s+/)[0]?.toUpperCase();
        calls.push(verb);
        if (verb === "INSERT") {
          insertCalls.push({ sql, params: params ?? [] });
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };

    const originalConnect = pool.connect.bind(pool);
    pool.connect = (async () => fakeClient) as typeof pool.connect;

    return {
      calls,
      insertCalls,
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

test("createDeal rejects a request missing required fields", async () => {
  const harness = await installFakeCreatePool()();
  try {
    const { createDeal } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await createDeal({
      actor,
      data: {
        accountName: "",
        contactName: "Jane Doe",
        product: "WC350",
        amount: "1000",
        source: "manual",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("VALIDATION_FAILED");
  } finally {
    harness.restore();
  }
});

test("createDeal forces a partner-scoped actor's own partner onto the new deal", async () => {
  const harness = await installFakeCreatePool()();
  try {
    const { createDeal } = await import("@/server/deal-commands.server");
    const actor = buildActor({
      roleKey: "partner_admin",
      teamDomain: "partner_success",
      partnerId: "partner-own",
    });
    const result = await createDeal({
      actor,
      data: {
        accountName: "Acme Co",
        contactName: "Jane Doe",
        ownerName: "Jane Doe",
        product: "WC350",
        amount: "1000",
        source: "manual",
        partnerId: "partner-someone-elses",
      },
    });
    expect(result.ok).toBe(true);
    const dealInsert = harness.insertCalls.find((call) => call.sql.includes("portal_deals"));
    // Index shifted by one when proposed_completion_date was inserted into the
    // column list ahead of close_date.
    expect(dealInsert?.params[28]).toBe("partner-own");
  } finally {
    harness.restore();
  }
});

test("createDeal denies a LIVEY-side actor outside their geography ceiling", async () => {
  const harness = await installFakeCreatePool()();
  try {
    const { createDeal } = await import("@/server/deal-commands.server");
    const actor = buildActor({
      roleKey: "rm",
      teamDomain: "sales",
      geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
    });
    const result = await createDeal({
      actor,
      data: {
        accountName: "Acme Co",
        contactName: "Jane Doe",
        ownerName: "Jane Doe",
        country: "Singapore",
        region: "Asia Pacific",
        product: "WC350",
        amount: "1000",
        source: "manual",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
    }
    expect(harness.insertCalls).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("createDeal always creates a new deal in draft status (auto-approval happens at registration submission)", async () => {
  const harness = await installFakeCreatePool()();
  try {
    const { createDeal } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await createDeal({
      actor,
      data: {
        accountName: "Acme Co",
        contactName: "Jane Doe",
        ownerName: "Jane Doe",
        product: "WC350",
        amount: "5000",
        source: "assistant",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newVersion).toBe(1);
      expect(result.commandName).toBe("deal.create");
    }
    const dealInsert = harness.insertCalls.find((call) => call.sql.includes("portal_deals"));
    expect(dealInsert?.params[8]).toBe("draft");
  } finally {
    harness.restore();
  }
});

// 9g/§9.3 Section 4: "assigned RM, automatic; ISR, automatic or routed."
test("9g: createDeal auto-tags the creating RM as a deal_participants row", async () => {
  const harness = await installFakeCreatePool()();
  try {
    const { createDeal } = await import("@/server/deal-commands.server");
    const actor = buildActor({ roleKey: "rm", teamDomain: "sales" });
    const result = await createDeal({
      actor,
      data: {
        accountName: "Acme Co",
        contactName: "Jane Doe",
        product: "WC350",
        amount: "5000",
        source: "manual",
      },
    });
    expect(result.ok).toBe(true);
    const participantInsert = harness.insertCalls.find((call) =>
      call.sql.includes("deal_participants"),
    );
    expect(participantInsert).toBeDefined();
    expect(participantInsert?.params[3]).toBe("RM");
    expect(participantInsert?.params[4]).toBe(actor.userId);
  } finally {
    harness.restore();
  }
});

test("9g: createDeal auto-tags the creating ISR as a deal_participants row", async () => {
  const harness = await installFakeCreatePool()();
  try {
    const { createDeal } = await import("@/server/deal-commands.server");
    const actor = buildActor({ roleKey: "isr", teamDomain: "sales" });
    const result = await createDeal({
      actor,
      data: {
        accountName: "Acme Co",
        contactName: "Jane Doe",
        product: "WC350",
        amount: "5000",
        source: "manual",
      },
    });
    expect(result.ok).toBe(true);
    const participantInsert = harness.insertCalls.find((call) =>
      call.sql.includes("deal_participants"),
    );
    expect(participantInsert?.params[3]).toBe("ISR");
  } finally {
    harness.restore();
  }
});

test("9g: createDeal adds no automatic RM/ISR tag when the creator holds neither role", async () => {
  const harness = await installFakeCreatePool()();
  try {
    const { createDeal } = await import("@/server/deal-commands.server");
    const actor = buildActor(); // super_admin
    const result = await createDeal({
      actor,
      data: {
        accountName: "Acme Co",
        contactName: "Jane Doe",
        product: "WC350",
        amount: "5000",
        source: "manual",
      },
    });
    expect(result.ok).toBe(true);
    const participantInsert = harness.insertCalls.find((call) =>
      call.sql.includes("deal_participants"),
    );
    expect(participantInsert).toBeUndefined();
  } finally {
    harness.restore();
  }
});

// --- Reopening a closed deal (product.md §9.10 + the §9.15 PO review table) ---
//
// "Lost can be reopened only through a reasoned, authorised backward
// movement", and the PO table's "PO Pending -> Not Applicable" / "Rejected
// Outcome -> Not Applicable" rows are both triggered by "moves Deal backward
// to Negotiation with reason". The hard limit is the other direction:
// "Approved Won is terminal for ordinary users", because by then the win has
// released reward points and this codebase has no compensating-debit path
// (adjustRewardPoints refuses any delta that would make a balance negative).

/**
 * Routes on SQL text, unlike installFakePool which answers every SELECT with
 * the deal row — the reopen guard issues a second, different SELECT whose
 * answer is the whole point of these tests.
 */
function installReopenPool(
  dealRow: DealRow,
  guard: { reviewApproved: boolean; rewardsAwarded: boolean },
) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const updateCalls: Array<{ sql: string; params: unknown[] }> = [];

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        const verb = sql.trim().split(/\s+/)[0]?.toUpperCase();
        if (verb === "SELECT" && sql.includes("reward_point_events")) {
          return {
            rows: [
              { review_approved: guard.reviewApproved, rewards_awarded: guard.rewardsAwarded },
            ],
            rowCount: 1,
          };
        }
        if (verb === "SELECT") return { rows: [dealRow], rowCount: 1 };
        if (verb === "UPDATE") {
          updateCalls.push({ sql, params: params ?? [] });
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
      dealUpdate: () => updateCalls.find((call) => call.sql.includes("portal_deals")),
      reviewUpdate: () => updateCalls.find((call) => call.sql.includes("deal_outcome_reviews")),
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

test("a lost deal reopens to negotiation, and stops looking closed while doing it", async () => {
  const harness = await installReopenPool(baseDealRow({ stage: "lost", status: "lost" }), {
    reviewApproved: false,
    rewardsAwarded: false,
  })();
  try {
    const { moveDealStageBackward } = await import("@/server/deal-commands.server");
    const result = await moveDealStageBackward({
      actor: buildActor(),
      dealId: "deal-1",
      expectedVersion: 3,
      toStage: "negotiation",
      reason: "Customer re-entered the process with new budget",
    });
    expect(result.ok).toBe(true);

    const update = harness.dealUpdate();
    expect(update?.params[1]).toBe("negotiation");
    // Leaving status as 'lost' would keep every status-filtered view counting
    // this as closed even though it is open again.
    expect(update?.params[2]).toBe("approved");
    // markDealLost set probability to 0 ("no chance"); reopened it is neither
    // 0 nor 100 but the middle option the app actually offers.
    expect(update?.sql).toContain("probability");
    expect(update?.params[5]).toBe(50);
    expect(update?.sql).toContain("po_choice = NULL");
    // The UPDATE must stay syntactically valid — a conditional write-set that
    // returns empty SQL previously produced a dangling comma here.
    expect(update?.sql).not.toContain(", ,");
    expect(update?.sql).not.toMatch(/,\s*WHERE/);

    // The PO review returns to Not Applicable, per the two PO-table rows.
    expect(harness.reviewUpdate()?.sql).toContain("not_applicable");
  } finally {
    harness.restore();
  }
});

test("a won deal whose reward points were already released cannot be reopened", async () => {
  const harness = await installReopenPool(baseDealRow({ stage: "won", status: "won" }), {
    reviewApproved: true,
    rewardsAwarded: true,
  })();
  try {
    const { moveDealStageBackward } = await import("@/server/deal-commands.server");
    const result = await moveDealStageBackward({
      actor: buildActor(),
      dealId: "deal-1",
      expectedVersion: 3,
      toStage: "negotiation",
      reason: "Commercial correction",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_FAILED");
      expect(result.failure.message).toContain("reward points");
    }
    // Nothing may be written on a refused reopen — not the deal, not the review.
    expect(harness.updateCalls.length).toBe(0);
  } finally {
    harness.restore();
  }
});

test("an approved outcome review blocks the reopen even with no ledger row", async () => {
  const harness = await installReopenPool(baseDealRow({ stage: "won", status: "won" }), {
    reviewApproved: true,
    rewardsAwarded: false,
  })();
  try {
    const { moveDealStageBackward } = await import("@/server/deal-commands.server");
    const result = await moveDealStageBackward({
      actor: buildActor(),
      dealId: "deal-1",
      expectedVersion: 3,
      toStage: "negotiation",
      reason: "Commercial correction",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.message).toContain("Approved Won");
    expect(harness.updateCalls.length).toBe(0);
  } finally {
    harness.restore();
  }
});

test("a closed deal reopens to negotiation and nowhere else", async () => {
  // isBackwardMove's index comparison passes won->sourced on its own, so
  // relaxing the terminal rule by deletion would have legalised every earlier
  // stage rather than the one product.md names.
  for (const toStage of ["sourced", "demo", "testing", "qualified", "proposal"] as const) {
    const harness = await installReopenPool(baseDealRow({ stage: "won", status: "won" }), {
      reviewApproved: false,
      rewardsAwarded: false,
    })();
    try {
      const { moveDealStageBackward } = await import("@/server/deal-commands.server");
      const result = await moveDealStageBackward({
        actor: buildActor(),
        dealId: "deal-1",
        expectedVersion: 3,
        toStage,
        reason: "Reopening too far",
      });
      expect(result.ok).toBe(false);
      expect(harness.updateCalls.length).toBe(0);
    } finally {
      harness.restore();
    }
  }
});

test("no backward move may land ON won or lost", async () => {
  for (const toStage of ["won", "lost"] as const) {
    const harness = await installReopenPool(baseDealRow({ stage: "negotiation" }), {
      reviewApproved: false,
      rewardsAwarded: false,
    })();
    try {
      const { moveDealStageBackward } = await import("@/server/deal-commands.server");
      const result = await moveDealStageBackward({
        actor: buildActor(),
        dealId: "deal-1",
        expectedVersion: 3,
        toStage,
        reason: "Trying to close through the backward path",
      });
      expect(result.ok).toBe(false);
      expect(harness.updateCalls.length).toBe(0);
    } finally {
      harness.restore();
    }
  }
});

test("an ordinary backward move is unchanged: status preserved, no probability rewrite", async () => {
  const harness = await installReopenPool(baseDealRow({ stage: "proposal", status: "submitted" }), {
    reviewApproved: false,
    rewardsAwarded: false,
  })();
  try {
    const { moveDealStageBackward } = await import("@/server/deal-commands.server");
    const result = await moveDealStageBackward({
      actor: buildActor(),
      dealId: "deal-1",
      expectedVersion: 3,
      toStage: "demo",
      reason: "Needs another demo",
    });
    expect(result.ok).toBe(true);
    const update = harness.dealUpdate();
    expect(update?.params[1]).toBe("demo");
    expect(update?.params[2]).toBe("submitted");
    // The reopen write-set must not leak onto ordinary backward moves.
    expect(update?.sql).not.toContain("probability");
    expect(update?.sql).not.toContain("po_choice");
    expect(harness.reviewUpdate()).toBeUndefined();
  } finally {
    harness.restore();
  }
});
