import type { CrudOperation, FeatureKey } from "@/domain/contracts/features";

import { apiFetch } from "./api-client";

type SaveRolePermissionsInput = {
  roleKey: string;
  capabilities: Record<FeatureKey, Record<CrudOperation, boolean>>;
  reason?: string | null;
};

type SaveRolePermissionsClientResult =
  { ok: true; correlationId: string } | { ok: false; message: string; correlationId: string };

export async function saveRolePermissions(
  input: SaveRolePermissionsInput,
): Promise<SaveRolePermissionsClientResult> {
  return apiFetch("POST", "/api/role-permission-commands/save-role-permissions", input);
}

/** The calling user's own feature CRUD matrix, resolved server-side from
 * their current governed role. Used by useAuth()'s can() helper — never
 * fetched from the role_permissions table directly, since that table is
 * super_admin-only (admin.roles.tsx's edit surface). */
export async function getMyCapabilities(): Promise<
  Record<FeatureKey, Record<CrudOperation, boolean>>
> {
  return apiFetch("GET", "/api/role-permission-commands/get-my-capabilities");
}
