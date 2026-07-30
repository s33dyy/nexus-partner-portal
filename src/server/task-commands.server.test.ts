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

function installFakePool(taskRow: TaskRow | null) {
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
