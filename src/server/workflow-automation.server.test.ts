import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import type { GovernedActor } from "@/server/governed-actor.server";
import {
  completeAutomatedTask,
  ensureAutomatedTask,
  ensureNotification,
  recordDistributionActivityAndOutbox,
} from "@/server/workflow-automation.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

const ISSUED_AT = "2026-08-25T00:00:00.000Z";
const REQUEST_ID = "00000000-0000-0000-0000-000000000001";

function buildAssignment(overrides: Partial<AssignmentRecord> = {}): AssignmentRecord {
  return {
    assignmentId: "assignment-1",
    userId: "11111111-1111-1111-1111-111111111111",
    tenantId: "tenant-livey-org",
    organizationTenantId: "tenant-livey-org",
    roleKey: "rm",
    teamDomain: "sales",
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

function buildActor(): GovernedActor {
  const assignment = buildAssignment();
  const activeContext: ActiveContextRecord = {
    contextId: "context-1",
    userId: assignment.userId,
    assignmentId: assignment.assignmentId,
    assignmentStatus: assignment.status,
    tenantId: assignment.tenantId,
    organizationTenantId: assignment.organizationTenantId,
    workingScope: null,
    issuedAt: ISSUED_AT,
    expiresAt: "2026-08-25T08:00:00.000Z",
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
  return { userId: assignment.userId, assignment, activeContext };
}

// ---------------------------------------------------------------------------
// An in-memory stand-in for one already-open transaction. Deliberately not a
// pool: these helpers must never open a transaction of their own, so the fake
// throws on BEGIN/COMMIT/ROLLBACK to prove they don't.
// ---------------------------------------------------------------------------

type FakeTask = {
  id: string;
  title: string;
  status: string;
  automation_key: string | null;
  automation_source: string | null;
  automation_template_version: number | null;
  assignee_id: string | null;
  creator_id: string | null;
  related_type: string | null;
  related_id: string | null;
  partner_id: string | null;
  due_at: string | null;
  version: number;
};

type FakeNotification = {
  id: string;
  user_id: string | null;
  event_key: string | null;
  title: string;
  action_url: string | null;
};

function createFakeTx() {
  const tasks: FakeTask[] = [];
  const notifications: FakeNotification[] = [];
  const transitions: Array<Record<string, unknown>> = [];
  const activity: Array<Record<string, unknown>> = [];
  const outbox: Array<Record<string, unknown>> = [];
  const statements: string[] = [];

  const tx = {
    query: async (sql: string, params: unknown[] = []) => {
      const text = String(sql).trim().replace(/\s+/g, " ");
      const verb = text.split(" ")[0]!.toUpperCase();
      if (verb === "BEGIN" || verb === "COMMIT" || verb === "ROLLBACK") {
        throw new Error(`Nested transaction control is forbidden: ${verb}`);
      }
      statements.push(text);

      if (text.startsWith("INSERT INTO tasks")) {
        const [
          id,
          title,
          ,
          priority,
          relatedType,
          relatedId,
          assigneeId,
          creatorId,
          partnerId,
          dueAt,
          automationSource,
          templateVersion,
          automationKey,
        ] = params as [
          string,
          string,
          string,
          string,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string | null,
          string,
          number,
          string,
        ];
        void priority;
        const conflict = tasks.some(
          (task) =>
            task.automation_key === automationKey &&
            task.status !== "completed" &&
            task.status !== "cancelled",
        );
        if (conflict) return { rows: [], rowCount: 0 };
        tasks.push({
          id,
          title,
          status: "to_do",
          automation_key: automationKey,
          automation_source: automationSource,
          automation_template_version: templateVersion,
          assignee_id: assigneeId,
          creator_id: creatorId,
          related_type: relatedType,
          related_id: relatedId,
          partner_id: partnerId,
          due_at: dueAt,
          version: 1,
        });
        return { rows: [{ id }], rowCount: 1 };
      }

      if (text.startsWith("SELECT id, status, version, title FROM tasks")) {
        const [automationKey] = params as [string];
        const found = tasks.filter(
          (task) =>
            task.automation_key === automationKey &&
            task.status !== "completed" &&
            task.status !== "cancelled",
        );
        return { rows: found.map((t) => ({ ...t })), rowCount: found.length };
      }

      if (text.startsWith("UPDATE tasks SET status = 'completed'")) {
        const [id] = params as [string];
        const task = tasks.find((candidate) => candidate.id === id);
        if (!task) return { rows: [], rowCount: 0 };
        task.status = "completed";
        task.version += 1;
        return { rows: [], rowCount: 1 };
      }

      if (text.startsWith("INSERT INTO task_transitions")) {
        transitions.push({ sql: text, params });
        return { rows: [], rowCount: 1 };
      }

      if (text.startsWith("INSERT INTO notifications")) {
        const [id, userId, , title, , , subjectType, subjectId, actionUrl, eventKey] = params as [
          string,
          string | null,
          string | null,
          string,
          string,
          string,
          string | null,
          string | null,
          string | null,
          string | null,
        ];
        void subjectType;
        void subjectId;
        const conflict = notifications.some(
          (row) => row.user_id === userId && row.event_key === eventKey && eventKey !== null,
        );
        if (conflict) return { rows: [], rowCount: 0 };
        notifications.push({
          id,
          user_id: userId,
          event_key: eventKey,
          title,
          action_url: actionUrl,
        });
        return { rows: [{ id }], rowCount: 1 };
      }

      if (text.startsWith("INSERT INTO domain_activity_events")) {
        activity.push({ params });
        return { rows: [], rowCount: 1 };
      }

      if (text.startsWith("INSERT INTO command_outbox")) {
        outbox.push({ params });
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unhandled statement: ${text}`);
    },
  };

  return { tx, tasks, notifications, transitions, activity, outbox, statements };
}

function taskInput(overrides: Record<string, unknown> = {}) {
  return {
    automationKey: `stock-request:${REQUEST_ID}:manager-approval:assignment-2`,
    automationSource: "stock_request",
    templateVersion: 1,
    assigneeId: "22222222-2222-2222-2222-222222222222",
    creatorId: "11111111-1111-1111-1111-111111111111",
    relatedType: "stock_request",
    relatedId: REQUEST_ID,
    title: "Review stock request DMS-000001",
    description: "Review requested quantities and select source locations.",
    priority: "high",
    dueAt: "2026-08-27T12:00:00.000Z",
    partnerId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

test("ensureAutomatedTask creates exactly one open task for a repeated key", async () => {
  const harness = createFakeTx();

  const first = await ensureAutomatedTask(harness.tx, taskInput());
  const second = await ensureAutomatedTask(harness.tx, taskInput());

  expect(first.created).toBe(true);
  expect(second.created).toBe(false);
  expect(harness.tasks).toHaveLength(1);
  expect(harness.tasks[0]?.automation_source).toBe("stock_request");
  expect(harness.tasks[0]?.automation_template_version).toBe(1);
  expect(harness.tasks[0]?.due_at).toBe("2026-08-27T12:00:00.000Z");
  // The replay reports the id of the task that already exists, not null, so
  // a caller can still link its notification at the right target.
  expect(second.taskId).toBe(first.taskId);
});

test("ensureAutomatedTask keys distinct recipients separately", async () => {
  const harness = createFakeTx();

  await ensureAutomatedTask(
    harness.tx,
    taskInput({ automationKey: `stock-request:${REQUEST_ID}:fulfilment:assignment-9` }),
  );
  await ensureAutomatedTask(
    harness.tx,
    taskInput({ automationKey: `stock-request:${REQUEST_ID}:fulfilment:assignment-10` }),
  );

  expect(harness.tasks).toHaveLength(2);
});

test("ensureAutomatedTask never opens a transaction of its own", async () => {
  const harness = createFakeTx();
  await ensureAutomatedTask(harness.tx, taskInput());
  expect(harness.statements.some((sql) => /^(BEGIN|COMMIT|ROLLBACK)/i.test(sql))).toBe(false);
});

test("ensureAutomatedTask rejects an empty automation key rather than writing an unkeyed task", async () => {
  const harness = createFakeTx();
  await expect(ensureAutomatedTask(harness.tx, taskInput({ automationKey: "  " }))).rejects.toThrow(
    "An automation key is required",
  );
  expect(harness.tasks).toHaveLength(0);
});

test("completeAutomatedTask closes the task once and records the transition", async () => {
  const harness = createFakeTx();
  const actor = buildActor();
  const created = await ensureAutomatedTask(harness.tx, taskInput());

  const first = await completeAutomatedTask(harness.tx, {
    automationKey: taskInput().automationKey,
    actor,
    correlationId: "corr-1",
    reason: "Approved",
  });
  const second = await completeAutomatedTask(harness.tx, {
    automationKey: taskInput().automationKey,
    actor,
    correlationId: "corr-1",
    reason: "Approved",
  });

  expect(first.completedTaskIds).toEqual([created.taskId]);
  // Already closed — nothing left to close, and no second transition row.
  expect(second.completedTaskIds).toEqual([]);
  expect(harness.tasks[0]?.status).toBe("completed");
  expect(harness.tasks[0]?.version).toBe(2);
  expect(harness.transitions).toHaveLength(1);

  // to_status is a fixed SQL literal, not a bind — a generated Task is only
  // ever closed to "completed", never to a caller-chosen status.
  const transition = harness.transitions[0]!;
  expect(String(transition.sql)).toContain("'completed'");
  const params = transition.params as unknown[];
  expect(params[0]).toBe(created.taskId);
  expect(params[2]).toBe("to_do");
  expect(params[3]).toBe(actor.userId);
  expect(params[4]).toBe(actor.assignment.assignmentId);
  expect(params[5]).toBe("Approved");
  expect(params[6]).toBe("corr-1");
});

test("completeAutomatedTask on an unknown key is a no-op, not an error", async () => {
  const harness = createFakeTx();
  const result = await completeAutomatedTask(harness.tx, {
    automationKey: "stock-request:missing:manager-approval:assignment-2",
    actor: buildActor(),
    correlationId: "corr-1",
  });
  expect(result.completedTaskIds).toEqual([]);
  expect(harness.transitions).toHaveLength(0);
});

test("ensureNotification delivers one row per recipient per event", async () => {
  const harness = createFakeTx();
  const base = {
    partnerId: null,
    title: "Stock request DMS-000001 needs approval",
    message: "Two lines await your decision.",
    type: "stock_request",
    subjectType: "stock_request",
    subjectId: REQUEST_ID,
    actionUrl: `/distribution?tab=requests&requestId=${REQUEST_ID}`,
  };

  const manager = await ensureNotification(harness.tx, {
    ...base,
    userId: "manager-user",
    eventKey: `stock-request:${REQUEST_ID}:submitted`,
  });
  const managerReplay = await ensureNotification(harness.tx, {
    ...base,
    userId: "manager-user",
    eventKey: `stock-request:${REQUEST_ID}:submitted`,
  });
  const custodian = await ensureNotification(harness.tx, {
    ...base,
    userId: "custodian-user",
    eventKey: `stock-request:${REQUEST_ID}:submitted`,
  });

  expect(manager.created).toBe(true);
  // Same recipient, same event — suppressed.
  expect(managerReplay.created).toBe(false);
  // Different recipient, same event — delivered. A globally-unique event key
  // would have silently dropped this one.
  expect(custodian.created).toBe(true);
  expect(harness.notifications).toHaveLength(2);
  expect(harness.notifications[0]?.action_url).toContain(REQUEST_ID);
});

test("ensureNotification skips a null recipient instead of writing an undeliverable row", async () => {
  const harness = createFakeTx();
  const result = await ensureNotification(harness.tx, {
    userId: null,
    partnerId: null,
    title: "Orphan",
    message: "Nobody",
    type: "stock_request",
    subjectType: "stock_request",
    subjectId: REQUEST_ID,
    actionUrl: null,
    eventKey: `stock-request:${REQUEST_ID}:submitted`,
  });
  expect(result.created).toBe(false);
  expect(harness.notifications).toHaveLength(0);
});

test("recordDistributionActivityAndOutbox writes both evidence rows in the caller's transaction", async () => {
  const harness = createFakeTx();
  await recordDistributionActivityAndOutbox(harness.tx, {
    actor: buildActor(),
    correlationId: "corr-1",
    eventName: "stock_request.submitted",
    subjectId: REQUEST_ID,
    payload: { humanId: "DMS-000001" },
  });

  expect(harness.activity).toHaveLength(1);
  expect(harness.outbox).toHaveLength(1);
  expect(harness.statements.some((sql) => /^(BEGIN|COMMIT|ROLLBACK)/i.test(sql))).toBe(false);
});
