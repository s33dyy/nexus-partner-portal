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

function buildActor(overrides: Partial<AssignmentRecord> = {}): GovernedActor {
  const assignment = buildAssignment(overrides);
  return {
    userId: assignment.userId,
    assignment,
    activeContext: buildActiveContext(assignment),
  };
}

function installFakePool(existingRoles: string[]) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const calls: string[] = [];
    const insertCalls: Array<{ params: unknown[] }> = [];

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        const verb = sql.trim().split(/\s+/)[0]?.toUpperCase();
        calls.push(verb);
        if (verb === "SELECT") {
          return { rows: existingRoles.map((role) => ({ role })), rowCount: existingRoles.length };
        }
        if (verb === "INSERT" && sql.includes("user_roles")) {
          insertCalls.push({ params: params ?? [] });
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

test("changeUserRole rejects an unknown role", async () => {
  const { changeUserRole } = await import("@/server/user-role-commands.server");
  const result = await changeUserRole({
    actor: buildActor(),
    targetUserId: "user-a",
    newRole: "rm",
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failure.code).toBe("VALIDATION_FAILED");
  }
});

test("changeUserRole denies partner_admin escalating to super_admin", async () => {
  const harness = await installFakePool(["partner_user"])();
  try {
    const { changeUserRole } = await import("@/server/user-role-commands.server");
    const actor = buildActor({ roleKey: "partner_admin", teamDomain: "partner_success" });
    const result = await changeUserRole({
      actor,
      targetUserId: "user-a",
      newRole: "super_admin",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
    }
  } finally {
    harness.restore();
  }
});

test("changeUserRole allows partner_admin granting partner_user", async () => {
  const harness = await installFakePool(["partner_admin"])();
  try {
    const { changeUserRole } = await import("@/server/user-role-commands.server");
    const actor = buildActor({ roleKey: "partner_admin", teamDomain: "partner_success" });
    const result = await changeUserRole({
      actor,
      targetUserId: "user-a",
      newRole: "partner_user",
    });
    expect(result.ok).toBe(true);
    expect(harness.insertCalls).toHaveLength(1);
    expect(harness.insertCalls[0]?.params[1]).toBe("partner_user");
  } finally {
    harness.restore();
  }
});

test("changeUserRole denies when the assignment is not active", async () => {
  const harness = await installFakePool(["partner_user"])();
  try {
    const { changeUserRole } = await import("@/server/user-role-commands.server");
    const actor = buildActor({ status: "suspended" });
    const result = await changeUserRole({
      actor,
      targetUserId: "user-a",
      newRole: "partner_admin",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
    }
    expect(harness.calls).toEqual([]);
  } finally {
    harness.restore();
  }
});

test("changeUserRole is a no-op success when the role is unchanged", async () => {
  const harness = await installFakePool(["partner_admin"])();
  try {
    const { changeUserRole } = await import("@/server/user-role-commands.server");
    const result = await changeUserRole({
      actor: buildActor(),
      targetUserId: "user-a",
      newRole: "partner_admin",
    });
    expect(result.ok).toBe(true);
    expect(harness.insertCalls).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("changeUserRole denies without leaking existence when the user has no roles", async () => {
  const harness = await installFakePool([])();
  try {
    const { changeUserRole } = await import("@/server/user-role-commands.server");
    const result = await changeUserRole({
      actor: buildActor(),
      targetUserId: "missing-user",
      newRole: "partner_admin",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
      if (result.failure.code === "POLICY_DENIED") {
        expect(result.failure.subjectId).toBeNull();
      }
    }
  } finally {
    harness.restore();
  }
});

test("changeUserRole replaces the role set and writes activity/outbox atomically", async () => {
  const harness = await installFakePool(["partner_user"])();
  try {
    const { changeUserRole } = await import("@/server/user-role-commands.server");
    const result = await changeUserRole({
      actor: buildActor(),
      targetUserId: "user-a",
      newRole: "partner_admin",
      reason: "Promoted to admin",
    });
    expect(result.ok).toBe(true);
    expect(harness.calls).toEqual([
      "BEGIN",
      "SELECT",
      "DELETE",
      "INSERT",
      "INSERT",
      "INSERT",
      "COMMIT",
    ]);
  } finally {
    harness.restore();
  }
});
