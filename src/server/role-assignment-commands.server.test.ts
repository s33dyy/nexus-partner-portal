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

function installFakePool(options: {
  targetExists?: boolean;
  knownGeographyNodeIds?: string[];
  roleGeographyRows?: string[];
}) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const insertAssignmentCalls: Array<{ params: unknown[] }> = [];

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM profiles WHERE id")) {
          return {
            rows: options.targetExists === false ? [] : [{ id: "target-user" }],
            rowCount: options.targetExists === false ? 0 : 1,
          };
        }
        if (sql.includes("FROM geography_nodes WHERE node_id")) {
          const nodeId = params?.[0] as string;
          const known = options.knownGeographyNodeIds ?? [];
          return {
            rows: known.includes(nodeId) ? [{ node_id: nodeId }] : [],
            rowCount: known.includes(nodeId) ? 1 : 0,
          };
        }
        if (sql.includes("FROM role_geography_access")) {
          const rows = (options.roleGeographyRows ?? []).map((nodeId) => ({
            geography_node_id: nodeId,
          }));
          return { rows, rowCount: rows.length };
        }
        if (sql.trim().startsWith("INSERT INTO assignments")) {
          insertAssignmentCalls.push({ params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };

    const originalConnect = pool.connect.bind(pool);
    pool.connect = (async () => fakeClient) as typeof pool.connect;

    return {
      insertAssignmentCalls,
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

test("assignGovernedRole uses the explicit geographyCeilingNodeId when provided and valid", async () => {
  const harness = await installFakePool({
    knownGeographyNodeIds: ["geo-country-in"],
  })();
  try {
    const { assignGovernedRole } = await import("@/server/role-assignment-commands.server");
    const result = await assignGovernedRole({
      actor: buildActor(),
      targetUserId: "target-user",
      roleKey: "rm",
      geographyCeilingNodeId: "geo-country-in",
    });
    expect(result.ok).toBe(true);
    // assignments INSERT column order: assignment_id, user_id, tenant_id,
    // organization_tenant_id, role_key, team_domain, geography_ceiling_node_id, ...
    expect(harness.insertAssignmentCalls[0]?.params[6]).toBe("geo-country-in");
  } finally {
    harness.restore();
  }
});

test("assignGovernedRole falls back to the role's default geography when none is given", async () => {
  const harness = await installFakePool({
    roleGeographyRows: ["geo-region-india"],
  })();
  try {
    const { assignGovernedRole } = await import("@/server/role-assignment-commands.server");
    const result = await assignGovernedRole({
      actor: buildActor(),
      targetUserId: "target-user",
      roleKey: "rm",
    });
    expect(result.ok).toBe(true);
    expect(harness.insertAssignmentCalls[0]?.params[6]).toBe("geo-region-india");
  } finally {
    harness.restore();
  }
});

test("assignGovernedRole rejects an unknown geography node id rather than writing garbage into the FK column", async () => {
  const harness = await installFakePool({
    knownGeographyNodeIds: ["geo-country-in"],
  })();
  try {
    const { assignGovernedRole } = await import("@/server/role-assignment-commands.server");
    const result = await assignGovernedRole({
      actor: buildActor(),
      targetUserId: "target-user",
      roleKey: "rm",
      geographyCeilingNodeId: "not-a-real-node",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_FAILED");
    }
    expect(harness.insertAssignmentCalls).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("assignGovernedRole denies a non-super_admin actor regardless of geography input", async () => {
  const harness = await installFakePool({})();
  try {
    const { assignGovernedRole } = await import("@/server/role-assignment-commands.server");
    const result = await assignGovernedRole({
      actor: buildActor({ roleKey: "partner_admin" }),
      targetUserId: "target-user",
      roleKey: "partner_user",
      geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    });
    expect(result.ok).toBe(false);
    expect(harness.insertAssignmentCalls).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("saveRolePermissions no longer accepts or touches geography — feature matrix only", async () => {
  const harness = await installFakePool({})();
  try {
    const { saveRolePermissions } = await import("@/server/role-assignment-commands.server");
    const { FEATURE_KEYS } = await import("@/domain/contracts/features");
    const capabilities = Object.fromEntries(
      FEATURE_KEYS.map((key) => [key, { create: false, read: true, update: false, delete: false }]),
    ) as Record<
      (typeof FEATURE_KEYS)[number],
      { create: boolean; read: boolean; update: boolean; delete: boolean }
    >;

    const result = await saveRolePermissions({
      actor: buildActor(),
      roleKey: "rm",
      capabilities,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result).not.toHaveProperty("affectedUserCount");
    }
  } finally {
    harness.restore();
  }
});
