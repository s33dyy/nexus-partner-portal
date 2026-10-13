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
import { hasCapability, loadEffectiveCapabilities } from "@/server/rbac-policy.server";
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

/** Exported so workflow-automation.server.ts can close a generated Task
 * through the same table a human transition uses, rather than keeping a
 * second copy of the lifecycle that could drift from this one. */
export const ALLOWED_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  to_do: ["in_progress", "blocked", "completed", "cancelled"],
  in_progress: ["to_do", "blocked", "completed", "cancelled"],
  blocked: ["to_do", "in_progress", "cancelled"],
  completed: ["to_do"],
  cancelled: ["to_do"],
};

export function isAllowedTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
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
  assigneeId: string | null;
  creatorId: string | null;
  proposedCompletionAt: string | null;
};

export type TaskRecord = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: string;
  related_type: string | null;
  related_id: string | null;
  assignee_id: string | null;
  assignee_name?: string | null;
  creator_id: string | null;
  creator_name?: string | null;
  partner_id: string | null;
  due_at: string | null;
  proposed_completion_at: string | null;
  blocked_reason: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type TaskAssignee = {
  id: string;
  full_name: string;
  email: string;
  partner_id: string | null;
  role_key: string;
};

export type TaskPatch = {
  title?: string;
  description?: string | null;
  priority?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  assigneeId?: string | null;
  dueAt?: string | null;
  status?: TaskStatus;
  blockedReason?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  proposedCompletionAt?: string | null;
  version?: number;
};

const TASK_CREATE_FOR_OTHERS_ROLES = new Set(["super_admin", "rm", "kam", "pam", "partner_admin"]);

function authorizeTaskActor(
  actor: TaskCommandActor,
  task: { partnerId: string | null; assigneeId?: string | null; creatorId?: string | null },
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

  // §2.4 interim fix: tasks has no participant-tag table of its own (unlike
  // deal_participants/customer_participants), so the full §8.7 tag-based
  // model isn't buildable here yet. Narrower than the flat partner_id match
  // partner_admin/partner_user keep below: a Distributor may only act on a
  // Task they are the assignee or creator of, not every Task in the tenant.
  if (actor.assignment.roleKey === "restricted_distributor") {
    if (!actor.assignment.partnerId || actor.assignment.partnerId !== task.partnerId) {
      return {
        allowed: false,
        reason: "Task is outside the assignment's partner scope",
        denial: makePolicyDenial(null, "Task is outside the assignment's partner scope"),
      };
    }
    const isAssigneeOrCreator =
      (!!task.assigneeId && task.assigneeId === actor.userId) ||
      (!!task.creatorId && task.creatorId === actor.userId);
    if (!isAssigneeOrCreator) {
      return {
        allowed: false,
        reason: "Task is not assigned to or created by this Distributor",
        denial: makePolicyDenial(null, "Task is not assigned to or created by this Distributor"),
      };
    }
    return { allowed: true, reason: null };
  }

  if (actor.assignment.roleKey === "partner_admin" || actor.assignment.roleKey === "partner_user") {
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

function canCreateForAnotherUser(actor: TaskCommandActor): boolean {
  return TASK_CREATE_FOR_OTHERS_ROLES.has(actor.assignment.roleKey);
}

async function authorizeTaskCapability(
  actor: TaskCommandActor,
  operation: "create" | "read" | "update" | "delete",
): Promise<PolicyDecision> {
  const capabilities = await loadEffectiveCapabilities(actor.userId, actor.assignment.roleKey);
  if (hasCapability(capabilities, "tasks", operation)) return { allowed: true, reason: null };
  const message = `You cannot ${operation} tasks`;
  return { allowed: false, reason: message, denial: makePolicyDenial(null, message) };
}

async function validateTaskAssignee(
  tx: PoolClient,
  actor: TaskCommandActor,
  assigneeId: string | null | undefined,
): Promise<PolicyDecision> {
  if (!assigneeId || assigneeId === actor.userId) return { allowed: true, reason: null };
  if (!canCreateForAnotherUser(actor)) {
    return {
      allowed: false,
      reason: "This role may only create tasks for itself",
      denial: makePolicyDenial(null, "This role may only create tasks for itself"),
    };
  }

  const { rows } = await tx.query(
    `SELECT p.id, p.partner_id, a.role_key, a.tenant_id, a.organization_tenant_id,
            a.geography_ceiling_node_id, a.status
     FROM profiles p
     JOIN assignments a ON a.user_id = p.id
     WHERE p.id = $1
       AND a.status = 'active'
       AND a.revoked_at IS NULL
       AND a.valid_from <= now()
       AND (a.valid_to IS NULL OR a.valid_to > now())
     ORDER BY a.valid_from DESC
     LIMIT 1`,
    [assigneeId],
  );
  const target = rows[0] as
    | {
        id: string;
        partner_id: string | null;
        role_key: string;
        tenant_id: string;
        organization_tenant_id: string;
        geography_ceiling_node_id: string;
      }
    | undefined;

  if (!target || target.organization_tenant_id !== actor.assignment.organizationTenantId) {
    return {
      allowed: false,
      reason: "The selected assignee is outside your governed scope",
      denial: makePolicyDenial(null, "The selected assignee is outside your governed scope"),
    };
  }

  const actorIsPartnerRole =
    actor.assignment.roleKey === "partner_admin" || actor.assignment.roleKey === "partner_user";
  if (actorIsPartnerRole && target.partner_id !== actor.assignment.partnerId) {
    return {
      allowed: false,
      reason: "The selected assignee is outside your partner scope",
      denial: makePolicyDenial(null, "The selected assignee is outside your partner scope"),
    };
  }

  return { allowed: true, reason: null };
}

async function loadTaskForUpdate(tx: PoolClient, taskId: string): Promise<TaskSnapshot | null> {
  const { rows } = await tx.query(
    `SELECT id, status, partner_id, version, title, assignee_id, creator_id, proposed_completion_at
     FROM tasks WHERE id = $1 FOR UPDATE`,
    [taskId],
  );
  const row = rows[0] as
    | {
        id: string;
        status: string;
        partner_id: string | null;
        version: number;
        title: string;
        assignee_id: string | null;
        creator_id: string | null;
        proposed_completion_at: Date | string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status as TaskStatus,
    partnerId: row.partner_id,
    version: Number(row.version),
    title: row.title,
    assigneeId: row.assignee_id ?? null,
    creatorId: row.creator_id ?? null,
    proposedCompletionAt: toIsoOrNull(row.proposed_completion_at),
  };
}

function toIsoOrNull(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
  recordTransition?: boolean;
}) {
  if (input.recordTransition !== false) {
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
  }

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
  // The owner's own forecast of when this actually lands, distinct from
  // dueAt (the deadline someone else set). Reminders fire off this, not
  // dueAt — see domain/contracts/reminders.ts.
  proposedCompletionAt?: string | null;
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

  const capability = await authorizeTaskCapability(input.actor, "create");
  if (!capability.allowed) {
    return { ok: false, failure: capability.denial, correlationId };
  }

  return withTransaction(async (tx) => {
    const partnerId = resolveCreatePartnerId(input.actor, input.data.partnerId ?? null);
    // The creator is always the acting user for a brand-new Task, so this
    // trivially satisfies restricted_distributor's assignee-or-creator check
    // above — a Distributor can always create a Task within their own
    // partner scope, same as today, just narrower once someone else reads
    // or transitions it unless they're also the assignee.
    const policy = authorizeTaskActor(input.actor, {
      partnerId,
      assigneeId: input.data.assigneeId ?? null,
      creatorId: input.actor.userId,
    });
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    const assigneePolicy = await validateTaskAssignee(tx, input.actor, input.data.assigneeId);
    if (!assigneePolicy.allowed) {
      return { ok: false, failure: assigneePolicy.denial, correlationId };
    }

    const taskId = randomUUID();
    await tx.query(
      `INSERT INTO tasks (
         id, title, description, status, priority, related_type, related_id,
         assignee_id, creator_id, partner_id, due_at, proposed_completion_at, version
       ) VALUES ($1,$2,$3,'to_do',$4,$5,$6,$7,$8,$9,$10,$11,1)`,
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
        input.data.proposedCompletionAt ?? null,
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
      payload: {
        title,
        relatedType: input.data.relatedType ?? null,
        proposedCompletionAt: input.data.proposedCompletionAt ?? null,
      },
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

export async function listTasks(input: {
  actor: TaskCommandActor;
}): Promise<{ ok: true; data: TaskRecord[] } | { ok: false; failure: CommandFailureContract }> {
  const capability = await authorizeTaskCapability(input.actor, "read");
  if (!capability.allowed) return { ok: false, failure: capability.denial };
  const policy = evaluateActiveContextPolicy({
    roles: [input.actor.assignment.roleKey],
    assignment: input.actor.assignment,
    activeContext: input.actor.activeContext,
  });
  if (!policy.allowed) return { ok: false, failure: policy.denial };

  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (input.actor.assignment.roleKey === "super_admin") {
    // Super Admin is intentionally unscoped.
  } else if (input.actor.assignment.partnerId) {
    conditions.push(`t.partner_id = ${add(input.actor.assignment.partnerId)}`);
    if (input.actor.assignment.roleKey === "restricted_distributor") {
      const user = add(input.actor.userId);
      conditions.push(`(t.creator_id = ${user} OR t.assignee_id = ${user})`);
    }
  } else {
    const user = add(input.actor.userId);
    conditions.push(`(t.creator_id = ${user} OR t.assignee_id = ${user})`);
  }

  const { pool } = await import("@/server/postgres.server");
  const result = await pool.query(
    `SELECT t.id, t.title, t.description, t.status, t.priority, t.related_type,
            t.related_id, t.assignee_id, assignee.full_name AS assignee_name,
            t.creator_id, creator.full_name AS creator_name, t.partner_id, t.due_at,
            t.proposed_completion_at, t.blocked_reason, t.completed_at, t.cancelled_at,
            t.version, t.created_at, t.updated_at
     FROM tasks t
     LEFT JOIN profiles assignee ON assignee.id = t.assignee_id
     LEFT JOIN profiles creator ON creator.id = t.creator_id
     ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY t.created_at DESC`,
    params,
  );
  return { ok: true, data: result.rows as TaskRecord[] };
}

export async function listTaskAssignees(input: {
  actor: TaskCommandActor;
}): Promise<{ ok: true; data: TaskAssignee[] } | { ok: false; failure: CommandFailureContract }> {
  if (!canCreateForAnotherUser(input.actor)) {
    return { ok: true, data: [] };
  }
  const { pool } = await import("@/server/postgres.server");
  const params: unknown[] = [input.actor.assignment.organizationTenantId];
  let partnerClause = "";
  if (input.actor.assignment.partnerId) {
    params.push(input.actor.assignment.partnerId);
    partnerClause = `AND a.partner_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT DISTINCT p.id, p.full_name, p.email, p.partner_id, a.role_key
     FROM profiles p
     JOIN assignments a ON a.user_id = p.id
     WHERE a.organization_tenant_id = $1
       AND a.status = 'active'
       AND a.revoked_at IS NULL
       AND a.valid_from <= now()
       AND (a.valid_to IS NULL OR a.valid_to > now())
       ${partnerClause}
     ORDER BY p.full_name ASC, p.email ASC`,
    params,
  );
  return { ok: true, data: rows as TaskAssignee[] };
}

export async function updateTask(input: {
  actor: TaskCommandActor;
  taskId: string;
  expectedVersion?: number;
  patch: TaskPatch;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const protectedFields = Object.keys(input.patch).filter((field) =>
    [
      "status",
      "blockedReason",
      "completedAt",
      "cancelledAt",
      "proposedCompletionAt",
      "version",
    ].includes(field),
  );
  if (protectedFields.length > 0) {
    return {
      ok: false,
      failure: validationFailure(
        "Task lifecycle fields require a named task command",
        protectedFields[0],
      ),
      correlationId,
    };
  }
  const capability = await authorizeTaskCapability(input.actor, "update");
  if (!capability.allowed) return { ok: false, failure: capability.denial, correlationId };

  return withTransaction(async (tx) => {
    const task = await loadTaskForUpdate(tx, input.taskId);
    if (!task) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Task is not accessible"),
        correlationId,
      };
    }
    const policy = authorizeTaskActor(input.actor, task);
    if (!policy.allowed) return { ok: false, failure: policy.denial, correlationId };
    if (input.expectedVersion != null && task.version !== input.expectedVersion) {
      return {
        ok: false,
        failure: makeConcurrencyError(task.id, input.expectedVersion, task.version),
        correlationId,
      };
    }
    const assigneePolicy = await validateTaskAssignee(tx, input.actor, input.patch.assigneeId);
    if (!assigneePolicy.allowed) {
      return { ok: false, failure: assigneePolicy.denial, correlationId };
    }

    const columns: Array<[string, unknown]> = [];
    if (input.patch.title !== undefined) {
      const title = input.patch.title.trim();
      if (!title) {
        return {
          ok: false,
          failure: validationFailure("A task title is required", "title"),
          correlationId,
        };
      }
      columns.push(["title", title]);
    }
    if (input.patch.description !== undefined) {
      columns.push(["description", input.patch.description?.trim() ?? ""]);
    }
    if (input.patch.priority !== undefined) {
      columns.push(["priority", input.patch.priority?.trim() || "medium"]);
    }
    if (input.patch.relatedType !== undefined) {
      columns.push(["related_type", input.patch.relatedType]);
    }
    if (input.patch.relatedId !== undefined) {
      columns.push(["related_id", input.patch.relatedId]);
    }
    if (input.patch.assigneeId !== undefined) {
      columns.push(["assignee_id", input.patch.assigneeId]);
    }
    if (input.patch.dueAt !== undefined) columns.push(["due_at", input.patch.dueAt]);
    if (columns.length === 0) {
      return {
        ok: false,
        failure: validationFailure("At least one task field is required", "patch"),
        correlationId,
      };
    }

    const assignments = columns.map(([column], index) => `"${column}" = $${index + 2}`);
    const params = [task.id, ...columns.map(([, value]) => value), task.version + 1];
    await tx.query(
      `UPDATE tasks SET ${assignments.join(", ")}, version = $${params.length}, updated_at = now() WHERE id = $1`,
      params,
    );
    await recordTaskEvent({
      tx,
      actor: input.actor,
      correlationId,
      commandName: "task.update",
      eventName: "task.updated",
      taskId: task.id,
      fromStatus: task.status,
      toStatus: task.status,
      reason: null,
      payload: { fields: columns.map(([column]) => column) },
    });
    return {
      ok: true,
      commandName: "task.update",
      subjectId: task.id,
      newVersion: task.version + 1,
      nextAuthorisedActions: ["task.transition", "task.update"],
      correlationId,
    };
  });
}

export async function deleteTask(input: {
  actor: TaskCommandActor;
  taskId: string;
  expectedVersion?: number;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const capability = await authorizeTaskCapability(input.actor, "delete");
  if (!capability.allowed) return { ok: false, failure: capability.denial, correlationId };
  return withTransaction(async (tx) => {
    const task = await loadTaskForUpdate(tx, input.taskId);
    if (!task) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Task is not accessible"),
        correlationId,
      };
    }
    if (input.expectedVersion != null && task.version !== input.expectedVersion) {
      return {
        ok: false,
        failure: makeConcurrencyError(task.id, input.expectedVersion, task.version),
        correlationId,
      };
    }
    await recordTaskEvent({
      tx,
      actor: input.actor,
      correlationId,
      commandName: "task.delete",
      eventName: "task.deleted",
      taskId: task.id,
      fromStatus: task.status,
      toStatus: task.status,
      reason: null,
      payload: { title: task.title },
      recordTransition: false,
    });
    await tx.query("DELETE FROM tasks WHERE id = $1", [task.id]);
    return {
      ok: true,
      commandName: "task.delete",
      subjectId: task.id,
      newVersion: task.version + 1,
      nextAuthorisedActions: [],
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

    const policy = authorizeTaskActor(input.actor, {
      partnerId: task.partnerId,
      assigneeId: task.assigneeId,
      creatorId: task.creatorId,
    });
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

// A proposed completion date is a promise, and moving it is the single most
// interesting thing that happens to one — "this slipped three times" is only
// visible if each slip is recorded. So this is a named command with the same
// lock/version/policy/evidence path as transitionTask, not a generic column
// update (table-policy.server.ts blocks the generic path for this column for
// exactly that reason).
export async function setTaskProposedCompletion(input: {
  actor: TaskCommandActor;
  taskId: string;
  expectedVersion: number;
  proposedCompletionAt: string | null;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const reason = input.reason?.trim() || null;

  let normalized: string | null = null;
  if (input.proposedCompletionAt) {
    const parsed = new Date(input.proposedCompletionAt);
    if (Number.isNaN(parsed.getTime())) {
      return {
        ok: false,
        failure: validationFailure(
          "Enter a valid proposed completion date",
          "proposedCompletionAt",
        ),
        correlationId,
      };
    }
    normalized = parsed.toISOString();
  }

  return withTransaction(async (tx) => {
    const task = await loadTaskForUpdate(tx, input.taskId);
    if (!task) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Task is not accessible"),
        correlationId,
      };
    }

    const policy = authorizeTaskActor(input.actor, {
      partnerId: task.partnerId,
      assigneeId: task.assigneeId,
      creatorId: task.creatorId,
    });
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

    // Closed work has nothing left to forecast, and letting a date land on a
    // completed task would make the reminder sweep chase records nobody is
    // working on.
    if (task.status === "completed" || task.status === "cancelled") {
      return {
        ok: false,
        failure: validationFailure(
          `A ${task.status} task has no proposed completion date to set`,
          "proposedCompletionAt",
        ),
        correlationId,
      };
    }

    const newVersion = task.version + 1;
    await tx.query(
      `UPDATE tasks
       SET proposed_completion_at = $2, version = $3, updated_at = now()
       WHERE id = $1`,
      [task.id, normalized, newVersion],
    );

    await recordTaskEvent({
      tx,
      actor: input.actor,
      correlationId,
      commandName: "task.set_proposed_completion",
      eventName: "task.proposed_completion_changed",
      taskId: task.id,
      // Status is genuinely unchanged here; task_transitions is the Task's
      // one evidence log, so the row carries the same status on both sides
      // and is distinguished by command_name.
      fromStatus: task.status,
      toStatus: task.status,
      reason,
      payload: {
        fromProposedCompletionAt: task.proposedCompletionAt,
        toProposedCompletionAt: normalized,
        reason,
      },
    });

    return {
      ok: true,
      commandName: "task.set_proposed_completion",
      subjectId: task.id,
      newVersion,
      nextAuthorisedActions: ["task.transition", "task.set_proposed_completion"],
      correlationId,
    };
  });
}
