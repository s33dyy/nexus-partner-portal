import { createServerFn } from "@tanstack/react-start";
import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type { AddDealLineItemInput, UpdateDealLineItemInput, RemoveDealLineItemInput, FreezePricingRevisionInput } from "@/server/pricing-commands.server";

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

const addDealLineItemFn = createServerFn({ method: "POST" })
  .validator((input: AddDealLineItemInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { addDealLineItem } = await import("@/server/pricing-commands.server");
    return addDealLineItem({ actor: actorResult.actor, data });
  });

const updateDealLineItemFn = createServerFn({ method: "POST" })
  .validator((input: UpdateDealLineItemInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { updateDealLineItem } = await import("@/server/pricing-commands.server");
    return updateDealLineItem({ actor: actorResult.actor, data });
  });

const removeDealLineItemFn = createServerFn({ method: "POST" })
  .validator((input: RemoveDealLineItemInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { removeDealLineItem } = await import("@/server/pricing-commands.server");
    return removeDealLineItem({ actor: actorResult.actor, data });
  });

const freezePricingRevisionFn = createServerFn({ method: "POST" })
  .validator((input: FreezePricingRevisionInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { freezePricingRevision } = await import("@/server/pricing-commands.server");
    return freezePricingRevision({ actor: actorResult.actor, data });
  });

export async function addDealLineItem(input: AddDealLineItemInput): Promise<CommandExecutionResult> {
  return addDealLineItemFn({ data: input });
}
export async function updateDealLineItem(input: UpdateDealLineItemInput): Promise<CommandExecutionResult> {
  return updateDealLineItemFn({ data: input });
}
export async function removeDealLineItem(input: RemoveDealLineItemInput): Promise<CommandExecutionResult> {
  return removeDealLineItemFn({ data: input });
}
export async function freezePricingRevision(input: FreezePricingRevisionInput): Promise<CommandExecutionResult> {
  return freezePricingRevisionFn({ data: input });
}
