import { createServerFn } from "@tanstack/react-start";

import type { AccessDecision, CrudOperation, FeatureKey } from "@/domain/contracts/features";
import type { AccessControlSnapshot } from "@/server/rbac-policy.server";

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
  reason?: string | null;
};

type SaveRolePermissionsClientResult =
  | { ok: true; correlationId: string }
  | { ok: false; message: string; correlationId: string };

type UserAccessOverrideInput = {
  userId: string;
  featureKey: FeatureKey;
  operation: CrudOperation;
  decision: AccessDecision;
  reason?: string | null;
};

type UserAccessOverrideClientResult = SaveRolePermissionsClientResult;

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
      reason: data.reason ?? null,
    });
    if (!result.ok) {
      return { ok: false, message: result.failure.message, correlationId: result.correlationId };
    }
    return { ok: true, correlationId: result.correlationId };
  });

export async function saveRolePermissions(
  input: SaveRolePermissionsInput,
): Promise<SaveRolePermissionsClientResult> {
  return saveRolePermissionsFn({ data: input });
}

const loadAccessControlSnapshotFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<AccessControlSnapshot> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) throw new Error(actorResult.failure.message);
    const { loadAccessControlSnapshot } = await import("@/server/role-assignment-commands.server");
    return loadAccessControlSnapshot(actorResult.actor);
  },
);

export async function loadAccessControlSnapshot(): Promise<AccessControlSnapshot> {
  return loadAccessControlSnapshotFn();
}

const saveUserAccessOverrideFn = createServerFn({ method: "POST" })
  .validator((input: UserAccessOverrideInput) => input)
  .handler(async ({ data }): Promise<UserAccessOverrideClientResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) {
      const { createCorrelationId } = await import("@/domain/contracts/telemetry");
      return {
        ok: false,
        message: actorResult.failure.message,
        correlationId: createCorrelationId(),
      };
    }
    const { saveUserAccessOverride } = await import("@/server/role-assignment-commands.server");
    const result = await saveUserAccessOverride({ actor: actorResult.actor, ...data });
    return result.ok
      ? result
      : { ok: false, message: result.failure.message, correlationId: result.correlationId };
  });

export async function saveUserAccessOverride(
  input: UserAccessOverrideInput,
): Promise<UserAccessOverrideClientResult> {
  return saveUserAccessOverrideFn({ data: input });
}

const removeUserAccessOverrideFn = createServerFn({ method: "POST" })
  .validator((input: Omit<UserAccessOverrideInput, "decision">) => input)
  .handler(async ({ data }): Promise<UserAccessOverrideClientResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) {
      const { createCorrelationId } = await import("@/domain/contracts/telemetry");
      return {
        ok: false,
        message: actorResult.failure.message,
        correlationId: createCorrelationId(),
      };
    }
    const { removeUserAccessOverride } = await import("@/server/role-assignment-commands.server");
    const result = await removeUserAccessOverride({ actor: actorResult.actor, ...data });
    return result.ok
      ? result
      : { ok: false, message: result.failure.message, correlationId: result.correlationId };
  });

export async function removeUserAccessOverride(
  input: Omit<UserAccessOverrideInput, "decision">,
): Promise<UserAccessOverrideClientResult> {
  return removeUserAccessOverrideFn({ data: input });
}

const getMyCapabilitiesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<Record<FeatureKey, Record<CrudOperation, boolean>>> => {
    const { getAuthContext } = await import("@/server/livey-service.server");
    const authContext = await getAuthContext();
    const { loadEffectiveCapabilities } = await import("@/server/rbac-policy.server");
    return loadEffectiveCapabilities(
      authContext.session?.user.id ?? null,
      authContext.roles.includes("super_admin")
        ? "super_admin"
        : (authContext.assignment?.roleKey ?? null),
    );
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
