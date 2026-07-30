import { createServerFn } from "@tanstack/react-start";
import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type { SubmitPOInput, ReviewOutcomeInput } from "@/server/outcome-review-commands.server";

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

const submitPOFn = createServerFn({ method: "POST" })
  .validator((input: SubmitPOInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { submitPO } = await import("@/server/outcome-review-commands.server");
    return submitPO({ actor: actorResult.actor, data });
  });

const approvePOFn = createServerFn({ method: "POST" })
  .validator((input: ReviewOutcomeInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { approvePO } = await import("@/server/outcome-review-commands.server");
    return approvePO({ actor: actorResult.actor, data });
  });

const requestChangesFn = createServerFn({ method: "POST" })
  .validator((input: ReviewOutcomeInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { requestChanges } = await import("@/server/outcome-review-commands.server");
    return requestChanges({ actor: actorResult.actor, data });
  });

const rejectOutcomeFn = createServerFn({ method: "POST" })
  .validator((input: ReviewOutcomeInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { rejectOutcome } = await import("@/server/outcome-review-commands.server");
    return rejectOutcome({ actor: actorResult.actor, data });
  });

export async function submitPO(input: SubmitPOInput): Promise<CommandExecutionResult> {
  return submitPOFn({ data: input });
}
export async function approvePO(input: ReviewOutcomeInput): Promise<CommandExecutionResult> {
  return approvePOFn({ data: input });
}
export async function requestChanges(input: ReviewOutcomeInput): Promise<CommandExecutionResult> {
  return requestChangesFn({ data: input });
}
export async function rejectOutcome(input: ReviewOutcomeInput): Promise<CommandExecutionResult> {
  return rejectOutcomeFn({ data: input });
}
