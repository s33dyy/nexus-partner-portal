import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import {
  createOutboxEnvelope,
  makeConcurrencyError,
  makePolicyDenial,
  type CommandExecutionResult,
  type CommandFailureContract,
} from "@/domain/contracts/commands";
import {
  GOVERNANCE_GEOGRAPHY_NODE_IDS,
  evaluateActiveContextPolicy,
  type PolicyDecision,
} from "@/domain/contracts/governance";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { appendOutboxEnvelope, withTransaction } from "@/server/command-runtime.server";
import {
  resolveGovernedActor,
  type GovernedActor,
  type ResolveGovernedActorInput,
} from "@/server/governed-actor.server";

const TASK_EVENT_SCHEMA_VERSION = 1;

// The blueprint's canonical taxonomy (TASK_STATUSES in domain/contracts) is a
// generic work-item lifecycle shared as a placeholder across several
// not-yet-built domains and doesn't carry the specific "reopen a
// completed/cancelled task with a reason" transitions that Section 10.2
// requires. This module implements that section's five states and eight
// transitions directly, the same way deal-commands.server.ts intentionally
// implements the deployed nine-stage deal pipeline instead of the narrower
// canonical eight-stage list.
export const TASK_STATUSES = ["to_do", "in_progress", "blocked", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const REASON_REQUIRED_TRANSITIONS = new Set<`${TaskStatus}->${TaskStatus}`>([
  "to_do->blocked",
  "in_progress->blocked",
  "to_do->cancelled",
  "in_progress->cancelled",
  "blocked->cancelled",
  "completed->to_do",
  "cancelled->to_do",
]);

const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  to_do: ["in_progress", "blocked", "completed", "cancelled"],
  in_progress: ["to_do", "blocked", "completed", "cancelled"],
  blocked: ["to_do", "in_progress", "cancelled"],
  completed: ["to_do"],
  cancelled: ["to_do"],
};

function isAllowedTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export type TaskCommandActor = GovernedActor;
export type ResolveTaskCommandActorInput = ResolveGovernedActorInput;
export const resolveTaskCommandActor = resolveGovernedActor;

type TaskSnapshot = {
  id: string;
  status: TaskStatus;
  partnerId: string | null;
  version: number;
  title: string;
};

function authorizeTaskActor(
  actor: TaskCommandActor,
  task: { partnerId: string | null },
): PolicyDecision {
  const basePolicy = evaluateActiveContextPolicy({
    roles: [actor.assignment.roleKey],
    assignment: actor.assignment,
    activeContext: actor.activeContext,
  });
  if (!basePolicy.allowed) return basePolicy;

  if (actor.assignment.roleKey === "super_admin") {
    return { allowed: true, reason: null };
  }

  if (
    actor.assignment.roleKey === "partner_admin" ||
    actor.assignment.roleKey === "partner_user" ||
    actor.assignment.roleKey === "restricted_distributor"
  ) {
    if (!actor.assignment.partnerId || actor.assignment.partnerId !== task.partnerId) {
      return {
        allowed: false,
        reason: "Task is outside the assignment's partner scope",
        denial: makePolicyDenial(null, "Task is outside the assignment's partner scope"),
      };
    }
    return { allowed: true, reason: null };
  }

  // Same deliberate fail-closed placeholder as deal-commands.server.ts for
  // LIVEY-side roles until a governed geography resolution exists for tasks.
  if (actor.assignment.geographyCeilingNodeId === GOVERNANCE_GEOGRAPHY_NODE_IDS.global) {
    return { allowed: true, reason: null };
  }

  return {
    allowed: false,
    reason: "Task geography scope could not be verified for this assignment",
    denial: makePolicyDenial(
      null,
      "Task geography scope could not be verified for this assignment",
    ),
  };
}

function validationFailure(message: string, field = "status"): CommandFailureContract {
  return {
    code: "VALIDATION_FAILED",
    message,
    fieldErrors: [{ field, message }],
    retryable: false,
  };
}

async function loadTaskForUpdate(tx: PoolClient, taskId: string): Promise<TaskSnapshot | null> {
  const { rows } = await tx.query(
    `SELECT id, status, partner_id, version, title FROM tasks WHERE id = $1 FOR UPDATE`,
    [taskId],
  );
  const row = rows[0] as
    | { id: string; status: string; partner_id: string | null; version: number; title: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status as TaskStatus,
    partnerId: row.partner_id,
    version: Number(row.version),
    title: row.title,
  };
}

async function recordTaskEvent(input: {
  tx: PoolClient;
  actor: TaskCommandActor;
  correlationId: string;
  commandName: string;
  eventName: string;
  taskId: string;
  fromStatus: string;
  toStatus: string;
  reason: string | null;
  payload: Record<string, unknown>;
}) {
  await input.tx.query(
    `INSERT INTO task_transitions (
       task_id, command_name, from_status, to_status, actor_user_id,
       assignment_id, reason, correlation_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.taskId,
      input.commandName,
      input.fromStatus,
      input.toStatus,
      input.actor.userId,
      input.actor.assignment.assignmentId,
      input.reason,
      input.correlationId,
    ],
  );

  await input.tx.query(
    `INSERT INTO domain_activity_events (
       tenant_id, organization_tenant_id, subject_type, subject_id,
       actor_user_id, assignment_id, correlation_id, event_name, schema_version, payload
     ) VALUES ($1,$2,'task',$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.actor.assignment.tenantId,
      input.actor.assignment.organizationTenantId,
      input.taskId,
      input.actor.userId,
      input.actor.assignment.assignmentId,
      input.correlationId,
      input.eventName,
      TASK_EVENT_SCHEMA_VERSION,
      JSON.stringify(input.payload),
    ],
  );

  await appendOutboxEnvelope(
    input.tx,
    createOutboxEnvelope({
      eventName: input.eventName,
      schemaVersion: TASK_EVENT_SCHEMA_VERSION,
      aggregateType: "task",
      aggregateId: input.taskId,
      tenantId: input.actor.assignment.tenantId,
      organizationTenantId: input.actor.assignment.organizationTenantId,
      actorUserId: input.actor.userId,
      assignmentId: input.actor.assignment.assignmentId,
      correlationId: input.correlationId,
      idempotencyKey: null,
      publishAfter: null,
      payload: input.payload,
    }),
  );
}

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  priority?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  assigneeId?: string | null;
  dueAt?: string | null;
  partnerId?: string | null;
};

function resolveCreatePartnerId(actor: TaskCommandActor, requested: string | null): string | null {
  const role = actor.assignment.roleKey;
  if (role === "partner_admin" || role === "partner_user" || role === "restricted_distributor") {
    return actor.assignment.partnerId ?? null;
  }
  return requested;
}

export async function createTask(input: {
  actor: TaskCommandActor;
  data: CreateTaskInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const title = input.data.title.trim();

  if (!title) {
    return {
      ok: false,
      failure: validationFailure("A task title is required", "title"),
      correlationId,
    };
  }

  return withTransaction(async (tx) => {
    const partnerId = resolveCreatePartnerId(input.actor, input.data.partnerId ?? null);
    const policy = authorizeTaskActor(input.actor, { partnerId });
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    const taskId = randomUUID();
    await tx.query(
      `INSERT INTO tasks (
         id, title, description, status, priority, related_type, related_id,
         assignee_id, creator_id, partner_id, due_at, version
       ) VALUES ($1,$2,$3,'to_do',$4,$5,$6,$7,$8,$9,$10,1)`,
      [
        taskId,
        title,
        input.data.description?.trim() || "",
        input.data.priority?.trim() || "medium",
        input.data.relatedType ?? null,
        input.data.relatedId ?? null,
        input.data.assigneeId ?? null,
        input.actor.userId,
        partnerId,
        input.data.dueAt ?? null,
      ],
    );

    await recordTaskEvent({
      tx,
      actor: input.actor,
      correlationId,
      commandName: "task.create",
      eventName: "task.created",
      taskId,
      fromStatus: "(created)",
      toStatus: "to_do",
      reason: null,
      payload: { title, relatedType: input.data.relatedType ?? null },
    });

    return {
      ok: true,
      commandName: "task.create",
      subjectId: taskId,
      newVersion: 1,
      nextAuthorisedActions: ["task.transition"],
      correlationId,
    };
  });
}

export async function transitionTask(input: {
  actor: TaskCommandActor;
  taskId: string;
  expectedVersion: number;
  toStatus: TaskStatus;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const reason = input.reason?.trim() || null;

  return withTransaction(async (tx) => {
    const task = await loadTaskForUpdate(tx, input.taskId);
    if (!task) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Task is not accessible"),
        correlationId,
      };
    }

    const policy = authorizeTaskActor(input.actor, { partnerId: task.partnerId });
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    if (task.version !== input.expectedVersion) {
      return {
        ok: false,
        failure: makeConcurrencyError(task.id, input.expectedVersion, task.version),
        correlationId,
      };
    }

    if (!isAllowedTaskTransition(task.status, input.toStatus)) {
      return {
        ok: false,
        failure: validationFailure(`Task cannot move from "${task.status}" to "${input.toStatus}"`),
        correlationId,
      };
    }

    const transitionKey = `${task.status}->${input.toStatus}` as `${TaskStatus}->${TaskStatus}`;
    if (REASON_REQUIRED_TRANSITIONS.has(transitionKey) && !reason) {
      return {
        ok: false,
        failure: validationFailure(
          `A reason is required to move a task from "${task.status}" to "${input.toStatus}"`,
          "reason",
        ),
        correlationId,
      };
    }

    const newVersion = task.version + 1;
    // Not user input — these are fixed SQL literals selected by a closed
    // switch on the validated target status, never interpolated user data.
    const completedAtSql = input.toStatus === "completed" ? "now()" : "NULL";
    const cancelledAtSql = input.toStatus === "cancelled" ? "now()" : "NULL";
    const blockedReason = input.toStatus === "blocked" ? reason : null;

    await tx.query(
      `UPDATE tasks
       SET status = $2,
           version = $3,
           blocked_reason = $4,
           completed_at = ${completedAtSql},
           cancelled_at = ${cancelledAtSql},
           updated_at = now()
       WHERE id = $1`,
      [task.id, input.toStatus, newVersion, blockedReason],
    );

    await recordTaskEvent({
      tx,
      actor: input.actor,
      correlationId,
      commandName: "task.transition",
      eventName: "task.status_changed",
      taskId: task.id,
      fromStatus: task.status,
      toStatus: input.toStatus,
      reason,
      payload: { fromStatus: task.status, toStatus: input.toStatus, reason },
    });

    return {
      ok: true,
      commandName: "task.transition",
      subjectId: task.id,
      newVersion,
      nextAuthorisedActions: (ALLOWED_TRANSITIONS[input.toStatus] ?? []).map(
        (status) => `task.transition:${status}`,
      ),
      correlationId,
    };
  });
}
