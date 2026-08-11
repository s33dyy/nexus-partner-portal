import { Hono } from "hono";

import type { CrudOperation, FeatureKey } from "@/domain/contracts/features";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { resolveActor } from "@/routes/_actor";
import { resolveGovernedActor } from "@/server/governed-actor.server";
import { getAuthContext } from "@/server/livey-service.server";
import { loadRoleCapabilities } from "@/server/rbac-policy.server";
import { saveRolePermissions } from "@/server/role-assignment-commands.server";

export const rolePermissionCommandRoutes = new Hono();

rolePermissionCommandRoutes.post("/save-role-permissions", async (c) => {
  const data = await c.req.json<{
    roleKey: string;
    capabilities: Record<FeatureKey, Record<CrudOperation, boolean>>;
    reason?: string | null;
  }>();
  const actorResult = await resolveActor(resolveGovernedActor);
  if (!actorResult.ok) {
    return c.json({
      ok: false,
      message: actorResult.failure.message,
      correlationId: createCorrelationId(),
    });
  }
  const result = await saveRolePermissions({
    actor: actorResult.actor,
    roleKey: data.roleKey,
    capabilities: data.capabilities,
    reason: data.reason ?? null,
  });
  if (!result.ok) {
    return c.json({
      ok: false,
      message: result.failure.message,
      correlationId: result.correlationId,
    });
  }
  return c.json({ ok: true, correlationId: result.correlationId });
});

/** The calling user's own feature CRUD matrix, resolved server-side from
 * their current governed role. Used by useAuth()'s can() helper — never
 * fetched from the role_permissions table directly, since that table is
 * super_admin-only (admin.roles.tsx's edit surface). */
rolePermissionCommandRoutes.get("/get-my-capabilities", async (c) => {
  const authContext = await getAuthContext();
  return c.json(await loadRoleCapabilities(authContext.assignment?.roleKey ?? null));
});
