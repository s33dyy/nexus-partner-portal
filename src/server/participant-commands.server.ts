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

export type TagDealParticipantInput = {
  dealId: string;
  participantUserId: string;
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
    await tx.query(
      `INSERT INTO deal_participants (
         id, deal_id, partner_id, participant_type, source, actor_id, reason
       ) VALUES ($1, $2, $3, $4, 'manual', $5, $6)`,
      [
        participantId,
        input.data.dealId,
        deal.partner_id,
        input.data.participantType,
        input.actor.userId,
        input.data.reason,
      ],
    );

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
