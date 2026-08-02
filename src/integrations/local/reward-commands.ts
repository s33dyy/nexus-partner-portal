import { createServerFn } from "@tanstack/react-start";

import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type {
  AdjustRewardPointsInput,
  RequestRewardRedemptionInput,
} from "@/server/reward-commands.server";

async function resolveActorOrDenial() {
  const { getAuthContext } = await import("@/server/livey-service.server");
  const { resolveRewardCommandActor } = await import("@/server/reward-commands.server");
  const authContext = await getAuthContext();
  return resolveRewardCommandActor({
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

const requestRewardRedemptionFn = createServerFn({ method: "POST" })
  .validator((input: RequestRewardRedemptionInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { requestRewardRedemption } = await import("@/server/reward-commands.server");
    return requestRewardRedemption({ actor: actorResult.actor, data });
  });

const approveRewardRedemptionFn = createServerFn({ method: "POST" })
  .validator((input: { redemptionId: string; expectedVersion: number }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { approveRewardRedemption } = await import("@/server/reward-commands.server");
    return approveRewardRedemption({
      actor: actorResult.actor,
      redemptionId: data.redemptionId,
      expectedVersion: data.expectedVersion,
    });
  });

const rejectRewardRedemptionFn = createServerFn({ method: "POST" })
  .validator((input: { redemptionId: string; expectedVersion: number; reason: string }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { rejectRewardRedemption } = await import("@/server/reward-commands.server");
    return rejectRewardRedemption({
      actor: actorResult.actor,
      redemptionId: data.redemptionId,
      expectedVersion: data.expectedVersion,
      reason: data.reason,
    });
  });

const retireRewardCatalogItemFn = createServerFn({ method: "POST" })
  .validator((input: { rewardId: string }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { retireRewardCatalogItem } = await import("@/server/reward-commands.server");
    return retireRewardCatalogItem({ actor: actorResult.actor, rewardId: data.rewardId });
  });

const adjustRewardPointsFn = createServerFn({ method: "POST" })
  .validator((input: AdjustRewardPointsInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { adjustRewardPoints } = await import("@/server/reward-commands.server");
    return adjustRewardPoints({ actor: actorResult.actor, data });
  });

export function requestRewardRedemption(
  input: RequestRewardRedemptionInput,
): Promise<CommandExecutionResult> {
  return requestRewardRedemptionFn({ data: input });
}

export function approveRewardRedemption(input: {
  redemptionId: string;
  expectedVersion: number;
}): Promise<CommandExecutionResult> {
  return approveRewardRedemptionFn({ data: input });
}

export function rejectRewardRedemption(input: {
  redemptionId: string;
  expectedVersion: number;
  reason: string;
}): Promise<CommandExecutionResult> {
  return rejectRewardRedemptionFn({ data: input });
}

export function retireRewardCatalogItem(input: {
  rewardId: string;
}): Promise<CommandExecutionResult> {
  return retireRewardCatalogItemFn({ data: input });
}

export function adjustRewardPoints(
  input: AdjustRewardPointsInput,
): Promise<CommandExecutionResult> {
  return adjustRewardPointsFn({ data: input });
}
