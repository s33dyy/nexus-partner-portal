import type { CommandExecutionResult } from "@/domain/contracts/commands";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import type { GovernedActor, ResolveGovernedActorInput } from "@/server/governed-actor.server";
import { getAuthContext } from "@/server/livey-service.server";

type ActorResolution =
  | { ok: true; actor: GovernedActor }
  | { ok: false; failure: Extract<CommandExecutionResult, { ok: false }>["failure"] };

type ActorResolver = (input: ResolveGovernedActorInput) => ActorResolution;

/**
 * Resolves the governed actor for a command route from the request's session.
 * Each domain passes its own resolveXCommandActor, which applies that domain's
 * extra eligibility rules on top of resolveGovernedActor.
 */
export async function resolveActor(resolver: ActorResolver): Promise<ActorResolution> {
  const authContext = await getAuthContext();
  return resolver({
    userId: authContext.session?.user.id ?? null,
    assignment: authContext.assignment,
    activeContext: authContext.activeContext,
  });
}

export function actorDenial(
  failure: Extract<ActorResolution, { ok: false }>["failure"],
): CommandExecutionResult {
  return { ok: false, failure, correlationId: createCorrelationId() };
}
