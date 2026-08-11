import { Hono } from "hono";

import { actorDenial, resolveActor } from "@/routes/_actor";
import { resolveGovernedActor } from "@/server/governed-actor.server";
import { assignGovernedRole } from "@/server/role-assignment-commands.server";

export const roleAssignmentCommandRoutes = new Hono();

roleAssignmentCommandRoutes.post("/assign-governed-role", async (c) => {
  const data = await c.req.json<{
    targetUserId: string;
    roleKey: string;
    geographyCeilingNodeId?: string | null;
    reason?: string | null;
  }>();
  const actorResult = await resolveActor(resolveGovernedActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await assignGovernedRole({
      actor: actorResult.actor,
      targetUserId: data.targetUserId,
      roleKey: data.roleKey,
      geographyCeilingNodeId: data.geographyCeilingNodeId ?? null,
      reason: data.reason ?? null,
    }),
  );
});
