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
import { DEAL_STAGE_ORDER, type DealStage } from "@/lib/portal-records";
import { appendOutboxEnvelope, withTransaction } from "@/server/command-runtime.server";
import {
  resolveGovernedActor,
  type GovernedActor,
  type ResolveGovernedActorInput,
} from "@/server/governed-actor.server";

const DEAL_EVENT_SCHEMA_VERSION = 1;

// The canonical blueprint defines eight deal stages with no "approved" stage —
// "approved" belongs to the PO/outcome review status, not the pipeline. The
// deployed pipeline UI (portal-records.ts DEAL_STAGE_ORDER) has always carried a
// ninth "approved" stage between negotiation and won, and seeded/live deal rows
// already use it. Reconciling the two is a product decision (would change the
// visible pipeline columns), so this command module intentionally enforces the
// stage order actually in production rather than the narrower canonical list.
const TERMINAL_STAGES = new Set<DealStage>(["won", "lost"]);

const FORWARD_NEXT_STAGE: Partial<Record<DealStage, DealStage>> = {};
for (let index = 0; index < DEAL_STAGE_ORDER.length - 1; index += 1) {
  const from = DEAL_STAGE_ORDER[index];
  const to = DEAL_STAGE_ORDER[index + 1];
  if (TERMINAL_STAGES.has(from) || TERMINAL_STAGES.has(to)) continue;
  FORWARD_NEXT_STAGE[from] = to;
}

function isBackwardMove(from: DealStage, to: DealStage): boolean {
  if (TERMINAL_STAGES.has(from) || TERMINAL_STAGES.has(to)) return false;
  const fromIndex = DEAL_STAGE_ORDER.indexOf(from);
  const toIndex = DEAL_STAGE_ORDER.indexOf(to);
  return fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex;
}

export type DealCommandActor = GovernedActor;
export type ResolveDealCommandActorInput = ResolveGovernedActorInput;
export const resolveDealCommandActor = resolveGovernedActor;

type DealSnapshot = {
  id: string;
  stage: DealStage;
  status: string;
  partner_id: string | null;
  version: number;
  account_name: string;
};

function authorizeDealActor(
  actor: DealCommandActor,
  deal: Pick<DealSnapshot, "partner_id">,
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
    if (!actor.assignment.partnerId || actor.assignment.partnerId !== deal.partner_id) {
      return {
        allowed: false,
        reason: "Deal is outside the assignment's partner scope",
        denial: makePolicyDenial(null, "Deal is outside the assignment's partner scope"),
      };
    }
    return { allowed: true, reason: null };
  }

  // LIVEY-side roles (rm/pam/kam/isr/livey_support): a deal's free-text
  // country/region cannot yet be resolved to a governed geography node with
  // confidence, so only an assignment with a Global ceiling is trusted. This is
  // a deliberate fail-closed choice rather than inferring scope from ambiguous
  // legacy geography strings.
  if (actor.assignment.geographyCeilingNodeId === GOVERNANCE_GEOGRAPHY_NODE_IDS.global) {
    return { allowed: true, reason: null };
  }

  return {
    allowed: false,
    reason: "Deal geography scope could not be verified for this assignment",
    denial: makePolicyDenial(
      null,
      "Deal geography scope could not be verified for this assignment",
    ),
  };
}

async function loadDealForUpdate(tx: PoolClient, dealId: string): Promise<DealSnapshot | null> {
  const { rows } = await tx.query(
    `SELECT id, stage, status, partner_id, version, account_name
     FROM portal_deals WHERE id = $1 FOR UPDATE`,
    [dealId],
  );
  const row = rows[0] as
    | {
        id: string;
        stage: string;
        status: string;
        partner_id: string | null;
        version: number;
        account_name: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    stage: row.stage as DealStage,
    status: row.status,
    partner_id: row.partner_id,
    version: Number(row.version),
    account_name: row.account_name,
  };
}

async function recordTransitionAndOutbox(input: {
  tx: PoolClient;
  actor: DealCommandActor;
  correlationId: string;
  commandName: string;
  eventName: string;
  deal: DealSnapshot;
  toStage: DealStage;
  toStatus: string;
  reason: string | null;
  payload: Record<string, unknown>;
}) {
  await input.tx.query(
    `INSERT INTO deal_transitions (
       deal_id, command_name, from_stage, to_stage, from_status, to_status,
       actor_user_id, assignment_id, reason, correlation_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.deal.id,
      input.commandName,
      input.deal.stage,
      input.toStage,
      input.deal.status,
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
     ) VALUES ($1,$2,'deal',$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.actor.assignment.tenantId,
      input.actor.assignment.organizationTenantId,
      input.deal.id,
      input.actor.userId,
      input.actor.assignment.assignmentId,
      input.correlationId,
      input.eventName,
      DEAL_EVENT_SCHEMA_VERSION,
      JSON.stringify(input.payload),
    ],
  );

  await appendOutboxEnvelope(
    input.tx,
    createOutboxEnvelope({
      eventName: input.eventName,
      schemaVersion: DEAL_EVENT_SCHEMA_VERSION,
      aggregateType: "deal",
      aggregateId: input.deal.id,
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

function validationFailure(message: string, field = "stage"): CommandFailureContract {
  return {
    code: "VALIDATION_FAILED",
    message,
    fieldErrors: [{ field, message }],
    retryable: false,
  };
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function runDealTransitionCommand(input: {
  actor: DealCommandActor;
  dealId: string;
  expectedVersion: number;
  commandName: string;
  eventName: string;
  reason: string | null;
  resolveTarget: (
    deal: DealSnapshot,
  ) => { toStage: DealStage; toStatus: string } | CommandFailureContract;
  extraSet?: (deal: DealSnapshot, toStage: DealStage) => { sql: string; values: unknown[] };
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();

  return withTransaction(async (tx) => {
    const deal = await loadDealForUpdate(tx, input.dealId);
    if (!deal) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Deal is not accessible"),
        correlationId,
      };
    }

    const policy = authorizeDealActor(input.actor, deal);
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    if (deal.version !== input.expectedVersion) {
      return {
        ok: false,
        failure: makeConcurrencyError(deal.id, input.expectedVersion, deal.version),
        correlationId,
      };
    }

    const target = input.resolveTarget(deal);
    if ("code" in target) {
      return { ok: false, failure: target, correlationId };
    }

    const newVersion = deal.version + 1;
    const extra = input.extraSet?.(deal, target.toStage);
    const extraSql = extra ? `, ${extra.sql}` : "";
    const extraValues = extra?.values ?? [];

    await tx.query(
      `UPDATE portal_deals
       SET stage = $2, status = $3, version = $4, last_touch = $5, updated_at = now()${extraSql}
       WHERE id = $1`,
      [
        deal.id,
        target.toStage,
        target.toStatus,
        newVersion,
        `${input.commandName} (${input.reason ?? "no reason given"})`.slice(0, 200),
        ...extraValues,
      ],
    );

    await recordTransitionAndOutbox({
      tx,
      actor: input.actor,
      correlationId,
      commandName: input.commandName,
      eventName: input.eventName,
      deal,
      toStage: target.toStage,
      toStatus: target.toStatus,
      reason: input.reason,
      payload: {
        fromStage: deal.stage,
        toStage: target.toStage,
        fromStatus: deal.status,
        toStatus: target.toStatus,
        reason: input.reason,
      },
    });

    return {
      ok: true,
      commandName: input.commandName,
      subjectId: deal.id,
      newVersion,
      nextAuthorisedActions: nextAuthorisedActions(target.toStage),
      correlationId,
    };
  });
}

function nextAuthorisedActions(stage: DealStage): readonly string[] {
  if (TERMINAL_STAGES.has(stage)) return [];
  const actions = ["deal.move_stage_backward", "deal.mark_lost"];
  if (FORWARD_NEXT_STAGE[stage]) actions.unshift("deal.move_stage_forward");
  if (stage === "approved") actions.push("deal.mark_won");
  return actions;
}

export async function moveDealStageForward(input: {
  actor: DealCommandActor;
  dealId: string;
  expectedVersion: number;
  note?: string | null;
}): Promise<CommandExecutionResult> {
  return runDealTransitionCommand({
    actor: input.actor,
    dealId: input.dealId,
    expectedVersion: input.expectedVersion,
    commandName: "deal.move_stage_forward",
    eventName: "deal.stage_advanced",
    reason: input.note ?? null,
    resolveTarget: (deal) => {
      const toStage = FORWARD_NEXT_STAGE[deal.stage];
      if (!toStage) {
        return validationFailure(`Deal cannot move forward from stage "${deal.stage}"`);
      }
      return { toStage, toStatus: deal.status };
    },
  });
}

export async function moveDealStageBackward(input: {
  actor: DealCommandActor;
  dealId: string;
  expectedVersion: number;
  toStage: DealStage;
  reason: string;
}): Promise<CommandExecutionResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return {
      ok: false,
      failure: validationFailure("A reason is required to move a deal backward", "reason"),
      correlationId: createCorrelationId(),
    };
  }

  return runDealTransitionCommand({
    actor: input.actor,
    dealId: input.dealId,
    expectedVersion: input.expectedVersion,
    commandName: "deal.move_stage_backward",
    eventName: "deal.stage_reverted",
    reason,
    resolveTarget: (deal) => {
      if (!isBackwardMove(deal.stage, input.toStage)) {
        return validationFailure(
          `"${input.toStage}" is not a valid backward stage from "${deal.stage}"`,
        );
      }
      return { toStage: input.toStage, toStatus: deal.status };
    },
  });
}

export async function markDealLost(input: {
  actor: DealCommandActor;
  dealId: string;
  expectedVersion: number;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return runDealTransitionCommand({
    actor: input.actor,
    dealId: input.dealId,
    expectedVersion: input.expectedVersion,
    commandName: "deal.mark_lost",
    eventName: "deal.lost",
    reason: input.reason ?? null,
    resolveTarget: (deal) => {
      if (TERMINAL_STAGES.has(deal.stage)) {
        return validationFailure(`Deal is already closed as "${deal.stage}"`);
      }
      return { toStage: "lost", toStatus: "lost" };
    },
    extraSet: () => ({
      sql: "probability = $6, close_date = $7",
      values: [0, todayIsoDate()],
    }),
  });
}

export async function markDealWon(input: {
  actor: DealCommandActor;
  dealId: string;
  expectedVersion: number;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return runDealTransitionCommand({
    actor: input.actor,
    dealId: input.dealId,
    expectedVersion: input.expectedVersion,
    commandName: "deal.mark_won",
    eventName: "deal.won",
    reason: input.reason ?? null,
    resolveTarget: (deal) => {
      if (TERMINAL_STAGES.has(deal.stage)) {
        return validationFailure(`Deal is already closed as "${deal.stage}"`);
      }
      return { toStage: "won", toStatus: "won" };
    },
    extraSet: () => ({
      sql: "probability = $6, close_date = $7",
      values: [100, todayIsoDate()],
    }),
  });
}
