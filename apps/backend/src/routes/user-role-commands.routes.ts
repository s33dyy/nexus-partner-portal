import { Hono } from "hono";

import { actorDenial, resolveActor } from "@/routes/_actor";
import { resolveGovernedActor } from "@/server/governed-actor.server";
import { changeUserRole } from "@/server/user-role-commands.server";

export const userRoleCommandRoutes = new Hono();

userRoleCommandRoutes.post("/change-user-role", async (c) => {
  const data = await c.req.json<{
    targetUserId: string;
    newRole: string;
    reason?: string | null;
  }>();
  const actorResult = await resolveActor(resolveGovernedActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await changeUserRole({
      actor: actorResult.actor,
      targetUserId: data.targetUserId,
      newRole: data.newRole,
      reason: data.reason ?? null,
    }),
  );
});
