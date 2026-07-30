import { randomUUID } from "node:crypto";
import { type CommandExecutionResult } from "@/domain/contracts/commands";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { withTransaction } from "@/server/command-runtime.server";
import {
  authorizeDealActor,
  loadDealForUpdate,
  validationFailure,
  type DealCommandActor,
} from "@/server/deal-commands.server";

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

    const policy = authorizeDealActor(input.actor, deal);
    if (!policy.allowed) {
      return { ok: false, failure: policy.denial, correlationId };
    }

    if (deal.stage !== "negotiation") {
      return {
        ok: false,
        failure: validationFailure("Can only submit PO when deal is in negotiation"),
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

    // Only super_admin or designated reviewer can approve POs
    if (input.actor.assignment.roleKey !== "super_admin") {
      return {
        ok: false,
        failure: validationFailure("Only super_admin can approve POs"),
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

    if (input.actor.assignment.roleKey !== "super_admin") {
      return {
        ok: false,
        failure: validationFailure("Only super_admin can request changes to PO"),
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

    if (input.actor.assignment.roleKey !== "super_admin") {
      return {
        ok: false,
        failure: validationFailure("Only super_admin can reject POs"),
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
