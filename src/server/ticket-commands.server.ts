import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import {
  createOutboxEnvelope,
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

const TICKET_EVENT_SCHEMA_VERSION = 1;

// The canonical TICKET_STATE_MACHINE in domain/contracts/state-machine.ts is a
// generic 8-state placeholder (open/triaged/waiting_on_partner/waiting_on_livey/
// resolved/closed/reopened/canceled) that predates this command module and
// doesn't match blueprint Section 13.4's specific 5-label lifecycle or the
// `support_tickets.status` values already live in the database (open/
// in_progress/waiting_on_partner/closed). This module implements Section
// 13.4's actual states and transitions directly, the same way
// deal-commands.server.ts and task-commands.server.ts intentionally diverge
// from mismatched canonical placeholders elsewhere in this codebase.
export const TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting_on_partner",
  "closed",
  "reopen_requested",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["in_progress", "closed"],
  in_progress: ["waiting_on_partner", "closed"],
  waiting_on_partner: ["in_progress", "closed"],
  closed: ["reopen_requested"],
  reopen_requested: ["open", "closed"],
};

function isAllowedTicketTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

const SUPPORT_ROLES = new Set(["super_admin", "livey_support"]);

export type TicketCommandActor = GovernedActor;
export type ResolveTicketCommandActorInput = ResolveGovernedActorInput;
export const resolveTicketCommandActor = resolveGovernedActor;

type TicketSnapshot = {
  id: string;
  status: TicketStatus;
  partnerId: string | null;
  createdBy: string | null;
  subject: string;
};

function validationFailure(message: string, field = "status"): CommandFailureContract {
  return {
    code: "VALIDATION_FAILED",
    message,
    fieldErrors: [{ field, message }],
    retryable: false,
  };
}

function authorizeTicketActor(
  actor: TicketCommandActor,
  ticket: { partnerId: string | null },
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
    if (!actor.assignment.partnerId || actor.assignment.partnerId !== ticket.partnerId) {
      return {
        allowed: false,
        reason: "Ticket is outside the assignment's partner scope",
        denial: makePolicyDenial(null, "Ticket is outside the assignment's partner scope"),
      };
    }
    return { allowed: true, reason: null };
  }

  if (actor.assignment.geographyCeilingNodeId === GOVERNANCE_GEOGRAPHY_NODE_IDS.global) {
    return { allowed: true, reason: null };
  }

  return {
    allowed: false,
    reason: "Ticket geography scope could not be verified for this assignment",
    denial: makePolicyDenial(
      null,
      "Ticket geography scope could not be verified for this assignment",
    ),
  };
}

function requireSupportRole(actor: TicketCommandActor): PolicyDecision {
  if (SUPPORT_ROLES.has(actor.assignment.roleKey)) {
    return { allowed: true, reason: null };
  }
  return {
    allowed: false,
    reason: "Only LIVEY Support or Super Admin can perform this action",
    denial: makePolicyDenial(null, "Only LIVEY Support or Super Admin can perform this action"),
  };
}

async function loadTicketForUpdate(
  tx: PoolClient,
  ticketId: string,
): Promise<TicketSnapshot | null> {
  const { rows } = await tx.query(
    `SELECT id, status, partner_id, created_by, subject FROM support_tickets WHERE id = $1 FOR UPDATE`,
    [ticketId],
  );
  const row = rows[0] as
    | {
        id: string;
        status: string;
        partner_id: string | null;
        created_by: string | null;
        subject: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status as TicketStatus,
    partnerId: row.partner_id,
    createdBy: row.created_by,
    subject: row.subject,
  };
}

async function recordTicketEvent(input: {
  tx: PoolClient;
  actor: TicketCommandActor;
  correlationId: string;
  commandName: string;
  eventName: string;
  ticketId: string;
  payload: Record<string, unknown>;
}) {
  await input.tx.query(
    `INSERT INTO domain_activity_events (
       tenant_id, organization_tenant_id, subject_type, subject_id,
       actor_user_id, assignment_id, correlation_id, event_name, schema_version, payload
     ) VALUES ($1,$2,'ticket',$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.actor.assignment.tenantId,
      input.actor.assignment.organizationTenantId,
      input.ticketId,
      input.actor.userId,
      input.actor.assignment.assignmentId,
      input.correlationId,
      input.eventName,
      TICKET_EVENT_SCHEMA_VERSION,
      JSON.stringify(input.payload),
    ],
  );

  await appendOutboxEnvelope(
    input.tx,
    createOutboxEnvelope({
      eventName: input.eventName,
      schemaVersion: TICKET_EVENT_SCHEMA_VERSION,
      aggregateType: "ticket",
      aggregateId: input.ticketId,
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

function resolveCreatePartnerId(
  actor: TicketCommandActor,
  requested: string | null,
): string | null {
  const role = actor.assignment.roleKey;
  if (role === "partner_admin" || role === "partner_user" || role === "restricted_distributor") {
    return actor.assignment.partnerId ?? null;
  }
  return requested;
}

export type CreateTicketInput = {
  subject: string;
  description: string;
  priority?: string | null;
  partnerId?: string | null;
  creatorName?: string | null;
};

export async function createTicket(input: {
  actor: TicketCommandActor;
  data: CreateTicketInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const subject = input.data.subject.trim();
  const description = input.data.description.trim();

  if (!subject || !description) {
    return {
      ok: false,
      failure: validationFailure("Subject and description are required", "subject"),
      correlationId,
    };
  }

  return withTransaction(async (tx) => {
    const partnerId = resolveCreatePartnerId(input.actor, input.data.partnerId ?? null);
    const policy = authorizeTicketActor(input.actor, { partnerId });
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    const ticketId = randomUUID();
    await tx.query(
      `INSERT INTO support_tickets (
         id, partner_id, created_by, created_by_name, subject, description,
         status, priority, is_seed
       ) VALUES ($1,$2,$3,$4,$5,$6,'open',$7,FALSE)`,
      [
        ticketId,
        partnerId,
        input.actor.userId,
        input.data.creatorName?.trim() || "Portal user",
        subject,
        description,
        input.data.priority?.trim() || "medium",
      ],
    );

    await recordTicketEvent({
      tx,
      actor: input.actor,
      correlationId,
      commandName: "ticket.create",
      eventName: "ticket.created",
      ticketId,
      payload: { subject },
    });

    return {
      ok: true,
      commandName: "ticket.create",
      subjectId: ticketId,
      newVersion: 1,
      nextAuthorisedActions: ["ticket.reply", "ticket.close"],
      correlationId,
    };
  });
}

async function runTicketTransition(input: {
  actor: TicketCommandActor;
  ticketId: string;
  toStatus: TicketStatus;
  commandName: string;
  eventName: string;
  reason: string | null;
  extraGuard?: (ticket: TicketSnapshot) => CommandFailureContract | null;
  requireSupport?: boolean;
  requireRequester?: boolean;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();

  return withTransaction(async (tx) => {
    const ticket = await loadTicketForUpdate(tx, input.ticketId);
    if (!ticket) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Ticket is not accessible"),
        correlationId,
      };
    }

    const policy = authorizeTicketActor(input.actor, { partnerId: ticket.partnerId });
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    if (input.requireSupport) {
      const supportPolicy = requireSupportRole(input.actor);
      if (!supportPolicy.allowed) {
        return { ok: false, failure: supportPolicy.denial, correlationId };
      }
    }

    if (input.requireRequester && ticket.createdBy !== input.actor.userId) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Only the requester can perform this action"),
        correlationId,
      };
    }

    if (!isAllowedTicketTransition(ticket.status, input.toStatus)) {
      return {
        ok: false,
        failure: validationFailure(
          `Ticket cannot move from "${ticket.status}" to "${input.toStatus}"`,
        ),
        correlationId,
      };
    }

    const guardFailure = input.extraGuard?.(ticket);
    if (guardFailure) {
      return { ok: false, failure: guardFailure, correlationId };
    }

    await tx.query(`UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1`, [
      ticket.id,
      input.toStatus,
    ]);

    await recordTicketEvent({
      tx,
      actor: input.actor,
      correlationId,
      commandName: input.commandName,
      eventName: input.eventName,
      ticketId: ticket.id,
      payload: { fromStatus: ticket.status, toStatus: input.toStatus, reason: input.reason },
    });

    return {
      ok: true,
      commandName: input.commandName,
      subjectId: ticket.id,
      newVersion: 1,
      nextAuthorisedActions: (ALLOWED_TRANSITIONS[input.toStatus] ?? []).map(
        (status) => `ticket.transition:${status}`,
      ),
      correlationId,
    };
  });
}

export async function acceptTicket(input: {
  actor: TicketCommandActor;
  ticketId: string;
}): Promise<CommandExecutionResult> {
  return runTicketTransition({
    actor: input.actor,
    ticketId: input.ticketId,
    toStatus: "in_progress",
    commandName: "ticket.accept",
    eventName: "ticket.accepted",
    reason: null,
    requireSupport: true,
  });
}

export async function markTicketWaitingOnPartner(input: {
  actor: TicketCommandActor;
  ticketId: string;
  note?: string | null;
}): Promise<CommandExecutionResult> {
  return runTicketTransition({
    actor: input.actor,
    ticketId: input.ticketId,
    toStatus: "waiting_on_partner",
    commandName: "ticket.wait_on_partner",
    eventName: "ticket.waiting_on_partner",
    reason: input.note ?? null,
    requireSupport: true,
  });
}

export type AddTicketReplyInput = {
  ticketId: string;
  body: string;
  authorName?: string | null;
  authorRole?: string | null;
};

/**
 * Posting a reply is a message, not a lifecycle transition — it only moves
 * the ticket's status in the one case Section 13.4 defines a comment-driven
 * transition for: a Partner reply while the ticket is Waiting on Partner
 * returns it to In Progress. A reply on any other status leaves status
 * unchanged; only the dedicated accept/wait/close/reopen commands move it.
 */
export async function addTicketReply(input: {
  actor: TicketCommandActor;
  data: AddTicketReplyInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const body = input.data.body.trim();
  if (!body) {
    return {
      ok: false,
      failure: validationFailure("Reply body is required", "body"),
      correlationId,
    };
  }

  return withTransaction(async (tx) => {
    const ticket = await loadTicketForUpdate(tx, input.data.ticketId);
    if (!ticket) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Ticket is not accessible"),
        correlationId,
      };
    }

    const policy = authorizeTicketActor(input.actor, { partnerId: ticket.partnerId });
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    if (ticket.status === "closed" || ticket.status === "reopen_requested") {
      return {
        ok: false,
        failure: validationFailure(
          "This ticket is closed — request a reopen before replying",
          "status",
        ),
        correlationId,
      };
    }

    await tx.query(
      `INSERT INTO support_ticket_comments (
         id, ticket_id, author_id, author_name, author_role, body, is_seed
       ) VALUES ($1,$2,$3,$4,$5,$6,FALSE)`,
      [
        randomUUID(),
        ticket.id,
        input.actor.userId,
        input.data.authorName?.trim() || "Portal user",
        input.data.authorRole?.trim() || input.actor.assignment.roleKey,
        body,
      ],
    );

    const isPartnerAuthor =
      input.actor.assignment.roleKey === "partner_admin" ||
      input.actor.assignment.roleKey === "partner_user" ||
      input.actor.assignment.roleKey === "restricted_distributor";
    const nextStatus: TicketStatus =
      ticket.status === "waiting_on_partner" && isPartnerAuthor ? "in_progress" : ticket.status;

    await tx.query(`UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1`, [
      ticket.id,
      nextStatus,
    ]);

    await recordTicketEvent({
      tx,
      actor: input.actor,
      correlationId,
      commandName: "ticket.reply",
      eventName: "ticket.replied",
      ticketId: ticket.id,
      payload: { fromStatus: ticket.status, toStatus: nextStatus },
    });

    return {
      ok: true,
      commandName: "ticket.reply",
      subjectId: ticket.id,
      newVersion: 1,
      nextAuthorisedActions: (ALLOWED_TRANSITIONS[nextStatus] ?? []).map(
        (status) => `ticket.transition:${status}`,
      ),
      correlationId,
    };
  });
}

export async function closeTicket(input: {
  actor: TicketCommandActor;
  ticketId: string;
  resolutionNote?: string | null;
}): Promise<CommandExecutionResult> {
  return runTicketTransition({
    actor: input.actor,
    ticketId: input.ticketId,
    toStatus: "closed",
    commandName: "ticket.close",
    eventName: "ticket.closed",
    reason: input.resolutionNote ?? null,
    requireSupport: true,
  });
}

export async function requestReopen(input: {
  actor: TicketCommandActor;
  ticketId: string;
  reason: string;
}): Promise<CommandExecutionResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return {
      ok: false,
      failure: validationFailure("A reason is required to request reopening", "reason"),
      correlationId: createCorrelationId(),
    };
  }

  return runTicketTransition({
    actor: input.actor,
    ticketId: input.ticketId,
    toStatus: "reopen_requested",
    commandName: "ticket.request_reopen",
    eventName: "ticket.reopen_requested",
    reason,
    requireRequester: true,
  });
}

export async function decideReopen(input: {
  actor: TicketCommandActor;
  ticketId: string;
  approve: boolean;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return runTicketTransition({
    actor: input.actor,
    ticketId: input.ticketId,
    toStatus: input.approve ? "open" : "closed",
    commandName: "ticket.decide_reopen",
    eventName: input.approve ? "ticket.reopen_approved" : "ticket.reopen_rejected",
    reason: input.reason ?? null,
    requireSupport: true,
  });
}
