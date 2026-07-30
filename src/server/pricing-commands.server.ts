import { randomUUID } from "node:crypto";
import { makePolicyDenial, type CommandExecutionResult } from "@/domain/contracts/commands";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { appendOutboxEnvelope, withTransaction } from "@/server/command-runtime.server";
import {
  authorizeDealActor,
  loadDealForUpdate,
  validationFailure,
  type DealCommandActor,
} from "@/server/deal-commands.server";

export type AddDealLineItemInput = {
  dealId: string;
  productId: string;
  quantity: number;
  msrpUsd: number;
  ptpUsd: number;
  discountPct: number;
  dtpUsd: number;
  proposedSellingPriceUsd: number;
  rewardEligible: boolean;
};

export async function addDealLineItem(input: {
  actor: DealCommandActor;
  data: AddDealLineItemInput;
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

    if (
      deal.stage !== "sourced" &&
      deal.stage !== "demo" &&
      deal.stage !== "testing" &&
      deal.stage !== "qualified" &&
      deal.stage !== "proposal"
    ) {
      return {
        ok: false,
        failure: validationFailure("Cannot modify line items at this stage"),
        correlationId,
      };
    }

    const lineItemId = randomUUID();
    await tx.query(
      `INSERT INTO deal_line_items (
         id, deal_id, product_id, quantity, msrp_usd, ptp_usd, discount_pct, dtp_usd,
         proposed_selling_price_usd, reward_eligible
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        lineItemId,
        input.data.dealId,
        input.data.productId,
        input.data.quantity,
        input.data.msrpUsd,
        input.data.ptpUsd,
        input.data.discountPct,
        input.data.dtpUsd,
        input.data.proposedSellingPriceUsd,
        input.data.rewardEligible,
      ],
    );

    return {
      ok: true,
      commandName: "pricing.addLineItem",
      subjectId: lineItemId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

export type UpdateDealLineItemInput = {
  dealId: string;
  lineItemId: string;
  quantity?: number;
  msrpUsd?: number;
  ptpUsd?: number;
  discountPct?: number;
  dtpUsd?: number;
  proposedSellingPriceUsd?: number;
  rewardEligible?: boolean;
};

export async function updateDealLineItem(input: {
  actor: DealCommandActor;
  data: UpdateDealLineItemInput;
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

    if (
      deal.stage !== "sourced" &&
      deal.stage !== "demo" &&
      deal.stage !== "testing" &&
      deal.stage !== "qualified" &&
      deal.stage !== "proposal"
    ) {
      return {
        ok: false,
        failure: validationFailure("Cannot modify line items at this stage"),
        correlationId,
      };
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    const addField = (col: string, val: unknown) => {
      if (val !== undefined) {
        fields.push(`${col} = $${paramIdx++}`);
        values.push(val);
      }
    };

    addField("quantity", input.data.quantity);
    addField("msrp_usd", input.data.msrpUsd);
    addField("ptp_usd", input.data.ptpUsd);
    addField("discount_pct", input.data.discountPct);
    addField("dtp_usd", input.data.dtpUsd);
    addField("proposed_selling_price_usd", input.data.proposedSellingPriceUsd);
    addField("reward_eligible", input.data.rewardEligible);

    if (fields.length === 0) {
      return {
        ok: true,
        commandName: "pricing.updateLineItem",
        subjectId: input.data.lineItemId,
        newVersion: 1,
        nextAuthorisedActions: [],
        correlationId,
      };
    }

    values.push(input.data.lineItemId, input.data.dealId);
    await tx.query(
      `UPDATE deal_line_items SET ${fields.join(", ")} WHERE id = $${paramIdx++} AND deal_id = $${paramIdx++}`,
      values,
    );

    return {
      ok: true,
      commandName: "pricing.updateLineItem",
      subjectId: input.data.lineItemId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

export type RemoveDealLineItemInput = {
  dealId: string;
  lineItemId: string;
};

export async function removeDealLineItem(input: {
  actor: DealCommandActor;
  data: RemoveDealLineItemInput;
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

    if (
      deal.stage !== "sourced" &&
      deal.stage !== "demo" &&
      deal.stage !== "testing" &&
      deal.stage !== "qualified" &&
      deal.stage !== "proposal"
    ) {
      return {
        ok: false,
        failure: validationFailure("Cannot modify line items at this stage"),
        correlationId,
      };
    }

    await tx.query(`DELETE FROM deal_line_items WHERE id = $1 AND deal_id = $2`, [
      input.data.lineItemId,
      input.data.dealId,
    ]);

    return {
      ok: true,
      commandName: "pricing.removeLineItem",
      subjectId: input.data.lineItemId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

export type FreezePricingRevisionInput = {
  dealId: string;
};

export async function freezePricingRevision(input: {
  actor: DealCommandActor;
  data: FreezePricingRevisionInput;
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

    // Determine current revision number
    const { rows: revRows } = await tx.query(
      `SELECT COALESCE(MAX(revision_number), 0) as max_rev FROM pricing_revisions WHERE deal_id = $1`,
      [input.data.dealId],
    );
    const nextRevisionNumber = Number(revRows[0].max_rev) + 1;

    // Sum line items
    const { rows: lineRows } = await tx.query(
      `SELECT COALESCE(SUM(ptp_usd * quantity), 0) as total_ptp,
              COALESCE(SUM(dtp_usd * quantity), 0) as total_dtp
       FROM deal_line_items WHERE deal_id = $1`,
      [input.data.dealId],
    );

    const revisionId = randomUUID();
    await tx.query(
      `INSERT INTO pricing_revisions (id, deal_id, revision_number, total_ptp_usd, total_dtp_usd, is_final, created_by)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
      [
        revisionId,
        input.data.dealId,
        nextRevisionNumber,
        lineRows[0].total_ptp,
        lineRows[0].total_dtp,
        input.actor.userId,
      ],
    );

    return {
      ok: true,
      commandName: "pricing.freezeRevision",
      subjectId: revisionId,
      newVersion: nextRevisionNumber,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

export type RequestDiscountInput = {
  dealId: string;
  lineItemId: string;
  requestedDiscountPct: number;
  reason?: string;
};

export async function requestDiscount(input: {
  actor: DealCommandActor;
  data: RequestDiscountInput;
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

    if (deal.stage !== "proposal" && deal.stage !== "negotiation") {
      return {
        ok: false,
        failure: validationFailure(
          "Discounts can only be requested at Proposal or Negotiation stage",
        ),
        correlationId,
      };
    }

    const requestId = randomUUID();
    await tx.query(
      `INSERT INTO discount_requests (id, deal_id, line_item_id, requested_discount_pct, reason, requester_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [
        requestId,
        input.data.dealId,
        input.data.lineItemId,
        input.data.requestedDiscountPct,
        input.data.reason || null,
        input.actor.userId,
      ],
    );

    return {
      ok: true,
      commandName: "pricing.requestDiscount",
      subjectId: requestId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

export type ApproveDiscountInput = {
  dealId: string;
  requestId: string;
  approved: boolean;
};

export async function approveDiscount(input: {
  actor: DealCommandActor;
  data: ApproveDiscountInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  return withTransaction(async (tx) => {
    const deal = await loadDealForUpdate(tx, input.data.dealId);
    if (!deal) {
      return { ok: false, failure: validationFailure("Deal not found"), correlationId };
    }

    // Only livey_pam or livey_rm can approve discounts typically (simplified check)
    if (
      input.actor.assignment.roleKey !== "pam" &&
      input.actor.assignment.roleKey !== "rm" &&
      input.actor.assignment.roleKey !== "super_admin"
    ) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Only PAM or RM can approve discounts"),
        correlationId,
      };
    }

    const status = input.data.approved ? "approved" : "rejected";

    await tx.query(
      `UPDATE discount_requests SET status = $1, approver_id = $2 WHERE id = $3 AND deal_id = $4`,
      [status, input.actor.userId, input.data.requestId, input.data.dealId],
    );

    if (input.data.approved) {
      // Apply the discount to the line item
      const { rows } = await tx.query(
        `SELECT line_item_id, requested_discount_pct FROM discount_requests WHERE id = $1`,
        [input.data.requestId],
      );
      if (rows.length > 0) {
        const { line_item_id, requested_discount_pct } = rows[0];

        // Calculate new dtp_usd = ptp_usd * (1 - discount_pct / 100)
        await tx.query(
          `UPDATE deal_line_items 
           SET discount_pct = $1, 
               dtp_usd = ptp_usd * (1 - $1::numeric / 100) 
           WHERE id = $2 AND deal_id = $3`,
          [requested_discount_pct, line_item_id, input.data.dealId],
        );
      }
    }

    return {
      ok: true,
      commandName: "pricing.approveDiscount",
      subjectId: input.data.requestId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}
