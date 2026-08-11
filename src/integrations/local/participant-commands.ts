import { createServerFn } from "@tanstack/react-start";
import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type {
  TagCustomerParticipantInput,
  TagDealParticipantInput,
  UntagCustomerParticipantInput,
  UntagDealParticipantInput,
} from "@/server/participant-commands.server";

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

const tagDealParticipantFn = createServerFn({ method: "POST" })
  .validator((input: TagDealParticipantInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { tagDealParticipant } = await import("@/server/participant-commands.server");
    return tagDealParticipant({ actor: actorResult.actor, data });
  });

const untagDealParticipantFn = createServerFn({ method: "POST" })
  .validator((input: UntagDealParticipantInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { untagDealParticipant } = await import("@/server/participant-commands.server");
    return untagDealParticipant({ actor: actorResult.actor, data });
  });

export async function tagDealParticipant(
  input: TagDealParticipantInput,
): Promise<CommandExecutionResult> {
  return tagDealParticipantFn({ data: input });
}
export async function untagDealParticipant(
  input: UntagDealParticipantInput,
): Promise<CommandExecutionResult> {
  return untagDealParticipantFn({ data: input });
}

const tagCustomerParticipantFn = createServerFn({ method: "POST" })
  .validator((input: TagCustomerParticipantInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { tagCustomerParticipant } = await import("@/server/participant-commands.server");
    return tagCustomerParticipant({ actor: actorResult.actor, data });
  });

const untagCustomerParticipantFn = createServerFn({ method: "POST" })
  .validator((input: UntagCustomerParticipantInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { untagCustomerParticipant } = await import("@/server/participant-commands.server");
    return untagCustomerParticipant({ actor: actorResult.actor, data });
  });

export async function tagCustomerParticipant(
  input: TagCustomerParticipantInput,
): Promise<CommandExecutionResult> {
  return tagCustomerParticipantFn({ data: input });
}
export async function untagCustomerParticipant(
  input: UntagCustomerParticipantInput,
): Promise<CommandExecutionResult> {
  return untagCustomerParticipantFn({ data: input });
}
