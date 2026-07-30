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
  buildGeographyGraph,
  buildGovernanceSeedRows,
  containsGeography,
  evaluateActiveContextPolicy,
  type PolicyDecision,
  countryNodeId,
} from "@/domain/contracts/governance";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { SALES_REGIONS, resolveCountryForText } from "@/domain/contracts/world-geography";
import {
  DEAL_STAGE_ORDER,
  parseDealAmount,
  requiresSuperAdminApproval,
  type DealStage,
} from "@/lib/portal-records";
import { appendOutboxEnvelope, withTransaction } from "@/server/command-runtime.server";
import {
  resolveGovernedActor,
  type GovernedActor,
  type ResolveGovernedActorInput,
} from "@/server/governed-actor.server";

const DEAL_EVENT_SCHEMA_VERSION = 1;
const GOVERNANCE_GEOGRAPHY_GRAPH = (() => {
  const seedRows = buildGovernanceSeedRows({
    superAdminUserId: "__geography_authorizer__",
  });
  return buildGeographyGraph(seedRows.geographyNodes, seedRows.geographyAliases);
})();

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

export type DealSnapshot = {
  id: string;
  stage: DealStage;
  status: string;
  partner_id: string | null;
  country: string | null;
  region: string | null;
  version: number;
  account_name: string;
  commercial_approved: boolean;
};

export function authorizeDealActor(
  actor: DealCommandActor,
  deal: Pick<DealSnapshot, "partner_id" | "country" | "region">,
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

  if (actor.assignment.geographyCeilingNodeId === GOVERNANCE_GEOGRAPHY_NODE_IDS.global) {
    return { allowed: true, reason: null };
  }

  const resolvedCountry = resolveCountryForText(deal.country ?? deal.region);
  if (!resolvedCountry) {
    return {
      allowed: false,
      reason: "Deal geography could not be resolved for this assignment",
      denial: makePolicyDenial(
        null,
        "Deal geography could not be resolved for this assignment",
      ),
    };
  }

  const dealCountryNodeId = countryNodeId(resolvedCountry.code);
  if (
    containsGeography(
      GOVERNANCE_GEOGRAPHY_GRAPH,
      actor.assignment.geographyCeilingNodeId,
      dealCountryNodeId,
    )
  ) {
    return { allowed: true, reason: null };
  }

  return {
    allowed: false,
    reason: "Deal is outside the assignment's geography scope",
    denial: makePolicyDenial(null, "Deal is outside the assignment's geography scope"),
  };
}

export async function loadDealForUpdate(tx: PoolClient, dealId: string): Promise<DealSnapshot | null> {
  const { rows } = await tx.query(
    `SELECT id, stage, status, partner_id, version, account_name
            , country, region, commercial_approved
     FROM portal_deals WHERE id = $1 FOR UPDATE`,
    [dealId],
  );
  const row = rows[0] as
    | {
        id: string;
        stage: string;
        status: string;
        partner_id: string | null;
        country: string | null;
        region: string | null;
        version: number;
        account_name: string;
        commercial_approved: boolean;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    stage: row.stage as DealStage,
    status: row.status,
    partner_id: row.partner_id,
    country: row.country ?? null,
    region: row.region ?? null,
    version: Number(row.version),
    account_name: row.account_name,
    commercial_approved: row.commercial_approved,
  };
}

export async function recordTransitionAndOutbox(input: {
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

export function validationFailure(message: string, field = "stage"): CommandFailureContract {
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

export type CreateDealInput = {
  accountName: string;
  contactName: string;
  ownerName?: string | null;
  country?: string | null;
  region?: string | null;
  product: string;
  quantity?: number | null;
  amount: string;
  currencyCode?: string | null;
  amountValue?: number | null;
  amountUsd?: number | null;
  customerBudget?: string | null;
  possibleCloseDate?: string | null;
  closeDate?: string | null;
  source: string;
  notes?: string | null;
  partnerId?: string | null;
  customerId?: string | null;
  pocProfileId?: string | null;
  rewardRatePercent?: number | null;
};

function resolveCreatePartnerId(actor: DealCommandActor, requested: string | null): string | null {
  const role = actor.assignment.roleKey;
  if (role === "partner_admin" || role === "partner_user" || role === "restricted_distributor") {
    // Partner-scoped roles can only ever create a deal in their own partner
    // tenant — a client-supplied partnerId is ignored rather than trusted,
    // matching the "no trusted role/partner/org supplied by the client" rule.
    return actor.assignment.partnerId ?? null;
  }
  return requested;
}

async function resolveOwnerName(tx: PoolClient, userId: string): Promise<string> {
  const { rows } = await tx.query(
    `SELECT full_name, company_name FROM profiles WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const row = rows[0] as { full_name: string | null; company_name: string | null } | undefined;
  return row?.full_name?.trim() || row?.company_name?.trim() || "Team Member";
}

function resolveRegionForCountry(country: string): string {
  const match = resolveCountryForText(country);
  if (!match) return "Unassigned";
  const region = SALES_REGIONS.find((candidate) => candidate.key === match.regionKey);
  return region?.name ?? "Unassigned";
}

export async function createDeal(input: {
  actor: DealCommandActor;
  data: CreateDealInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const data = input.data;

  const accountName = data.accountName.trim();
  const contactName = data.contactName.trim();
  const product = data.product.trim();
  const amount = data.amount.trim();
  const source = (data.source || "manual").trim();

  if (!accountName || !contactName || !product || !amount) {
    return {
      ok: false,
      failure: validationFailure(
        "Account, contact, product, and amount are required",
        "accountName",
      ),
      correlationId,
    };
  }

  return withTransaction(async (tx) => {
    const resolvedPartnerId = resolveCreatePartnerId(input.actor, data.partnerId ?? null);
    const country = data.country?.trim() || "India";
    const region = data.region?.trim() || resolveRegionForCountry(country);
    const currencyCode = (data.currencyCode?.trim() || "USD").toUpperCase();
    const amountValue = data.amountValue ?? parseDealAmount(amount);
    const amountUsd = currencyCode === "USD" ? amountValue : (data.amountUsd ?? null);
    const policy = authorizeDealActor(input.actor, {
      partner_id: resolvedPartnerId,
      country,
      region,
    });
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }
    const status = "draft"; // Replaces old autoApproved logic
    const commercial_approved = false;
    const stage: DealStage = "sourced";
    const ownerName = data.ownerName?.trim() || (await resolveOwnerName(tx, input.actor.userId));
    const closeDate = data.closeDate || data.possibleCloseDate || todayIsoDate();
    const quantity = data.quantity && data.quantity > 0 ? Math.floor(data.quantity) : 1;
    const rewardRatePercent = data.rewardRatePercent ?? 5;
    const dealId = randomUUID();

    await tx.query(
      `INSERT INTO portal_deals (
         id, account_name, contact_name, owner_name, country, region, product,
         stage, status, quantity, amount, currency_code, amount_value, amount_usd,
         fx_rate, fx_provider, customer_budget, probability, possible_close_date,
         close_date, source, last_touch, notes, is_hidden_to_team,
         reward_rate_percent, commercial_approved, is_seed, user_id, partner_id, customer_id,
         poc_profile_id, version
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
         $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,FALSE,$27,$28,$29,$30,1
       )`,
      [
        dealId,
        accountName,
        contactName,
        ownerName,
        country,
        region,
        product,
        stage,
        status,
        quantity,
        amount,
        currencyCode,
        amountValue,
        amountUsd,
        currencyCode === "USD" ? 1 : null,
        currencyCode === "USD" ? "internal" : null,
        data.customerBudget?.trim() || null,
        0,
        data.possibleCloseDate || null,
        closeDate,
        source,
        `Created via ${source}`.slice(0, 200),
        data.notes?.trim() || "",
        false,
        rewardRatePercent,
        commercial_approved,
        input.actor.userId,
        resolvedPartnerId,
        data.customerId ?? null,
        data.pocProfileId ?? null,
      ],
    );

    const creationPayload = {
      accountName,
      product,
      amount,
      currencyCode,
      amountUsd,
      source,
    };

    await tx.query(
      `INSERT INTO deal_transitions (
         deal_id, command_name, from_stage, to_stage, from_status, to_status,
         actor_user_id, assignment_id, reason, correlation_id
       ) VALUES ($1,$2,'(created)',$3,'(created)',$4,$5,$6,NULL,$7)`,
      [
        dealId,
        "deal.create",
        stage,
        status,
        input.actor.userId,
        input.actor.assignment.assignmentId,
        correlationId,
      ],
    );

    await tx.query(
      `INSERT INTO domain_activity_events (
         tenant_id, organization_tenant_id, subject_type, subject_id,
         actor_user_id, assignment_id, correlation_id, event_name, schema_version, payload
       ) VALUES ($1,$2,'deal',$3,$4,$5,$6,'deal.created',$7,$8)`,
      [
        input.actor.assignment.tenantId,
        input.actor.assignment.organizationTenantId,
        dealId,
        input.actor.userId,
        input.actor.assignment.assignmentId,
        correlationId,
        DEAL_EVENT_SCHEMA_VERSION,
        JSON.stringify(creationPayload),
      ],
    );

    await appendOutboxEnvelope(
      tx,
      createOutboxEnvelope({
        eventName: "deal.created",
        schemaVersion: DEAL_EVENT_SCHEMA_VERSION,
        aggregateType: "deal",
        aggregateId: dealId,
        tenantId: input.actor.assignment.tenantId,
        organizationTenantId: input.actor.assignment.organizationTenantId,
        actorUserId: input.actor.userId,
        assignmentId: input.actor.assignment.assignmentId,
        correlationId,
        idempotencyKey: null,
        publishAfter: null,
        payload: creationPayload,
      }),
    );

    return {
      ok: true,
      commandName: "deal.create",
      subjectId: dealId,
      newVersion: 1,
      nextAuthorisedActions: nextAuthorisedActions(stage),
      correlationId,
    };
  });
}

export type SubmitDealForRegistrationInput = {
  dealId: string;
};

export async function submitDealForRegistration(input: {
  actor: DealCommandActor;
  data: SubmitDealForRegistrationInput;
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

    if (deal.status !== "draft" && deal.status !== "submitted") {
      return { ok: false, failure: validationFailure("Deal has already been submitted for registration"), correlationId };
    }

    // Check pricing for $5,000 threshold
    let dtpToEvaluate = 0;
    const { rows: revRows } = await tx.query(
      `SELECT total_dtp_usd FROM pricing_revisions WHERE deal_id = $1 ORDER BY revision_number DESC LIMIT 1`,
      [input.data.dealId]
    );
    if (revRows.length > 0) {
      dtpToEvaluate = Number(revRows[0].total_dtp_usd);
    } else {
      // Fallback if no revision exists yet
      const { rows: amountRows } = await tx.query(`SELECT amount_usd, amount_value FROM portal_deals WHERE id = $1`, [input.data.dealId]);
      dtpToEvaluate = Number(amountRows[0].amount_usd ?? amountRows[0].amount_value ?? 0);
    }

    const autoApproved = !requiresSuperAdminApproval(dtpToEvaluate);
    
    // For autoApproved deals, we set commercial_approved = true and move to negotiation
    // if it hasn't reached it. If not autoApproved, we just set status = submitted.
    const newStatus = autoApproved ? "approved" : "submitted";
    const newCommercialApproved = autoApproved;
    const newStage = autoApproved ? "negotiation" : deal.stage;

    await tx.query(
      `UPDATE portal_deals SET status = $1, commercial_approved = $2, stage = $3, updated_at = now() WHERE id = $4`,
      [newStatus, newCommercialApproved, newStage, input.data.dealId]
    );

    await recordTransitionAndOutbox({
      tx,
      actor: input.actor,
      correlationId,
      commandName: "SubmitDealForRegistration",
      eventName: autoApproved ? "DealRegistrationAutoApproved" : "DealRegistrationSubmitted",
      deal,
      toStage: newStage as DealStage,
      toStatus: newStatus,
      reason: autoApproved ? "Auto-approved based on DTP threshold" : "Submitted for commercial review",
      payload: { dtp_evaluated: dtpToEvaluate },
    });

    return { ok: true, correlationId };
  });
}
