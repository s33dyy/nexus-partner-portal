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
import { toCalendarDate } from "@/domain/contracts/reminders";
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

/**
 * The stage a reopened Won/Lost deal returns to.
 *
 * product.md names Negotiation twice as the destination — "PO Pending → Not
 * Applicable | Tagged participant moves Deal backward to Negotiation with
 * reason" and the same for "Rejected Outcome". Reopening straight to an
 * earlier stage would discard the qualified/proposal/negotiation history the
 * §9.10 dialog is supposed to reason about.
 */
const REOPEN_STAGE: DealStage = "negotiation";

function isBackwardMove(from: DealStage, to: DealStage): boolean {
  // Nothing may move INTO a terminal stage backwards — Won and Lost are only
  // ever reached through their own named commands, which carry the outcome
  // date, PO choice and loss reason §9.15 requires.
  if (TERMINAL_STAGES.has(to)) return false;
  // Out of a terminal stage, Negotiation is the only permitted destination.
  // This is deliberately narrower than "any earlier stage": the index test
  // below would happily pass won→sourced and lost→demo, so relaxing the old
  // blanket terminal check by deletion would have legalised all of them.
  if (TERMINAL_STAGES.has(from)) return to === REOPEN_STAGE;
  const fromIndex = DEAL_STAGE_ORDER.indexOf(from);
  const toIndex = DEAL_STAGE_ORDER.indexOf(to);
  return fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex;
}

/**
 * Whether a closed deal has been paid out, and so can no longer be reopened.
 *
 * product.md: "Approved Won is terminal for ordinary users. A Super Admin
 * correction requires strong re-authentication, reason, financial/provider
 * impact preview, compensating reward/accounting events, and a new review
 * revision." None of that machinery exists here — `adjustRewardPoints`
 * refuses any delta that would drive a balance negative, so the compensating
 * debit is rejected in exactly the case that matters (the points were already
 * spent). Until that path is built, a paid win is immovable for EVERY role,
 * super admin included: refusing is recoverable, a stranded ledger is not.
 *
 * Two independent clauses because they can disagree. The review status is the
 * spec's own condition; the ledger probe is the real invariant, and it still
 * holds if a `deal_win` row was written by a seed script or the review row was
 * mutated out from under it. `source_type = 'deal_win'` is the same key
 * awardApprovedWinRewards uses for its own idempotency check.
 */
async function reopenBlockedReason(tx: PoolClient, dealId: string): Promise<string | null> {
  const { rows } = await tx.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM deal_outcome_reviews WHERE deal_id = $1 AND status = 'approved'
       ) AS review_approved,
       EXISTS (
         SELECT 1 FROM reward_point_events WHERE source_type = 'deal_win' AND source_id = $1
       ) AS rewards_awarded`,
    [dealId],
  );
  const row = rows[0] as { review_approved: boolean; rewards_awarded: boolean } | undefined;
  if (row?.rewards_awarded) {
    return "This deal's win has already released reward points. Reopening it would strand that award, so it needs a Super Admin correction with compensating reward events.";
  }
  if (row?.review_approved) {
    return "This deal's outcome review is already approved. Approved Won is final for ordinary users and needs a Super Admin correction.";
  }
  return null;
}

export type DealCommandActor = GovernedActor;
export type ResolveDealCommandActorInput = ResolveGovernedActorInput;
export const resolveDealCommandActor = resolveGovernedActor;

export type DealSnapshot = {
  id: string;
  stage: DealStage;
  status: string;
  partner_id: string | null;
  customer_id: string | null;
  country: string | null;
  region: string | null;
  version: number;
  account_name: string;
  commercial_approved: boolean;
  proposed_completion_date: string | null;
};

/** §8.7/§8.8: "Distributor assignment grants no record visibility until a
 * Customer or Deal tag exists" — a Distributor must be an active tagged
 * participant on this specific deal, not merely a member of the owning
 * partner's tenant. Checked here (not just in table-policy.server.ts's read
 * scope) so the write-side commands below can't be reached by guessing a
 * dealId that belongs to the Distributor's own partner but was never tagged
 * to them. */
async function isActiveDealParticipant(
  tx: Pick<PoolClient, "query">,
  dealId: string,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  const { rows } = await tx.query(
    `SELECT 1 FROM deal_participants
     WHERE deal_id = $1 AND participant_user_id = $2 AND valid_to IS NULL
     LIMIT 1`,
    [dealId, userId],
  );
  return rows.length > 0;
}

export async function authorizeDealActor(
  actor: DealCommandActor,
  deal: Pick<DealSnapshot, "partner_id" | "country" | "region"> & { id?: string },
  tx: Pick<PoolClient, "query">,
): Promise<PolicyDecision> {
  const basePolicy = evaluateActiveContextPolicy({
    roles: [actor.assignment.roleKey],
    assignment: actor.assignment,
    activeContext: actor.activeContext,
  });
  if (!basePolicy.allowed) return basePolicy;

  if (actor.assignment.roleKey === "super_admin") {
    return { allowed: true, reason: null };
  }

  if (actor.assignment.roleKey === "restricted_distributor") {
    if (!actor.assignment.partnerId || actor.assignment.partnerId !== deal.partner_id) {
      return {
        allowed: false,
        reason: "Deal is outside the assignment's partner scope",
        denial: makePolicyDenial(null, "Deal is outside the assignment's partner scope"),
      };
    }
    // A brand-new deal (createDeal, no `id` yet) has nothing to tag yet —
    // the tag check only applies to actions on an already-existing deal.
    if (deal.id && !(await isActiveDealParticipant(tx, deal.id, actor.userId))) {
      return {
        allowed: false,
        reason: "Deal is not tagged to this Distributor assignment",
        denial: makePolicyDenial(null, "Deal is not tagged to this Distributor assignment"),
      };
    }
    return { allowed: true, reason: null };
  }

  if (actor.assignment.roleKey === "partner_admin" || actor.assignment.roleKey === "partner_user") {
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
      denial: makePolicyDenial(null, "Deal geography could not be resolved for this assignment"),
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

export async function loadDealForUpdate(
  tx: PoolClient,
  dealId: string,
): Promise<DealSnapshot | null> {
  const { rows } = await tx.query(
    `SELECT id, stage, status, partner_id, customer_id, version, account_name
            , country, region, commercial_approved, proposed_completion_date
     FROM portal_deals WHERE id = $1 FOR UPDATE`,
    [dealId],
  );
  const row = rows[0] as
    | {
        id: string;
        stage: string;
        status: string;
        partner_id: string | null;
        customer_id: string | null;
        country: string | null;
        region: string | null;
        version: number;
        account_name: string;
        commercial_approved: boolean;
        proposed_completion_date: Date | string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    stage: row.stage as DealStage,
    status: row.status,
    partner_id: row.partner_id,
    customer_id: row.customer_id ?? null,
    country: row.country ?? null,
    region: row.region ?? null,
    version: Number(row.version),
    account_name: row.account_name,
    commercial_approved: row.commercial_approved,
    proposed_completion_date: toCalendarDate(row.proposed_completion_date),
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
  // Async (not just sync-returning) so a transition's own resolveTarget can
  // run further DB checks inside the same transaction before deciding the
  // target — see moveDealStageForward's Testing->Qualified handoff check
  // below, which resolves PAM/KAM coverage and can write a
  // coverage_exceptions row before blocking.
  resolveTarget: (
    deal: DealSnapshot,
    tx: PoolClient,
  ) => Promise<{ toStage: DealStage; toStatus: string } | CommandFailureContract>;
  extraSet?: (deal: DealSnapshot, toStage: DealStage) => { sql: string; values: unknown[] };
  extraPayload?: Record<string, unknown>;
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

    const policy = await authorizeDealActor(input.actor, deal, tx);
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

    const target = await input.resolveTarget(deal, tx);
    if ("code" in target) {
      return { ok: false, failure: target, correlationId };
    }

    const newVersion = deal.version + 1;
    const extra = input.extraSet?.(deal, target.toStage);
    // An empty `sql` means "no extra columns for this deal" — a caller whose
    // write-set is conditional (moveDealStageBackward's reopen path) needs a
    // way to say that without emitting a dangling comma into the UPDATE.
    const extraSql = extra?.sql ? `, ${extra.sql}` : "";
    const extraValues = extra?.sql ? extra.values : [];

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
        ...input.extraPayload,
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
  // A closed deal can still be reopened by a reasoned backward move. This
  // takes only a stage, so it advertises the move even on an approved Won that
  // moveDealStageBackward will refuse — safe, because the command is the
  // authority, but worth stating so it doesn't read as a bug.
  if (TERMINAL_STAGES.has(stage)) return ["deal.move_stage_backward"];
  const actions = ["deal.move_stage_backward", "deal.mark_lost"];
  if (FORWARD_NEXT_STAGE[stage]) actions.unshift("deal.move_stage_forward");
  if (stage === "negotiation") actions.push("deal.mark_won");
  return actions;
}

/** §9.11 rule 3/§9g: "PAM assigned to the Partner." The assignment engine's
 * only existing partner-scoped column is `assignments.partner_id` — already
 * the exact mechanism partner_admin/partner_user/restricted_distributor use
 * to mean "this assignment belongs to this partner tenant." Reusing it here
 * (a `pam`-role assignment scoped to this deal's partner) rather than
 * inventing a new coverage-mapping table. No admin surface currently sets a
 * PAM assignment's partner_id, so this resolves to nothing on every real
 * environment today — which is the honest, correct input for rule 6 below. */
async function resolvePamForPartner(tx: PoolClient, partnerId: string): Promise<string | null> {
  const { rows } = await tx.query(
    `SELECT user_id FROM assignments
     WHERE role_key = 'pam' AND partner_id = $1 AND status = 'active'
     ORDER BY created_at ASC LIMIT 1`,
    [partnerId],
  );
  return (rows[0] as { user_id: string } | undefined)?.user_id ?? null;
}

/** §9.11 rule 4/§9g: "KAM assigned to the Customer." Unlike PAM/Partner,
 * `assignments` has no customer-scoped column at all — `customer_participants`
 * is this codebase's one existing mechanism for "a specific user holds a
 * named role against a specific Customer" (already used identically for
 * Distributor-to-Customer tagging, §8.7), so an active KAM tag on the
 * Customer record itself is reused as the "KAM assigned to Customer"
 * mapping rather than inventing a second one. */
async function resolveKamForCustomer(tx: PoolClient, customerId: string): Promise<string | null> {
  const { rows } = await tx.query(
    `SELECT participant_user_id FROM customer_participants
     WHERE customer_id = $1 AND lower(participant_type) = 'kam'
       AND valid_to IS NULL AND participant_user_id IS NOT NULL
     ORDER BY created_at ASC LIMIT 1`,
    [customerId],
  );
  return (rows[0] as { participant_user_id: string } | undefined)?.participant_user_id ?? null;
}

async function hasActiveParticipant(
  tx: PoolClient,
  dealId: string,
  participantType: string,
): Promise<boolean> {
  const { rows } = await tx.query(
    `SELECT 1 FROM deal_participants
     WHERE deal_id = $1 AND lower(participant_type) = lower($2) AND valid_to IS NULL
     LIMIT 1`,
    [dealId, participantType],
  );
  return rows.length > 0;
}

async function addAutomaticParticipant(
  tx: PoolClient,
  input: {
    dealId: string;
    partnerId: string | null;
    participantType: string;
    userId: string;
    reason: string;
  },
): Promise<void> {
  if (await hasActiveParticipant(tx, input.dealId, input.participantType)) return;
  await tx.query(
    `INSERT INTO deal_participants (
       id, deal_id, partner_id, participant_type, source, actor_id, participant_user_id, reason
     ) VALUES ($1, $2, $3, $4, 'automatic', $5, $5, $6)`,
    [
      randomUUID(),
      input.dealId,
      input.partnerId,
      input.participantType,
      input.userId,
      input.reason,
    ],
  );
}

async function openCoverageException(
  tx: PoolClient,
  input: { dealId: string; requiredRole: "pam" | "kam"; coverageKey: string | null },
): Promise<void> {
  await tx.query(
    `INSERT INTO coverage_exceptions (
       id, required_role, coverage_key, deal_id, action, status, responsible_role
     ) VALUES ($1, $2, $3, $4, 'deal.testing_to_qualified', 'open', 'super_admin')`,
    [randomUUID(), input.requiredRole, input.coverageKey ?? "", input.dealId],
  );
}

/** §9.11: "On the successful forward transition Testing -> Qualified, the
 * engine must add the effective PAM for the Partner and KAM for the
 * Customer in the same transaction... Missing PAM or KAM coverage always
 * blocks Testing -> Qualified; it creates a Coverage Exception rather than
 * a partially tagged Deal." Runs inside moveDealStageForward's own
 * transaction (via resolveTarget's new tx parameter) so the participant
 * adds and the stage move commit or fail together. Both PAM and KAM are
 * resolved (read-only) FIRST, before either is written — writing one the
 * moment it resolves would tag the deal with e.g. a KAM while PAM is still
 * missing, exactly the "partially tagged Deal" the spec says a Coverage
 * Exception exists to prevent instead of. RM/ISR are deliberately
 * untouched here ("remain tagged"): this only adds PAM/KAM. */
async function resolveTestingToQualifiedHandoff(
  tx: PoolClient,
  deal: DealSnapshot,
): Promise<CommandFailureContract | null> {
  const pamUserId = deal.partner_id ? await resolvePamForPartner(tx, deal.partner_id) : null;
  const kamUserId = deal.customer_id ? await resolveKamForCustomer(tx, deal.customer_id) : null;

  const missing: Array<{ role: "pam" | "kam"; coverageKey: string | null }> = [];
  if (!pamUserId || !deal.partner_id) missing.push({ role: "pam", coverageKey: deal.partner_id });
  if (!kamUserId || !deal.customer_id) missing.push({ role: "kam", coverageKey: deal.customer_id });

  if (missing.length > 0) {
    for (const entry of missing) {
      await openCoverageException(tx, {
        dealId: deal.id,
        requiredRole: entry.role,
        coverageKey: entry.coverageKey,
      });
    }
    const missingLabel = missing.map((entry) => entry.role.toUpperCase()).join(" and ");
    return validationFailure(
      `Testing → Qualified is blocked: no ${missingLabel} coverage could be resolved for this deal. A Coverage Exception has been opened for Super Admin Assignment Operations.`,
    );
  }

  // Both resolved — safe to write both now, atomically, before returning.
  await addAutomaticParticipant(tx, {
    dealId: deal.id,
    partnerId: deal.partner_id,
    participantType: "PAM",
    userId: pamUserId as string,
    reason: "Post-Testing handoff (automatic)",
  });
  await addAutomaticParticipant(tx, {
    dealId: deal.id,
    partnerId: deal.partner_id,
    participantType: "KAM",
    userId: kamUserId as string,
    reason: "Post-Testing handoff (automatic)",
  });
  return null;
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
    resolveTarget: async (deal, tx) => {
      // §2.5/§9.8/§9.9: "Forward movement is available only on approved or
      // auto-approved active Deals" — every stage row in §9.8's table lists
      // "Approved/auto-approved registration" as a minimum forward
      // requirement starting at Sourced, so this applies to every forward
      // move, not just entry into Negotiation. Previously unchecked here, a
      // deal that had never even been submitted for registration could be
      // forward-clicked all the way to Negotiation.
      if (!deal.commercial_approved) {
        return validationFailure("Deal must complete registration approval before moving forward");
      }
      const toStage = FORWARD_NEXT_STAGE[deal.stage];
      if (!toStage) {
        return validationFailure(`Deal cannot move forward from stage "${deal.stage}"`);
      }
      if (deal.stage === "testing" && toStage === "qualified") {
        const blocked = await resolveTestingToQualifiedHandoff(tx, deal);
        if (blocked) return blocked;
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
    resolveTarget: async (deal, tx) => {
      if (!isBackwardMove(deal.stage, input.toStage)) {
        return validationFailure(
          `"${input.toStage}" is not a valid backward stage from "${deal.stage}"`,
        );
      }

      if (!TERMINAL_STAGES.has(deal.stage)) {
        return { toStage: input.toStage, toStatus: deal.status };
      }

      // Reopening a closed deal — product.md's "Lost can be reopened only
      // through a reasoned, authorised backward movement" and the PO review
      // table's two "-> Not Applicable" rows.
      const blocked = await reopenBlockedReason(tx, deal.id);
      if (blocked) return validationFailure(blocked);

      // The outcome review returns to Not Applicable, which is what those two
      // PO-table rows describe. 'approved' can never match here — the guard
      // above already refused it — and 'not_applicable' is a no-op, so this is
      // idempotent.
      await tx.query(
        `UPDATE deal_outcome_reviews
         SET status = 'not_applicable', reason = $2, version = version + 1, updated_at = now()
         WHERE deal_id = $1 AND status IN ('requested', 'received', 'rejected')`,
        [deal.id, reason.slice(0, 500)],
      );

      // Registration status, not outcome status: a reopened deal is open
      // again, so leaving status = 'won'/'lost' would leave every
      // status-filtered view still counting it as closed.
      return {
        toStage: input.toStage,
        toStatus: deal.commercial_approved ? "approved" : "submitted",
      };
    },
    extraSet: (deal) => {
      if (!TERMINAL_STAGES.has(deal.stage)) return { sql: "", values: [] };
      // markDealWon set probability to 100 and markDealLost to 0 — both mean
      // "decided". A deal back in Negotiation is neither, so it returns to the
      // middle option the app actually offers ("50% - Likely",
      // DEAL_PROBABILITY_OPTIONS). po_choice is cleared because the PO
      // decision it recorded belongs to a win that no longer exists.
      return { sql: "probability = $6, po_choice = NULL", values: [50] };
    },
  });
}

// §9b/§9.15: "Ordinary Lost requires a loss reason." Previously `reason` was
// optional and silently defaulted to null — a deal could be closed lost with
// no record of why. Now mandatory, validated the same way
// moveDealStageBackward already validates its own required reason (trim,
// reject blank) before the transaction even opens.
export async function markDealLost(input: {
  actor: DealCommandActor;
  dealId: string;
  expectedVersion: number;
  reason: string;
}): Promise<CommandExecutionResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return {
      ok: false,
      failure: validationFailure("A reason is required to mark a deal lost", "reason"),
      correlationId: createCorrelationId(),
    };
  }

  return runDealTransitionCommand({
    actor: input.actor,
    dealId: input.dealId,
    expectedVersion: input.expectedVersion,
    commandName: "deal.mark_lost",
    eventName: "deal.lost",
    reason,
    resolveTarget: async (deal) => {
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

export type DealWonPoChoice = "now" | "later";

// §9b/§9.15: "Selecting Won requires an outcome date, a PO
// Upload-Now-or-Submit-Later choice... before the deal can leave
// Negotiation." Full re-implementation of the confirmed-lines/DTP/
// contributor-split capture the same spec paragraph also requires is a
// separate, much larger piece of work (needs deal_line_items to be
// populated at all first — see 9f/18d) and is deliberately not attempted
// here. This adds the two inputs that fit this command's existing shape:
// `outcomeDate` overrides the close date that was previously always hardcoded
// to today; `poChoice` is recorded on the deal so the outcome-review UI/PO
// flow can show which path the closer intended (Upload Now vs Submit Later),
// even though the command doesn't yet branch behavior on it.
export async function markDealWon(input: {
  actor: DealCommandActor;
  dealId: string;
  expectedVersion: number;
  reason?: string | null;
  outcomeDate?: string | null;
  poChoice?: DealWonPoChoice | null;
}): Promise<CommandExecutionResult> {
  const outcomeDate = input.outcomeDate?.trim() || todayIsoDate();
  const poChoice = input.poChoice === "now" || input.poChoice === "later" ? input.poChoice : null;

  return runDealTransitionCommand({
    actor: input.actor,
    dealId: input.dealId,
    expectedVersion: input.expectedVersion,
    commandName: "deal.mark_won",
    eventName: "deal.won",
    reason: input.reason ?? null,
    resolveTarget: async (deal) => {
      if (TERMINAL_STAGES.has(deal.stage)) {
        return validationFailure(`Deal is already closed as "${deal.stage}"`);
      }
      // §9.15: "Selecting Won requires ... fulfilled stage requirements", and
      // nextAuthorisedActions has always advertised deal.mark_won only from
      // negotiation. The command itself did not enforce that, so a deal could
      // be closed Won straight out of `sourced` — skipping every qualification
      // gate, including the Testing→Qualified budget check and the §9.11
      // PAM/KAM handoff — and then become reward-eligible at PO approval.
      if (deal.stage !== "negotiation") {
        return validationFailure(
          `A deal can only be marked won from negotiation (this one is at "${deal.stage}")`,
        );
      }
      return { toStage: "won", toStatus: "won" };
    },
    extraSet: () => ({
      sql: "probability = $6, close_date = $7, po_choice = $8",
      values: [100, outcomeDate, poChoice],
    }),
    extraPayload: { outcomeDate, poChoice },
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
  // The owner's forecast of when this deal actually completes. Distinct from
  // closeDate (the committed close) and possibleCloseDate (the probable
  // close used for pipeline weighting) — this is the one reminders fire off.
  proposedCompletionDate?: string | null;
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
    const policy = await authorizeDealActor(
      input.actor,
      {
        partner_id: resolvedPartnerId,
        country,
        region,
      },
      tx,
    );
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
         proposed_completion_date, close_date, source, last_touch, notes, is_hidden_to_team,
         reward_rate_percent, commercial_approved, is_seed, user_id, partner_id, customer_id,
         poc_profile_id, version
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
         $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,FALSE,$28,$29,$30,$31,1
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
        toCalendarDate(data.proposedCompletionDate ?? null),
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

    // §9.3 Section 4/§9g: "assigned RM, automatic; ISR, automatic or
    // routed." The only context this command has to determine either
    // without a real routing/region-assignment engine (which doesn't exist
    // in this codebase yet) is the creating actor's own role — when an rm
    // or isr creates a deal, they are automatically tagged as that
    // participant on it. A deal created by any other role (partner_admin,
    // pam, super_admin, ...) gets no automatic RM/ISR tag from this step;
    // "RM tagged on all deals in the RM's effective regional scope" and
    // ISR routing both require a real assignment-resolution engine this
    // codebase doesn't have — not attempted here.
    if (input.actor.assignment.roleKey === "rm" || input.actor.assignment.roleKey === "isr") {
      await addAutomaticParticipant(tx, {
        dealId,
        partnerId: resolvedPartnerId,
        participantType: input.actor.assignment.roleKey === "rm" ? "RM" : "ISR",
        userId: input.actor.userId,
        reason: "Deal creator (automatic)",
      });
    }

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
    const policy = await authorizeDealActor(input.actor, deal, tx);
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    if (deal.status !== "draft" && deal.status !== "submitted") {
      return {
        ok: false,
        failure: validationFailure("Deal has already been submitted for registration"),
        correlationId,
      };
    }

    // Check pricing for $5,000 threshold
    let dtpToEvaluate = 0;
    const { rows: revRows } = await tx.query(
      `SELECT total_dtp_usd FROM pricing_revisions WHERE deal_id = $1 ORDER BY revision_number DESC LIMIT 1`,
      [input.data.dealId],
    );
    if (revRows.length > 0) {
      dtpToEvaluate = Number(revRows[0].total_dtp_usd);
    } else {
      // Fallback if no revision exists yet
      const { rows: amountRows } = await tx.query(
        `SELECT amount_usd, amount_value FROM portal_deals WHERE id = $1`,
        [input.data.dealId],
      );
      dtpToEvaluate = Number(amountRows[0].amount_usd ?? amountRows[0].amount_value ?? 0);
    }

    const autoApproved = !requiresSuperAdminApproval(dtpToEvaluate);

    // §2.5/§9.1/§9.7/§9.9: registration status and pipeline stage are
    // independent dimensions — approving (auto or manual) records a
    // decision and unblocks forward movement (see moveDealStageForward's
    // commercial_approved gate), it never itself advances `stage`. A deal
    // stays exactly where the submitter left it; the *next* explicit
    // "move forward" click is what progresses the pipeline, now that it's
    // no longer blocked.
    const newStatus = autoApproved ? "approved" : "submitted";
    const newCommercialApproved = autoApproved;

    await tx.query(
      `UPDATE portal_deals SET status = $1, commercial_approved = $2, updated_at = now() WHERE id = $3`,
      [newStatus, newCommercialApproved, input.data.dealId],
    );

    await recordTransitionAndOutbox({
      tx,
      actor: input.actor,
      correlationId,
      commandName: "SubmitDealForRegistration",
      eventName: autoApproved ? "DealRegistrationAutoApproved" : "DealRegistrationSubmitted",
      deal,
      toStage: deal.stage,
      toStatus: newStatus,
      reason: autoApproved
        ? "Auto-approved based on DTP threshold"
        : "Submitted for commercial review",
      payload: { dtp_evaluated: dtpToEvaluate },
    });

    return {
      ok: true,
      commandName: "deal.submitRegistration",
      subjectId: deal.id,
      newVersion: deal.version + 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

export type DealRegistrationDecision = "approved" | "need_more_info" | "rejected";

export type ReviewDealRegistrationInput = {
  dealId: string;
  decision: DealRegistrationDecision;
  reason?: string | null;
};

const REGISTRATION_DECISION_EVENT_NAME: Record<DealRegistrationDecision, string> = {
  approved: "DealRegistrationApproved",
  rejected: "DealRegistrationRejected",
  need_more_info: "DealRegistrationChangesRequested",
};

const REGISTRATION_STATUSES_FOR_DECISION = new Set<DealRegistrationDecision>([
  "approved",
  "need_more_info",
  "rejected",
]);

// §2.5 path 2 (§9.1/§9.2/§9.7/§9.9): admin.deals.tsx's Approve/Request
// changes/Reject buttons previously called a raw client-side
// `supabase.from("portal_deals").update(...)` that set `stage` directly on
// Approve (bypassing authorizeDealActor, optimistic concurrency, and the
// deal_transitions/domain_activity_events/outbox audit trail entirely) — the
// exact same registration/stage collapse this session already fixed in
// submitDealForRegistration and moveDealStageForward (paths 1 and 3 of the
// same finding). This command is the third and last piece: it records the
// registration decision (status/commercial_approved) and NEVER writes
// `stage`, matching the invariant those two fixes already established.
export async function reviewDealRegistration(input: {
  actor: DealCommandActor;
  expectedVersion: number;
  data: ReviewDealRegistrationInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  return withTransaction(async (tx) => {
    const deal = await loadDealForUpdate(tx, input.data.dealId);
    if (!deal) {
      return { ok: false, failure: validationFailure("Deal not found"), correlationId };
    }

    const policy = await authorizeDealActor(input.actor, deal, tx);
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    // admin.deals.tsx has always gated this entire surface to super_admin
    // only (its own `hasRole("super_admin")` guard at the top of the route)
    // — this command preserves that exact ceiling rather than widening it.
    // Unlike §2.7's PO/outcome-review authority (tagged PAM/RM or Super
    // Admin), §9.7's registration-review authority was never extended past
    // Super Admin in the shipped product, so there is no existing UI grant
    // to match beyond it.
    if (input.actor.assignment.roleKey !== "super_admin") {
      return {
        ok: false,
        failure: validationFailure("Only Super Admin can review deal registration"),
        correlationId,
      };
    }

    if (deal.version !== input.expectedVersion) {
      return {
        ok: false,
        failure: makeConcurrencyError(deal.id, input.expectedVersion, deal.version),
        correlationId,
      };
    }

    const decision = input.data.decision;
    if (!REGISTRATION_STATUSES_FOR_DECISION.has(decision)) {
      return {
        ok: false,
        failure: validationFailure("Unrecognised registration decision", "decision"),
        correlationId,
      };
    }

    const newStatus = decision;
    const newCommercialApproved = decision === "approved" ? true : deal.commercial_approved;
    const newVersion = deal.version + 1;
    const reason = input.data.reason?.trim() || null;

    await tx.query(
      `UPDATE portal_deals
       SET status = $1, commercial_approved = $2, version = $3, updated_at = now()
       WHERE id = $4`,
      [newStatus, newCommercialApproved, newVersion, deal.id],
    );

    await recordTransitionAndOutbox({
      tx,
      actor: input.actor,
      correlationId,
      commandName: "deal.reviewRegistration",
      eventName: REGISTRATION_DECISION_EVENT_NAME[decision],
      deal,
      // Deliberately the deal's own current stage, unchanged — a
      // registration decision records status only, it never itself moves
      // the pipeline (§9.1/§9.2's "these are independent dimensions").
      toStage: deal.stage,
      toStatus: newStatus,
      reason,
      payload: { decision, reason },
    });

    return {
      ok: true,
      commandName: "deal.reviewRegistration",
      subjectId: deal.id,
      newVersion,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

// Same rationale as setTaskProposedCompletion: the proposed completion date
// is a promise the reminder sweep acts on, so every change to it lands
// through a named command with lock/version/policy/evidence rather than a
// generic column write.
export async function setDealProposedCompletion(input: {
  actor: DealCommandActor;
  dealId: string;
  expectedVersion: number;
  proposedCompletionDate: string | null;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const reason = input.reason?.trim() || null;

  let normalized: string | null = null;
  if (input.proposedCompletionDate) {
    normalized = toCalendarDate(input.proposedCompletionDate);
    if (!normalized) {
      return {
        ok: false,
        failure: validationFailure(
          "Enter a valid proposed completion date",
          "proposedCompletionDate",
        ),
        correlationId,
      };
    }
  }

  return withTransaction(async (tx) => {
    const deal = await loadDealForUpdate(tx, input.dealId);
    if (!deal) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Deal is not accessible"),
        correlationId,
      };
    }

    const policy = await authorizeDealActor(input.actor, deal, tx);
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

    if (deal.stage === "won" || deal.stage === "lost") {
      return {
        ok: false,
        failure: validationFailure(
          `A ${deal.stage} deal has no proposed completion date to set`,
          "proposedCompletionDate",
        ),
        correlationId,
      };
    }

    const newVersion = deal.version + 1;
    await tx.query(
      `UPDATE portal_deals
       SET proposed_completion_date = $2, version = $3, updated_at = now()
       WHERE id = $1`,
      [deal.id, normalized, newVersion],
    );

    await recordTransitionAndOutbox({
      tx,
      actor: input.actor,
      correlationId,
      commandName: "deal.set_proposed_completion",
      eventName: "deal.proposed_completion_changed",
      deal,
      // Stage and status are genuinely unchanged; deal_transitions is the
      // Deal's evidence log, so the row carries the same stage/status on
      // both sides and is distinguished by command_name.
      toStage: deal.stage,
      toStatus: deal.status,
      reason,
      payload: {
        fromProposedCompletionDate: deal.proposed_completion_date,
        toProposedCompletionDate: normalized,
        reason,
      },
    });

    return {
      ok: true,
      commandName: "deal.set_proposed_completion",
      subjectId: deal.id,
      newVersion,
      nextAuthorisedActions: nextAuthorisedActions(deal.stage),
      correlationId,
    };
  });
}
