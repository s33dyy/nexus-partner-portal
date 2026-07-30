import { createServerFn } from "@tanstack/react-start";

import type { CommandExecutionResult } from "@/domain/contracts/commands";

async function resolveActorOrDenial() {
  const { getAuthContext } = await import("@/server/livey-service.server");
  const { resolveGovernedActor } = await import("@/server/governed-actor.server");
  const authContext = await getAuthContext();
  return resolveGovernedActor({
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

const changeUserRoleFn = createServerFn({ method: "POST" })
  .validator((input: { targetUserId: string; newRole: string; reason?: string | null }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { changeUserRole } = await import("@/server/user-role-commands.server");
    return changeUserRole({
      actor: actorResult.actor,
      targetUserId: data.targetUserId,
      newRole: data.newRole,
      reason: data.reason ?? null,
    });
  });

export async function changeUserRole(input: {
  targetUserId: string;
  newRole: string;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return changeUserRoleFn({ data: input });
}
