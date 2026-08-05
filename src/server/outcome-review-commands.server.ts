import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { type CommandExecutionResult } from "@/domain/contracts/commands";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { calculateDealRewardAllocations } from "@/lib/deal-collaboration";
import { withTransaction } from "@/server/command-runtime.server";
import {
  authorizeDealActor,
  loadDealForUpdate,
  validationFailure,
  type DealCommandActor,
} from "@/server/deal-commands.server";

/** product.md §15.1/§15.11: "Points are not created when Deal is merely
 * marked Won" — outcome_review_status reaching its approved terminal state
 * (this codebase's "approved", the closest existing state to the canonical
 * approved_won) is the only trigger, not the pipeline stage transition.
 * Runs inside the same transaction as the approval so award and approval
 * are atomic. Idempotent: a prior award for this deal short-circuits, so
 * approvePO can't double-award if ever re-invoked. Basis prefers the final
 * frozen Pricing Revision's DTP total over the free-text deal amount when
 * one exists (product.md's "final approved reward-eligible DTP total"). */
async function awardApprovedWinRewards(tx: PoolClient, dealId: string, approverId: string | null) {
  const { rows: existingRows } = await tx.query(
    `SELECT 1 FROM reward_point_events WHERE source_type = 'deal_win' AND source_id = $1 LIMIT 1`,
    [dealId],
  );
  if (existingRows.length > 0) return;

  const { rows: dealRows } = await tx.query(
    `SELECT account_name, product, amount, amount_usd, reward_rate_percent, partner_id, user_id
     FROM portal_deals WHERE id = $1`,
    [dealId],
  );
  const deal = dealRows[0] as
    | {
        account_name: string;
        product: string;
        amount: string;
        amount_usd: string | number | null;
        reward_rate_percent: string | number;
        partner_id: string | null;
        user_id: string;
      }
    | undefined;
  if (!deal) return;

  const { rows: revisionRows } = await tx.query(
    `SELECT total_dtp_usd FROM pricing_revisions
     WHERE deal_id = $1 AND is_final = TRUE
     ORDER BY revision_number DESC LIMIT 1`,
    [dealId],
  );
  const finalRevisionTotal = (revisionRows[0] as { total_dtp_usd: string | number } | undefined)
    ?.total_dtp_usd;

  const dealAmountBasis: string | number =
    finalRevisionTotal != null
      ? Number(finalRevisionTotal)
      : deal.amount_usd != null
        ? Number(deal.amount_usd)
        : deal.amount;

  const { rows: collaboratorRows } = await tx.query(
    `SELECT user_id, split_percent, sort_order FROM portal_deal_collaborators
     WHERE deal_id = $1 ORDER BY sort_order`,
    [dealId],
  );
  const collaborators = (
    collaboratorRows as Array<{
      user_id: string;
      split_percent: string | number;
      sort_order: number;
    }>
  ).map((row) => ({
    userId: row.user_id,
    splitPercent: Number(row.split_percent),
    sortOrder: Number(row.sort_order),
  }));

  const allocations = calculateDealRewardAllocations({
    dealId,
    dealAmount: dealAmountBasis,
    rewardRatePercent: Number(deal.reward_rate_percent) || 0,
    collaborators:
      collaborators.length > 0
        ? collaborators
        : [{ userId: deal.user_id, splitPercent: 100, sortOrder: 0 }],
  });

  const now = new Date().toISOString();
  for (const allocation of allocations) {
    await tx.query(
      `INSERT INTO reward_point_events (
         id, user_id, partner_id, source_type, source_id, points_delta, reason, approved_by, approved_at, is_seed, created_at
       ) VALUES ($1, $2, $3, 'deal_win', $4, $5, $6, $7, $8, FALSE, $8)`,
      [
        randomUUID(),
        allocation.userId,
        deal.partner_id,
        dealId,
        allocation.points,
        `${deal.account_name} closed won for ${deal.product}`,
        approverId,
        now,
      ],
    );
  }
}

export type SubmitPOInput = {
  dealId: string;
  poDocumentUrl: string;
  poNumber: string;
  poDate: string;
  poAmount: number;
  currencyCode: string;
};

export async function submitPO(input: {
  actor: DealCommandActor;
  data: SubmitPOInput;
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

    // §2.6/§9.15: markDealWon flips stage straight to "won" (matching the
    // spec's "Negotiation → Won with Submit Later" / "...with valid PO
    // Upload Now" transitions — Won itself is reachable immediately, with
    // or without a PO in hand). Previously this check only ever accepted
    // "negotiation", so the moment a deal was marked Won it could *never*
    // submit a PO again — permanently locking it out of outcome review and
    // the reward it's supposed to trigger. A deal can only reach "won" via
    // markDealWon's own terminal-stage guard, so accepting it here doesn't
    // open any new way to submit a PO on a deal that was never negotiated.
    if (deal.stage !== "negotiation" && deal.stage !== "won") {
      return {
        ok: false,
        failure: validationFailure("Can only submit PO when deal is in negotiation or won"),
        correlationId,
      };
    }

    if (!deal.commercial_approved) {
      return {
        ok: false,
        failure: validationFailure("Deal must be commercially approved first"),
        correlationId,
      };
    }

    await tx.query(
      `INSERT INTO deal_outcome_reviews (
         deal_id, status, po_document_url, po_number, po_date, po_amount, currency_code, actor_id
       ) VALUES ($1, 'requested', $2, $3, $4, $5, $6, $7)
       ON CONFLICT (deal_id) DO UPDATE SET 
         status = 'requested',
         po_document_url = EXCLUDED.po_document_url,
         po_number = EXCLUDED.po_number,
         po_date = EXCLUDED.po_date,
         po_amount = EXCLUDED.po_amount,
         currency_code = EXCLUDED.currency_code,
         actor_id = EXCLUDED.actor_id,
         updated_at = now(),
         version = deal_outcome_reviews.version + 1`,
      [
        input.data.dealId,
        input.data.poDocumentUrl,
        input.data.poNumber,
        input.data.poDate,
        input.data.poAmount,
        input.data.currencyCode,
        input.actor.userId,
      ],
    );

    return {
      ok: true,
      commandName: "deal.submitPO",
      subjectId: input.data.dealId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

export type ReviewOutcomeInput = {
  dealId: string;
  reason: string;
};

// §9.7/§9.15: "Tagged PAM/RM or Super Admin" may approve/request-changes/
// reject a claimed Won outcome. The full participant-tag model (§5.7/§9g —
// automatic PAM/KAM tagging on Testing→Qualified) isn't built yet, so a
// literal tag check would currently block every real PAM/RM outright; this
// is the same deliberate interim step already used for LIVEY-internal deal
// visibility elsewhere in this codebase (see isLiveyInternalRole in
// table-policy.server.ts) — authorizeDealActor's existing geography-ceiling/
// partner scoping stands in for "tagged" until that engine exists.
const PO_REVIEW_ROLES = new Set(["super_admin", "pam", "rm"]);

function authorizePoReviewer(actor: DealCommandActor): boolean {
  return PO_REVIEW_ROLES.has(actor.assignment.roleKey);
}

export async function approvePO(input: {
  actor: DealCommandActor;
  data: ReviewOutcomeInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  return withTransaction(async (tx) => {
    const deal = await loadDealForUpdate(tx, input.data.dealId);
    if (!deal) {
      return { ok: false, failure: validationFailure("Deal not found"), correlationId };
    }

    // §2.7: previously only ever accepted literal super_admin (so the
    // PAM/RM buttons the UI shows always failed) and never called
    // authorizeDealActor at all (so loosening the role check alone would
    // have let any pam/rm system-wide act on any deal, not just ones in
    // their own scope — the same vulnerability class already closed for
    // approveDiscount in pricing-commands.server.ts).
    const policy = await authorizeDealActor(input.actor, deal, tx);
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    if (!authorizePoReviewer(input.actor)) {
      return {
        ok: false,
        failure: validationFailure("Only a tagged PAM/RM or Super Admin can approve POs"),
        correlationId,
      };
    }

    await tx.query(
      `UPDATE deal_outcome_reviews SET status = 'approved', reason = $1, actor_id = $2, updated_at = now()
       WHERE deal_id = $3`,
      [input.data.reason, input.actor.userId, input.data.dealId],
    );

    await tx.query(`UPDATE portal_deals SET stage = 'won', updated_at = now() WHERE id = $1`, [
      input.data.dealId,
    ]);

    await awardApprovedWinRewards(tx, input.data.dealId, input.actor.userId);

    return {
      ok: true,
      commandName: "deal.approvePO",
      subjectId: input.data.dealId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

export async function requestChanges(input: {
  actor: DealCommandActor;
  data: ReviewOutcomeInput;
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

    if (!authorizePoReviewer(input.actor)) {
      return {
        ok: false,
        failure: validationFailure("Only a tagged PAM/RM or Super Admin can request changes to PO"),
        correlationId,
      };
    }

    await tx.query(
      `UPDATE deal_outcome_reviews SET status = 'received', reason = $1, actor_id = $2, updated_at = now()
       WHERE deal_id = $3`,
      [input.data.reason, input.actor.userId, input.data.dealId],
    );

    return {
      ok: true,
      commandName: "deal.requestChanges",
      subjectId: input.data.dealId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

export async function rejectOutcome(input: {
  actor: DealCommandActor;
  data: ReviewOutcomeInput;
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

    if (!authorizePoReviewer(input.actor)) {
      return {
        ok: false,
        failure: validationFailure("Only a tagged PAM/RM or Super Admin can reject POs"),
        correlationId,
      };
    }

    await tx.query(
      `UPDATE deal_outcome_reviews SET status = 'rejected', reason = $1, actor_id = $2, updated_at = now()
       WHERE deal_id = $3`,
      [input.data.reason, input.actor.userId, input.data.dealId],
    );

    await tx.query(`UPDATE portal_deals SET stage = 'lost', updated_at = now() WHERE id = $1`, [
      input.data.dealId,
    ]);

    return {
      ok: true,
      commandName: "deal.rejectOutcome",
      subjectId: input.data.dealId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}
