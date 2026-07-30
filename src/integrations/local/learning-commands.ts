import { createServerFn } from "@tanstack/react-start";

import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type { EnrollInTrackInput, SubmitAssessmentInput } from "@/server/learning-commands.server";

async function resolveActorOrDenial() {
  const { getAuthContext } = await import("@/server/livey-service.server");
  const { resolveLearningCommandActor } = await import("@/server/learning-commands.server");
  const authContext = await getAuthContext();
  return resolveLearningCommandActor({
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

const enrollInTrackFn = createServerFn({ method: "POST" })
  .validator((input: EnrollInTrackInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { enrollInTrack } = await import("@/server/learning-commands.server");
    return enrollInTrack({ actor: actorResult.actor, data });
  });

const submitAssessmentAttemptFn = createServerFn({ method: "POST" })
  .validator((input: SubmitAssessmentInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { submitAssessmentAttempt } = await import("@/server/learning-commands.server");
    return submitAssessmentAttempt({ actor: actorResult.actor, data });
  });

export async function enrollInTrack(input: EnrollInTrackInput): Promise<CommandExecutionResult> {
  return enrollInTrackFn({ data: input });
}

export async function submitAssessmentAttempt(
  input: SubmitAssessmentInput,
): Promise<CommandExecutionResult> {
  return submitAssessmentAttemptFn({ data: input });
}
