import { randomUUID } from "node:crypto";

import { createOutboxEnvelope } from "@/domain/contracts/commands";
import { appendOutboxEnvelope, type QueryRunner } from "@/server/command-runtime.server";
import type { GovernedActor } from "@/server/governed-actor.server";
import { isAllowedTaskTransition, type TaskStatus } from "@/server/task-commands.server";

/**
 * Transaction-aware workflow effects (product.md §24.5).
 *
 * Every helper here takes an ALREADY-OPEN transaction client and does its
 * work inside it. None of them opens, commits, or rolls back a transaction,
 * and none of them reaches for the pool: a Task that is only sometimes
 * created is worse than no Task, so the state change and the work item it
 * generates either both land or neither does.
 *
 * All three write helpers are idempotent by construction rather than by
 * checking first and writing second — a check-then-write would race two
 * concurrent replays past each other. Uniqueness lives in the database:
 * a partial unique index on tasks.automation_key over open Tasks, and one
 * on notifications (user_id, event_key).
 */

const AUTOMATION_EVENT_SCHEMA_VERSION = 1;

/** The caller's already-open transaction. Narrowed to `query` on purpose:
 * these helpers must not be able to `release()` the client out from under
 * the command that owns it, and they never issue transaction control —
 * workflow-automation.server.test.ts fails the whole suite if one of them
 * emits a BEGIN, COMMIT, or ROLLBACK. */
export type TransactionClient = QueryRunner;

export type EnsureAutomatedTaskInput = {
  /** Stable, recipient-specific identity for this generated Task. Replaying
   * the command that produced it must reuse the same key. */
  automationKey: string;
  /** Which workflow generated it, e.g. "stock_request". Lets an operator
   * find every Task a domain opened without parsing keys. */
  automationSource: string;
  /** Bumped when the Task's copy or routing changes, so an old open Task is
   * still identifiable as having been created under the previous template. */
  templateVersion: number;
  assigneeId: string | null;
  creatorId: string | null;
  relatedType: string;
  relatedId: string;
  title: string;
  description: string;
  priority: string;
  dueAt: string | null;
  partnerId: string | null;
};

export type EnsureAutomatedTaskResult = {
  taskId: string;
  /** False when an open Task with this key already existed. The caller is
   * still given that Task's id so it can link to the right target. */
  created: boolean;
};

export async function ensureAutomatedTask(
  tx: TransactionClient,
  input: EnsureAutomatedTaskInput,
): Promise<EnsureAutomatedTaskResult> {
  const automationKey = input.automationKey?.trim();
  if (!automationKey) {
    // An unkeyed automation Task is indistinguishable from a hand-created
    // one and would duplicate on every replay, so this is a bug to surface
    // rather than a case to tolerate.
    throw new Error("An automation key is required");
  }

  const taskId = randomUUID();
  const inserted = await tx.query(
    `INSERT INTO tasks (
       id, title, description, status, priority, related_type, related_id,
       assignee_id, creator_id, partner_id, due_at,
       automation_source, automation_template_version, automation_key, version
     ) VALUES ($1,$2,$3,'to_do',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1)
     ON CONFLICT (automation_key)
       WHERE automation_key IS NOT NULL AND status NOT IN ('completed', 'cancelled')
       DO NOTHING
     RETURNING id`,
    [
      taskId,
      input.title,
      input.description,
      input.priority,
      input.relatedType,
      input.relatedId,
      input.assigneeId,
      input.creatorId,
      input.partnerId,
      input.dueAt,
      input.automationSource,
      input.templateVersion,
      automationKey,
    ],
  );

  const insertedRow = inserted.rows[0] as { id?: string } | undefined;
  if (insertedRow?.id) {
    return { taskId: insertedRow.id, created: true };
  }

  const existing = await loadOpenAutomationTasks(tx, automationKey);
  return { taskId: existing[0]?.id ?? taskId, created: false };
}

type OpenAutomationTask = { id: string; status: string; version: number; title: string };

async function loadOpenAutomationTasks(
  tx: TransactionClient,
  automationKey: string,
): Promise<OpenAutomationTask[]> {
  const { rows } = await tx.query(
    `SELECT id, status, version, title FROM tasks
     WHERE automation_key = $1 AND status NOT IN ('completed', 'cancelled')
     FOR UPDATE`,
    [automationKey],
  );
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    status: String(row.status),
    version: Number(row.version),
    title: String(row.title ?? ""),
  }));
}

export type CompleteAutomatedTaskInput = {
  automationKey: string;
  actor: GovernedActor;
  correlationId: string;
  reason?: string | null;
  /** Recorded on the transition row so the Task's history says which
   * workflow step closed it. */
  commandName?: string;
};

export type CompleteAutomatedTaskResult = {
  completedTaskIds: string[];
};

/**
 * Closes the open Task(s) carrying `automationKey`.
 *
 * Uses the same task_transitions evidence row that a human transition
 * writes, with the acting user and Assignment, so "who closed this and
 * under what authority" is answerable for generated Tasks exactly as it is
 * for hand-driven ones. An already-closed or never-created key is a no-op:
 * a replayed command must converge, not fail.
 */
export async function completeAutomatedTask(
  tx: TransactionClient,
  input: CompleteAutomatedTaskInput,
): Promise<CompleteAutomatedTaskResult> {
  const automationKey = input.automationKey?.trim();
  if (!automationKey) return { completedTaskIds: [] };

  const open = await loadOpenAutomationTasks(tx, automationKey);
  const completedTaskIds: string[] = [];

  for (const task of open) {
    // Uses the Task domain's own transition table rather than a second copy
    // of the lifecycle. A Task parked in a status that cannot legally reach
    // "completed" is left alone instead of being force-closed.
    if (!isAllowedTaskTransition(task.status as TaskStatus, "completed")) continue;

    const updated = await tx.query(
      `UPDATE tasks SET status = 'completed', completed_at = now(), version = $2, updated_at = now()
       WHERE id = $1 AND version = $3`,
      [task.id, task.version + 1, task.version],
    );
    if (!updated.rowCount) continue;

    await tx.query(
      `INSERT INTO task_transitions (
         task_id, command_name, from_status, to_status, actor_user_id,
         assignment_id, reason, correlation_id
       ) VALUES ($1,$2,$3,'completed',$4,$5,$6,$7)`,
      [
        task.id,
        input.commandName ?? "task.transition",
        task.status,
        input.actor.userId,
        input.actor.assignment.assignmentId,
        input.reason ?? null,
        input.correlationId,
      ],
    );
    completedTaskIds.push(task.id);
  }

  return { completedTaskIds };
}

export type EnsureNotificationInput = {
  userId: string | null;
  partnerId: string | null;
  title: string;
  message: string;
  type: string;
  subjectType: string;
  subjectId: string;
  actionUrl: string | null;
  /** Unique per RECIPIENT, not globally. One recipient gets one Notification
   * per event; three recipients of the same event each get their own. */
  eventKey: string;
};

export type EnsureNotificationResult = {
  notificationId: string | null;
  created: boolean;
};

export async function ensureNotification(
  tx: TransactionClient,
  input: EnsureNotificationInput,
): Promise<EnsureNotificationResult> {
  // A Notification with no recipient is undeliverable, and the partial
  // unique index does not cover NULL user_id, so writing one would also
  // duplicate on every replay. Skipping is the honest outcome — the caller
  // resolved no recipient, and inventing one would be worse.
  if (!input.userId) return { notificationId: null, created: false };

  const notificationId = randomUUID();
  const inserted = await tx.query(
    `INSERT INTO notifications (
       id, user_id, partner_id, title, message, type,
       subject_type, subject_id, action_url, event_key, read
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,FALSE)
     ON CONFLICT (user_id, event_key)
       WHERE event_key IS NOT NULL AND user_id IS NOT NULL
       DO NOTHING
     RETURNING id`,
    [
      notificationId,
      input.userId,
      input.partnerId,
      input.title,
      input.message,
      input.type,
      input.subjectType,
      input.subjectId,
      input.actionUrl,
      input.eventKey,
    ],
  );

  const row = inserted.rows[0] as { id?: string } | undefined;
  return row?.id
    ? { notificationId: row.id, created: true }
    : { notificationId: null, created: false };
}

export type RecordDistributionActivityInput = {
  actor: GovernedActor;
  correlationId: string;
  eventName: string;
  subjectId: string;
  subjectType?: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string | null;
};

/**
 * The domain Activity row plus its outbox envelope, written in the caller's
 * transaction using the existing contracts — so a distribution event is
 * durable and publishable on exactly the same terms as a deal or task event,
 * and any future adapter consumes it without a private path.
 */
export async function recordDistributionActivityAndOutbox(
  tx: TransactionClient,
  input: RecordDistributionActivityInput,
): Promise<void> {
  const subjectType = input.subjectType ?? "stock_request";

  await tx.query(
    `INSERT INTO domain_activity_events (
       tenant_id, organization_tenant_id, subject_type, subject_id,
       actor_user_id, assignment_id, correlation_id, event_name, schema_version, payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.actor.assignment.tenantId,
      input.actor.assignment.organizationTenantId,
      subjectType,
      input.subjectId,
      input.actor.userId,
      input.actor.assignment.assignmentId,
      input.correlationId,
      input.eventName,
      AUTOMATION_EVENT_SCHEMA_VERSION,
      JSON.stringify(input.payload),
    ],
  );

  await appendOutboxEnvelope(
    tx,
    createOutboxEnvelope({
      eventName: input.eventName,
      schemaVersion: AUTOMATION_EVENT_SCHEMA_VERSION,
      aggregateType: subjectType,
      aggregateId: input.subjectId,
      tenantId: input.actor.assignment.tenantId,
      organizationTenantId: input.actor.assignment.organizationTenantId,
      actorUserId: input.actor.userId,
      assignmentId: input.actor.assignment.assignmentId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey ?? null,
      publishAfter: null,
      payload: input.payload,
    }),
  );
}

export type StockRequestTransitionInput = {
  requestId: string;
  commandName: string;
  fromStatus: string;
  toStatus: string;
  actor: GovernedActor;
  reason: string | null;
  correlationId: string;
};

/** The DMS equivalent of task_transitions: one row per state change, with
 * the Assignment the actor held at the time. §24.3.2 forbids hard deletes,
 * so this table is the request's complete history. */
export async function recordStockRequestTransition(
  tx: TransactionClient,
  input: StockRequestTransitionInput,
): Promise<void> {
  await tx.query(
    `INSERT INTO stock_request_transitions (
       request_id, command_name, from_status, to_status, actor_user_id,
       assignment_id, reason, correlation_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.requestId,
      input.commandName,
      input.fromStatus,
      input.toStatus,
      input.actor.userId,
      input.actor.assignment.assignmentId,
      input.reason,
      input.correlationId,
    ],
  );
}
