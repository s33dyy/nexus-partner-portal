import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import type { TaskCommandActor } from "@/server/task-commands.server";

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

function buildActor(overrides: Partial<AssignmentRecord> = {}): TaskCommandActor {
  const assignment = buildAssignment(overrides);
  return {
    userId: assignment.userId,
    assignment,
    activeContext: buildActiveContext(assignment),
  };
}

type TaskRow = {
  id: string;
  status: string;
  partner_id: string | null;
  version: number;
  title: string;
  assignee_id?: string | null;
  creator_id?: string | null;
  organization_tenant_id?: string;
  role_key?: string;
  geography_ceiling_node_id?: string;
  tenant_id?: string;
};

function baseTaskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task-1",
    status: "to_do",
    partner_id: "partner-1",
    version: 2,
    title: "Follow up with Acme",
    ...overrides,
  };
}

function installFakePool(taskRow: TaskRow | null, taskUpdateOverride?: boolean) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const calls: string[] = [];
    const updateCalls: Array<{ sql: string; params: unknown[] }> = [];
    let currentRow = taskRow;

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        const verb = sql.trim().split(/\s+/)[0]?.toUpperCase();
        calls.push(verb);

        if (verb === "SELECT") {
          return { rows: currentRow ? [currentRow] : [], rowCount: currentRow ? 1 : 0 };
        }
        if (verb === "UPDATE" && sql.includes("tasks")) {
          updateCalls.push({ sql, params: params ?? [] });
          if (currentRow) {
            currentRow = {
              ...currentRow,
              status: String(params?.[1]),
              version: Number(params?.[2]),
            };
          }
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };

    const originalConnect = pool.connect.bind(pool);
    const originalQuery = pool.query.bind(pool);
    pool.connect = (async () => fakeClient) as typeof pool.connect;
    pool.query = (async (sql: string) => {
      if (String(sql).includes("FROM role_permissions")) {
        return {
          rows: [
            {
              feature_key: "tasks",
              can_create: true,
              can_read: true,
              can_update: true,
              can_delete: true,
            },
          ],
          rowCount: 1,
        } as never;
      }
      if (String(sql).includes("FROM user_access_overrides")) {
        return {
          rows:
            taskUpdateOverride === undefined
              ? []
              : [{ feature_key: "tasks", operation: "update", decision: taskUpdateOverride ? "allow" : "deny" }],
          rowCount: taskUpdateOverride === undefined ? 0 : 1,
        } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    }) as typeof pool.query;

    return {
      calls,
      updateCalls,
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
        pool.query = originalQuery as typeof pool.query;
      },
    };
  };
}

test("transitionTask denies a suspended assignment", async () => {
  const harness = await installFakePool(baseTaskRow())();
  try {
    const { transitionTask } = await import("@/server/task-commands.server");
    const actor = buildActor({ status: "suspended" });
    const result = await transitionTask({
      actor,
      taskId: "task-1",
      expectedVersion: 2,
      toStatus: "in_progress",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});

test("transitionTask denies when partner-scoped assignment does not match the task's partner", async () => {
  const harness = await installFakePool(baseTaskRow({ partner_id: "partner-1" }))();
  try {
    const { transitionTask } = await import("@/server/task-commands.server");
    const actor = buildActor({
      roleKey: "partner_admin",
      teamDomain: "partner_success",
      partnerId: "partner-2",
    });
    const result = await transitionTask({
      actor,
      taskId: "task-1",
      expectedVersion: 2,
      toStatus: "in_progress",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});

test("§2.4: transitionTask denies a restricted_distributor who is neither assignee nor creator of the task", async () => {
  const harness = await installFakePool(
    baseTaskRow({
      partner_id: "partner-1",
      assignee_id: "someone-else",
      creator_id: "someone-else-too",
    }),
  )();
  try {
    const { transitionTask } = await import("@/server/task-commands.server");
    const actor = buildActor({ roleKey: "restricted_distributor", partnerId: "partner-1" });
    const result = await transitionTask({
      actor,
      taskId: "task-1",
      expectedVersion: 2,
      toStatus: "in_progress",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});

test("§2.4: transitionTask allows a restricted_distributor who is the task's assignee", async () => {
  const distributorUserId = "22222222-2222-2222-2222-222222222222";
  const harness = await installFakePool(
    baseTaskRow({
      partner_id: "partner-1",
      assignee_id: distributorUserId,
      creator_id: "someone-else",
    }),
  )();
  try {
    const { transitionTask } = await import("@/server/task-commands.server");
    const actor = buildActor({
      userId: distributorUserId,
      roleKey: "restricted_distributor",
      partnerId: "partner-1",
    });
    const result = await transitionTask({
      actor,
      taskId: "task-1",
      expectedVersion: 2,
      toStatus: "in_progress",
    });
    expect(result.ok).toBe(true);
  } finally {
    harness.restore();
  }
});

test("transitionTask rejects a stale expectedVersion", async () => {
  const harness = await installFakePool(baseTaskRow({ version: 5 }))();
  try {
    const { transitionTask } = await import("@/server/task-commands.server");
    const actor = buildActor();
    const result = await transitionTask({
      actor,
      taskId: "task-1",
      expectedVersion: 2,
      toStatus: "in_progress",
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

test("transitionTask rejects an invalid transition", async () => {
  const harness = await installFakePool(baseTaskRow({ status: "completed" }))();
  try {
    const { transitionTask } = await import("@/server/task-commands.server");
    const actor = buildActor();
    const result = await transitionTask({
      actor,
      taskId: "task-1",
      expectedVersion: 2,
      toStatus: "blocked",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("VALIDATION_FAILED");
  } finally {
    harness.restore();
  }
});

test("transitionTask requires a reason to block a task", async () => {
  const harness = await installFakePool(baseTaskRow({ status: "to_do" }))();
  try {
    const { transitionTask } = await import("@/server/task-commands.server");
    const actor = buildActor();
    const result = await transitionTask({
      actor,
      taskId: "task-1",
      expectedVersion: 2,
      toStatus: "blocked",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_FAILED");
      if (result.failure.code === "VALIDATION_FAILED") {
        expect(result.failure.fieldErrors[0]?.field).toBe("reason");
      }
    }
  } finally {
    harness.restore();
  }
});

test("transitionTask succeeds and bumps the version for a valid transition", async () => {
  const harness = await installFakePool(baseTaskRow({ status: "to_do", version: 2 }))();
  try {
    const { transitionTask } = await import("@/server/task-commands.server");
    const actor = buildActor();
    const result = await transitionTask({
      actor,
      taskId: "task-1",
      expectedVersion: 2,
      toStatus: "in_progress",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newVersion).toBe(3);
      expect(result.commandName).toBe("task.transition");
    }
    expect(harness.updateCalls).toHaveLength(1);
    expect(harness.updateCalls[0]?.params[1]).toBe("in_progress");
  } finally {
    harness.restore();
  }
});

test("transitionTask reopening a completed task requires a reason", async () => {
  const harness = await installFakePool(baseTaskRow({ status: "completed" }))();
  try {
    const { transitionTask } = await import("@/server/task-commands.server");
    const actor = buildActor();
    const denied = await transitionTask({
      actor,
      taskId: "task-1",
      expectedVersion: 2,
      toStatus: "to_do",
    });
    expect(denied.ok).toBe(false);

    const allowed = await transitionTask({
      actor,
      taskId: "task-1",
      expectedVersion: 2,
      toStatus: "to_do",
      reason: "Client asked for one more revision",
    });
    expect(allowed.ok).toBe(true);
  } finally {
    harness.restore();
  }
});

test("createTask requires a non-empty title", async () => {
  const { createTask } = await import("@/server/task-commands.server");
  const actor = buildActor();
  const result = await createTask({ actor, data: { title: "   " } });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.failure.code).toBe("VALIDATION_FAILED");
});

test("an in-scope PAM may assign a task to another user", async () => {
  const assigneeId = "22222222-2222-2222-2222-222222222222";
  const harness = await installFakePool({
    ...baseTaskRow(),
    id: assigneeId,
    partner_id: "partner-1",
    organization_tenant_id: "tenant-livey-org",
    tenant_id: "tenant-livey-org",
    role_key: "partner_user",
    geography_ceiling_node_id: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
  })();
  try {
  const { createTask } = await import("@/server/task-commands.server");
  const actor = buildActor({ roleKey: "pam" });
  const result = await createTask({
    actor,
    data: { title: "Review renewal", assigneeId, partnerId: "partner-1" },
  });

  expect(result.ok).toBe(true);
  } finally {
    harness.restore();
  }
});

test("task lifecycle remains command-owned", async () => {
  const { updateTask } = await import("@/server/task-commands.server");
  const result = await updateTask({
    actor: buildActor(),
    taskId: "task-1",
    patch: { status: "completed" },
  });

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.failure.code).toBe("VALIDATION_FAILED");
});

test("an explicit user deny override blocks task updates even when the role allows them", async () => {
  const userId = "11111111-1111-1111-1111-111111111111";
  const harness = await installFakePool(
    baseTaskRow({ creator_id: userId, assignee_id: userId }),
    false,
  )();
  try {
    const { updateTask } = await import("@/server/task-commands.server");
    const result = await updateTask({
      actor: buildActor({ userId, roleKey: "partner_user", partnerId: "partner-1" }),
      taskId: "task-1",
      expectedVersion: 2,
      patch: { title: "Updated title" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});

test("an out-of-scope assignee is rejected by task creation", async () => {
  const assigneeId = "33333333-3333-3333-3333-333333333333";
  const harness = await installFakePool({
    ...baseTaskRow(),
    id: assigneeId,
    partner_id: "partner-2",
    organization_tenant_id: "tenant-livey-org",
    tenant_id: "tenant-livey-org",
    role_key: "partner_user",
    geography_ceiling_node_id: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
  })();
  try {
  const { createTask } = await import("@/server/task-commands.server");
  const result = await createTask({
    actor: buildActor({ roleKey: "partner_admin", partnerId: "partner-1" }),
    data: { title: "Review renewal", assigneeId, partnerId: "partner-2" },
  });

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});
