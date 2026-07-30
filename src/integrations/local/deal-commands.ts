import { createServerFn } from "@tanstack/react-start";

import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type { CreateDealInput } from "@/server/deal-commands.server";
import type { DealStage } from "@/lib/portal-records";

async function resolveActorOrDenial() {
  const { getAuthContext } = await import("@/server/livey-service.server");
  const { resolveDealCommandActor } = await import("@/server/deal-commands.server");
  const authContext = await getAuthContext();
  return resolveDealCommandActor({
    userId: authContext.session?.user.id ?? null,
    assignment: authContext.assignment,
    activeContext: authContext.activeContext,
  });
}

async function actorDenialResult(
  failure: Extract<Awaited<ReturnType<typeof resolveActorOrDenial>>, { ok: false }>["failure"],
): Promise<CommandExecutionResult> {
  const { createCorrelationId } = await import("@/domain/contracts/telemetry");
  return { ok: false, failure, correlationId: createCorrelationId() };
}

const moveDealStageForwardFn = createServerFn({ method: "POST" })
  .validator((input: { dealId: string; expectedVersion: number; note?: string | null }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { moveDealStageForward } = await import("@/server/deal-commands.server");
    return moveDealStageForward({
      actor: actorResult.actor,
      dealId: data.dealId,
      expectedVersion: data.expectedVersion,
      note: data.note ?? null,
    });
  });

const moveDealStageBackwardFn = createServerFn({ method: "POST" })
  .validator(
    (input: { dealId: string; expectedVersion: number; toStage: DealStage; reason: string }) =>
      input,
  )
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { moveDealStageBackward } = await import("@/server/deal-commands.server");
    return moveDealStageBackward({
      actor: actorResult.actor,
      dealId: data.dealId,
      expectedVersion: data.expectedVersion,
      toStage: data.toStage,
      reason: data.reason,
    });
  });

const markDealWonFn = createServerFn({ method: "POST" })
  .validator((input: { dealId: string; expectedVersion: number; reason?: string | null }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { markDealWon } = await import("@/server/deal-commands.server");
    return markDealWon({
      actor: actorResult.actor,
      dealId: data.dealId,
      expectedVersion: data.expectedVersion,
      reason: data.reason ?? null,
    });
  });

const createDealFn = createServerFn({ method: "POST" })
  .validator((input: CreateDealInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { createDeal } = await import("@/server/deal-commands.server");
    return createDeal({ actor: actorResult.actor, data });
  });

const markDealLostFn = createServerFn({ method: "POST" })
  .validator((input: { dealId: string; expectedVersion: number; reason?: string | null }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { markDealLost } = await import("@/server/deal-commands.server");
    return markDealLost({
      actor: actorResult.actor,
      dealId: data.dealId,
      expectedVersion: data.expectedVersion,
      reason: data.reason ?? null,
    });
  });

export async function createDeal(input: CreateDealInput): Promise<CommandExecutionResult> {
  return createDealFn({ data: input });
}

export async function moveDealStageForward(input: {
  dealId: string;
  expectedVersion: number;
  note?: string | null;
}): Promise<CommandExecutionResult> {
  return moveDealStageForwardFn({ data: input });
}

export async function moveDealStageBackward(input: {
  dealId: string;
  expectedVersion: number;
  toStage: DealStage;
  reason: string;
}): Promise<CommandExecutionResult> {
  return moveDealStageBackwardFn({ data: input });
}

export async function markDealWon(input: {
  dealId: string;
  expectedVersion: number;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return markDealWonFn({ data: input });
}

export async function markDealLost(input: {
  dealId: string;
  expectedVersion: number;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return markDealLostFn({ data: input });
}
