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
            rows: finalRevisionTotalDtpUsd != null ? [{ total_dtp_usd: finalRevisionTotalDtpUsd }] : [],
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
  const harness = await installFakePool(baseDealRow({ stage: "approved", version: 3 }))();
  try {
    const { markDealWon } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await markDealWon({ actor, dealId: "deal-1", expectedVersion: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commandName).toBe("deal.mark_won");
      expect(result.nextAuthorisedActions).toEqual([]);
    }
    const params = harness.updateCalls[0]?.params ?? [];
    expect(params[1]).toBe("won");
    expect(params[2]).toBe("won");
    expect(params[5]).toBe(100);
  } finally {
    harness.restore();
  }
});

test("markDealLost is rejected once the deal is already closed", async () => {
  const harness = await installFakePool(baseDealRow({ stage: "lost" }))();
  try {
    const { markDealLost } = await import("@/server/deal-commands.server");
    const actor = buildActor();
    const result = await markDealLost({ actor, dealId: "deal-1", expectedVersion: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_FAILED");
    }
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
    expect(dealInsert?.params[27]).toBe("partner-own");
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
