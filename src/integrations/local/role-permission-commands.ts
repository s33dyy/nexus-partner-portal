import { createServerFn } from "@tanstack/react-start";

import type { CrudOperation, FeatureKey } from "@/domain/contracts/features";

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

type SaveRolePermissionsInput = {
  roleKey: string;
  capabilities: Record<FeatureKey, Record<CrudOperation, boolean>>;
  geographyNodeIds: string[];
  globalAccess: boolean;
  reason?: string | null;
};

type SaveRolePermissionsClientResult =
  | { ok: true; affectedUserCount: number; correlationId: string }
  | { ok: false; message: string; correlationId: string };

const saveRolePermissionsFn = createServerFn({ method: "POST" })
  .validator((input: SaveRolePermissionsInput) => input)
  .handler(async ({ data }): Promise<SaveRolePermissionsClientResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) {
      const { createCorrelationId } = await import("@/domain/contracts/telemetry");
      return {
        ok: false,
        message: actorResult.failure.message,
        correlationId: createCorrelationId(),
      };
    }
    const { saveRolePermissions } = await import("@/server/role-assignment-commands.server");
    const result = await saveRolePermissions({
      actor: actorResult.actor,
      roleKey: data.roleKey,
      capabilities: data.capabilities,
      geographyNodeIds: data.geographyNodeIds,
      globalAccess: data.globalAccess,
      reason: data.reason ?? null,
    });
    if (!result.ok) {
      return { ok: false, message: result.failure.message, correlationId: result.correlationId };
    }
    return {
      ok: true,
      affectedUserCount: result.affectedUserCount,
      correlationId: result.correlationId,
    };
  });

export async function saveRolePermissions(
  input: SaveRolePermissionsInput,
): Promise<SaveRolePermissionsClientResult> {
  return saveRolePermissionsFn({ data: input });
}

const getMyCapabilitiesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<Record<FeatureKey, Record<CrudOperation, boolean>>> => {
    const { getAuthContext } = await import("@/server/livey-service.server");
    const { loadRoleCapabilities } = await import("@/server/rbac-policy.server");
    const authContext = await getAuthContext();
    return loadRoleCapabilities(authContext.assignment?.roleKey ?? null);
  },
);

/** The calling user's own feature CRUD matrix, resolved server-side from
 * their current governed role. Used by useAuth()'s can() helper — never
 * fetched from the role_permissions table directly, since that table is
 * super_admin-only (admin.roles.tsx's edit surface). */
export async function getMyCapabilities(): Promise<
  Record<FeatureKey, Record<CrudOperation, boolean>>
> {
  return getMyCapabilitiesFn();
}
