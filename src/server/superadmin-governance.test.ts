import { expect, test } from "bun:test";

import {
  GOVERNANCE_GEOGRAPHY_NODE_IDS,
  GOVERNANCE_TENANT_IDS,
} from "@/domain/contracts/governance";

process.env.DATABASE_URL ??= "postgres://localhost/test";

type GovernanceState = {
  assignment: Record<string, unknown> | null;
  activeContext: Record<string, unknown> | null;
  assignmentIds: string[];
  contextIds: string[];
};

function assignmentRow(userId: string, assignmentId: string) {
  return {
    assignment_id: assignmentId,
    user_id: userId,
    tenant_id: GOVERNANCE_TENANT_IDS.liveyOrganization,
    organization_tenant_id: GOVERNANCE_TENANT_IDS.liveyOrganization,
    assignment_version: 1,
    assignment_status: "active",
    role_key: "super_admin",
    team_domain: "identity",
    geography_ceiling_node_id: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    partner_id: null,
    account_id: null,
    portfolio_id: null,
    queue_id: null,
    manager_assignment_id: null,
    source: "superadmin_governance_repair",
    approver_user_id: userId,
    predecessor_assignment_id: null,
    successor_assignment_id: null,
    valid_from: "2026-10-12T00:00:00.000Z",
    valid_to: null,
    revoked_at: null,
    revocation_reason: null,
    assignment_created_at: "2026-10-12T00:00:00.000Z",
    assignment_updated_at: "2026-10-12T00:00:00.000Z",
    assignment_is_seed: false,
  };
}

function contextRow(userId: string, assignmentId: string, contextId: string) {
  return {
    ...assignmentRow(userId, assignmentId),
    context_id: contextId,
    working_scope: null,
    issued_at: "2026-10-12T00:00:00.000Z",
    expires_at: "2026-10-12T08:00:00.000Z",
    version: 1,
    revocation_link: null,
    context_revoked_at: null,
    context_revocation_reason: null,
    correlation_id: contextId,
    context_is_seed: false,
    context_created_at: "2026-10-12T00:00:00.000Z",
    context_updated_at: "2026-10-12T00:00:00.000Z",
  };
}

function installGovernancePool(userId: string) {
  const state: GovernanceState = {
    assignment: null,
    activeContext: null,
    assignmentIds: [],
    contextIds: [],
  };

  return { state };
}

test("ensureSuperAdminGovernance repairs missing rows idempotently", async () => {
  const userId = "admin-1";
  const { pool } = await import("@/server/postgres.server");
  const { ensureSuperAdminGovernance } = await import("@/server/livey-service.server");
  const harness = installGovernancePool(userId);
  const originalConnect = pool.connect.bind(pool);

  const query = async (sql: string, params: unknown[] = []) => {
    const text = String(sql);
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("FROM user_roles")) {
      return { rows: [{ role: "super_admin" }], rowCount: 1 };
    }
    if (text.includes("FROM assignments") && text.includes("role_key")) {
      return {
        rows: harness.state.assignment ? [harness.state.assignment] : [],
        rowCount: harness.state.assignment ? 1 : 0,
      };
    }
    if (text.includes("FROM active_contexts")) {
      return {
        rows: harness.state.activeContext ? [harness.state.activeContext] : [],
        rowCount: harness.state.activeContext ? 1 : 0,
      };
    }
    if (text.includes("INSERT INTO assignments")) {
      const assignmentId = String(params[0]);
      harness.state.assignmentIds.push(assignmentId);
      harness.state.assignment = assignmentRow(userId, assignmentId);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("INSERT INTO active_contexts")) {
      const contextId = String(params[0]);
      const assignmentId = String(params[2]);
      harness.state.contextIds.push(contextId);
      harness.state.activeContext = contextRow(userId, assignmentId, contextId);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  };

  pool.connect = (async () =>
    ({
      query,
      release: () => undefined,
    }) as never) as typeof pool.connect;

  try {
    const first = await ensureSuperAdminGovernance(userId);
    const second = await ensureSuperAdminGovernance(userId);

    expect(first.assignment.assignmentId).toBe(second.assignment.assignmentId);
    expect(first.activeContext.contextId).toBe(second.activeContext.contextId);
    expect(harness.state.assignmentIds).toHaveLength(1);
    expect(harness.state.contextIds).toHaveLength(1);
  } finally {
    pool.connect = originalConnect as typeof pool.connect;
  }
});

test("resolveAuthContextForProfile repairs a super-admin before returning its actor context", async () => {
  const userId = "00000000-0000-4000-8000-000000000002";
  const { pool } = await import("@/server/postgres.server");
  const { resolveAuthContextForProfile } = await import("@/server/livey-service.server");
  const harness = installGovernancePool(userId);
  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);

  const query = async (sql: string, params: unknown[] = []) => {
    const text = String(sql);
    if (text.includes("INSERT INTO assignments")) {
      const assignmentId = String(params[0]);
      harness.state.assignmentIds.push(assignmentId);
      harness.state.assignment = assignmentRow(userId, assignmentId);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("INSERT INTO active_contexts")) {
      const contextId = String(params[0]);
      const assignmentId = String(params[2]);
      harness.state.contextIds.push(contextId);
      harness.state.activeContext = contextRow(userId, assignmentId, contextId);
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("FROM profiles WHERE id")) {
      return {
        rows: [
          {
            id: userId,
            email: "admin@example.com",
            full_name: "Admin",
            phone: null,
            company_name: "LIVEY",
            avatar_url: null,
            partner_id: null,
            partner_status: "approved",
            must_reset_password: false,
          },
        ],
        rowCount: 1,
      };
    }
    if (text.includes("FROM user_roles")) {
      return { rows: [{ role: "super_admin" }], rowCount: 1 };
    }
    if (text.includes("FROM active_contexts ac")) {
      return {
        rows: harness.state.activeContext ? [harness.state.activeContext] : [],
        rowCount: harness.state.activeContext ? 1 : 0,
      };
    }
    if (text.includes("FROM assignments a")) {
      return {
        rows: harness.state.assignment ? [harness.state.assignment] : [],
        rowCount: harness.state.assignment ? 1 : 0,
      };
    }
    return { rows: [], rowCount: 0 };
  };

  pool.query = query as typeof pool.query;
  pool.connect = (async () =>
    ({
      query,
      release: () => undefined,
    }) as never) as typeof pool.connect;

  try {
    const resolved = await resolveAuthContextForProfile(userId);

    expect(resolved.roles).toEqual(["super_admin"]);
    expect(resolved.assignment?.roleKey).toBe("super_admin");
    expect(resolved.activeContext?.assignmentId).toBe(resolved.assignment?.assignmentId);
  } finally {
    pool.query = originalQuery as typeof pool.query;
    pool.connect = originalConnect as typeof pool.connect;
  }
});
