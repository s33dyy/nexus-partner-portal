import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import { makePolicyDenial, type CommandExecutionResult } from "@/domain/contracts/commands";
import {
  GOVERNANCE_GEOGRAPHY_NODE_IDS,
  evaluateActiveContextPolicy,
  type PolicyDecision,
} from "@/domain/contracts/governance";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { withTransaction } from "@/server/command-runtime.server";
import {
  authorizeDealActor,
  loadDealForUpdate,
  validationFailure,
  type DealCommandActor,
} from "@/server/deal-commands.server";
import type { GovernedActor } from "@/server/governed-actor.server";

const PARTICIPANT_TASK_DUE_BUSINESS_DAYS = 2;

function participantTaskDueAt(): string {
  const due = new Date();
  let remaining = PARTICIPANT_TASK_DUE_BUSINESS_DAYS;
  while (remaining > 0) {
    due.setUTCDate(due.getUTCDate() + 1);
    const day = due.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return due.toISOString();
}

/** Tagging a specific person as a participant creates a Task in their queue
 * so the tag actually routes to someone, instead of only ever existing as a
 * row nobody is notified about. Inlined (not a call to task-commands.server.ts's
 * createTask) because that function opens its own withTransaction and can't
 * be nested inside this one — same column set/defaults it uses. */
async function insertParticipantTask(input: {
  tx: PoolClient;
  actor: GovernedActor;
  assigneeId: string;
  partnerId: string | null;
  relatedType: "deal" | "customer";
  relatedId: string;
  subjectLabel: string;
  participantType: string;
}) {
  const taskId = randomUUID();
  await input.tx.query(
    `INSERT INTO tasks (
       id, title, description, status, priority, related_type, related_id,
       assignee_id, creator_id, partner_id, due_at, version
     ) VALUES ($1,$2,$3,'to_do','medium',$4,$5,$6,$7,$8,$9,1)`,
    [
      taskId,
      `You've been tagged as ${input.participantType} on ${input.subjectLabel}`,
      `You were tagged as ${input.participantType} on this ${input.relatedType}. Review and confirm coverage.`,
      input.relatedType,
      input.relatedId,
      input.assigneeId,
      input.actor.userId,
      input.partnerId,
      participantTaskDueAt(),
    ],
  );
}

export type TagDealParticipantInput = {
  dealId: string;
  participantUserId: string;
  participantUserName?: string | null;
  participantType: string;
  reason: string;
};

export async function tagDealParticipant(input: {
  actor: DealCommandActor;
  data: TagDealParticipantInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  return withTransaction(async (tx) => {
    const deal = await loadDealForUpdate(tx, input.data.dealId);
    if (!deal) {
      return { ok: false, failure: validationFailure("Deal not found"), correlationId };
    }

    const policy = authorizeDealActor(input.actor, deal);
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    const participantId = randomUUID();
    // Previously accepted in the input type but never written anywhere —
    // every tag was silently un-assignable to a specific person.
    const participantUserId = input.data.participantUserId.trim() || null;
    // profiles reads are self-only through the generic table policy (by
    // design — it holds every user across every tenant), so the tagging UI
    // can't later re-resolve participant_user_id to a display name via a
    // normal query. Persisting the label the picker already resolved avoids
    // needing a new lookup surface just to show a name instead of a UUID.
    const provenance = input.data.participantUserName
      ? { participantUserName: input.data.participantUserName }
      : {};
    await tx.query(
      `INSERT INTO deal_participants (
         id, deal_id, partner_id, participant_type, source, actor_id, participant_user_id, reason, provenance
       ) VALUES ($1, $2, $3, $4, 'manual', $5, $6, $7, $8)`,
      [
        participantId,
        input.data.dealId,
        deal.partner_id,
        input.data.participantType,
        input.actor.userId,
        participantUserId,
        input.data.reason,
        JSON.stringify(provenance),
      ],
    );

    if (participantUserId) {
      await insertParticipantTask({
        tx,
        actor: input.actor,
        assigneeId: participantUserId,
        partnerId: deal.partner_id,
        relatedType: "deal",
        relatedId: input.data.dealId,
        subjectLabel: deal.account_name,
        participantType: input.data.participantType,
      });
    }

    return {
      ok: true,
      commandName: "deal.tagParticipant",
      subjectId: participantId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

export type UntagDealParticipantInput = {
  dealId: string;
  participantId: string;
};

export async function untagDealParticipant(input: {
  actor: DealCommandActor;
  data: UntagDealParticipantInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  return withTransaction(async (tx) => {
    const deal = await loadDealForUpdate(tx, input.data.dealId);
    if (!deal) {
      return { ok: false, failure: validationFailure("Deal not found"), correlationId };
    }

    const policy = authorizeDealActor(input.actor, deal);
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    await tx.query(
      `UPDATE deal_participants SET valid_to = now(), updated_at = now()
       WHERE id = $1 AND deal_id = $2`,
      [input.data.participantId, input.data.dealId],
    );

    return {
      ok: true,
      commandName: "deal.untagParticipant",
      subjectId: input.data.participantId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

/** No customer-command module exists yet (customers are only scoped through
 * table-policy.server.ts's generic ownership filter today) — this mirrors
 * authorizeDealActor/authorizeTaskActor's shape exactly rather than reusing
 * either, since a Customer's scope key (partner_id) happens to match but the
 * type doesn't. */
function authorizeCustomerActor(
  actor: GovernedActor,
  customer: { partner_id: string | null },
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
    if (!actor.assignment.partnerId || actor.assignment.partnerId !== customer.partner_id) {
      return {
        allowed: false,
        reason: "Customer is outside the assignment's partner scope",
        denial: makePolicyDenial(null, "Customer is outside the assignment's partner scope"),
      };
    }
    return { allowed: true, reason: null };
  }

  // Same deliberate fail-closed placeholder as deal-commands.server.ts/
  // task-commands.server.ts for LIVEY-side roles until a governed geography
  // resolution exists for customers.
  if (actor.assignment.geographyCeilingNodeId === GOVERNANCE_GEOGRAPHY_NODE_IDS.global) {
    return { allowed: true, reason: null };
  }

  return {
    allowed: false,
    reason: "Customer geography scope could not be verified for this assignment",
    denial: makePolicyDenial(
      null,
      "Customer geography scope could not be verified for this assignment",
    ),
  };
}

type CustomerSnapshot = { id: string; partner_id: string | null; company_name: string };

async function loadCustomerForUpdate(
  tx: PoolClient,
  customerId: string,
): Promise<CustomerSnapshot | null> {
  const { rows } = await tx.query(
    `SELECT id, partner_id, company_name FROM portal_customers WHERE id = $1 FOR UPDATE`,
    [customerId],
  );
  const row = rows[0] as CustomerSnapshot | undefined;
  return row ?? null;
}

export type TagCustomerParticipantInput = {
  customerId: string;
  participantUserId: string;
  participantUserName?: string | null;
  participantType: string;
  reason: string;
};

export async function tagCustomerParticipant(input: {
  actor: GovernedActor;
  data: TagCustomerParticipantInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  return withTransaction(async (tx) => {
    const customer = await loadCustomerForUpdate(tx, input.data.customerId);
    if (!customer) {
      return { ok: false, failure: validationFailure("Customer not found"), correlationId };
    }

    const policy = authorizeCustomerActor(input.actor, customer);
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    const participantId = randomUUID();
    const participantUserId = input.data.participantUserId.trim() || null;
    const provenance = input.data.participantUserName
      ? { participantUserName: input.data.participantUserName }
      : {};
    await tx.query(
      `INSERT INTO customer_participants (
         id, customer_id, partner_id, participant_type, source, actor_id, participant_user_id, reason, provenance
       ) VALUES ($1, $2, $3, $4, 'manual', $5, $6, $7, $8)`,
      [
        participantId,
        input.data.customerId,
        customer.partner_id,
        input.data.participantType,
        input.actor.userId,
        participantUserId,
        input.data.reason,
        JSON.stringify(provenance),
      ],
    );

    if (participantUserId) {
      await insertParticipantTask({
        tx,
        actor: input.actor,
        assigneeId: participantUserId,
        partnerId: customer.partner_id,
        relatedType: "customer",
        relatedId: input.data.customerId,
        subjectLabel: customer.company_name,
        participantType: input.data.participantType,
      });
    }

    return {
      ok: true,
      commandName: "customer.tagParticipant",
      subjectId: participantId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

export type UntagCustomerParticipantInput = {
  customerId: string;
  participantId: string;
};

export async function untagCustomerParticipant(input: {
  actor: GovernedActor;
  data: UntagCustomerParticipantInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  return withTransaction(async (tx) => {
    const customer = await loadCustomerForUpdate(tx, input.data.customerId);
    if (!customer) {
      return { ok: false, failure: validationFailure("Customer not found"), correlationId };
    }

    const policy = authorizeCustomerActor(input.actor, customer);
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    await tx.query(
      `UPDATE customer_participants SET valid_to = now(), updated_at = now()
       WHERE id = $1 AND customer_id = $2`,
      [input.data.participantId, input.data.customerId],
    );

    return {
      ok: true,
      commandName: "customer.untagParticipant",
      subjectId: input.data.participantId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}
