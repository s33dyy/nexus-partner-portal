import {
  GOVERNANCE_GEOGRAPHY_NODE_IDS,
  buildGeographyGraph,
  buildGovernanceSeedRows,
  countryNodeId,
  listDescendantGeographyNodeIds,
  type GeographyGraph,
} from "@/domain/contracts/governance";
import { WORLD_COUNTRIES } from "@/domain/contracts/world-geography";
import {
  FEATURE_KEYS,
  type AccessDecision,
  type CrudOperation,
  type FeatureKey,
} from "@/domain/contracts/features";
import type { RoleKey } from "@/domain/contracts/taxonomy";
import { pool } from "@/server/postgres.server";

// Same deterministic, code-derived geography tree used by
// deal-commands.server.ts's write-side geography check — built in-process
// so containment/descendant lookups never depend on geography_nodes having
// been seeded in the database (only db:bootstrap's demo seed populates
// that table; the ordinary deploy path does not).
const GEOGRAPHY_GRAPH: GeographyGraph = (() => {
  const seedRows = buildGovernanceSeedRows({ superAdminUserId: "__rbac_policy__" });
  return buildGeographyGraph(seedRows.geographyNodes, seedRows.geographyAliases);
})();

export type FeatureCapabilities = Record<FeatureKey, Record<CrudOperation, boolean>>;

export type EffectiveCapabilityInput = {
  role: RoleKey;
  feature: FeatureKey;
  operation: CrudOperation;
  roleAllowed: boolean;
  userOverride: boolean | null;
};

export type AccessControlSnapshot = {
  roles: Array<{
    roleKey: RoleKey;
    capabilities: FeatureCapabilities;
  }>;
  users: Array<{ userId: string; fullName: string; email: string; roleKey: RoleKey | null }>;
  overrides: Array<{
    userId: string;
    featureKey: FeatureKey;
    operation: CrudOperation;
    decision: AccessDecision;
    updatedAt: string;
  }>;
};

export function resolveEffectiveCapability(input: EffectiveCapabilityInput): boolean {
  if (input.role === "super_admin") return true;
  return input.userOverride ?? input.roleAllowed;
}

function emptyCapabilities(): FeatureCapabilities {
  const capabilities = {} as FeatureCapabilities;
  for (const feature of FEATURE_KEYS) {
    capabilities[feature] = { create: false, read: false, update: false, delete: false };
  }
  return capabilities;
}

/** Loads the CRUD matrix for a single governed role. A super_admin caller
 * should never route through this — table-policy.server.ts's existing
 * super_admin bypass runs first, so the matrix can be edited without ever
 * risking locking out the admin who manages it. */
export async function loadRoleCapabilities(roleKey: RoleKey | null): Promise<FeatureCapabilities> {
  const capabilities = emptyCapabilities();
  if (!roleKey) return capabilities;

  // Super-admin authority is structural, not seed-data-dependent. Keeping it
  // explicit prevents a missing or edited role_permissions row from hiding
  // administration modules from the account responsible for repairing them.
  if (roleKey === "super_admin") {
    for (const feature of FEATURE_KEYS) {
      capabilities[feature] = {
        create: true,
        read: true,
        update: true,
        // Distribution history is intentionally non-destructive.
        delete: feature !== "distribution",
      };
    }
    return capabilities;
  }

  const { rows } = await pool.query(
    `SELECT feature_key, can_create, can_read, can_update, can_delete
     FROM role_permissions
     WHERE role_key = $1`,
    [roleKey],
  );

  for (const row of rows as Array<{
    feature_key: string;
    can_create: boolean;
    can_read: boolean;
    can_update: boolean;
    can_delete: boolean;
  }>) {
    if (!(row.feature_key in capabilities)) continue;
    capabilities[row.feature_key as FeatureKey] = {
      create: row.can_create,
      read: row.can_read,
      update: row.can_update,
      delete: row.can_delete,
    };
  }

  return capabilities;
}

export async function loadEffectiveCapabilities(
  userId: string | null,
  roleKey: RoleKey | null,
): Promise<FeatureCapabilities> {
  const capabilities = await loadRoleCapabilities(roleKey);
  if (!userId || !roleKey || roleKey === "super_admin") return capabilities;
  const { rows } = await pool.query(
    `SELECT feature_key, operation, decision FROM user_access_overrides WHERE user_id = $1`,
    [userId],
  );
  for (const row of rows as Array<{
    feature_key: string;
    operation: string;
    decision: AccessDecision;
  }>) {
    if (
      !(row.feature_key in capabilities) ||
      !["create", "read", "update", "delete"].includes(row.operation)
    )
      continue;
    const feature = row.feature_key as FeatureKey;
    const operation = row.operation as CrudOperation;
    capabilities[feature][operation] = resolveEffectiveCapability({
      role: roleKey,
      feature,
      operation,
      roleAllowed: capabilities[feature][operation],
      userOverride: row.decision === "allow",
    });
  }
  return capabilities;
}

export function hasCapability(
  capabilities: FeatureCapabilities,
  featureKey: FeatureKey,
  operation: CrudOperation,
): boolean {
  return capabilities[featureKey]?.[operation] ?? false;
}

export function assertFeatureCapability(
  capabilities: FeatureCapabilities,
  featureKey: FeatureKey,
  operation: CrudOperation,
) {
  if (!hasCapability(capabilities, featureKey, operation)) {
    throw new Error("Access denied");
  }
}

/** Country display names (matching portal_deals.country / partners.country
 * free text) reachable from a geography ceiling node. Global ceiling means
 * unrestricted, represented as null (no filter to apply). */
export function countriesWithinCeiling(geographyCeilingNodeId: string | null): string[] | null {
  if (!geographyCeilingNodeId || geographyCeilingNodeId === GOVERNANCE_GEOGRAPHY_NODE_IDS.global) {
    return null;
  }

  const reachable = new Set(
    listDescendantGeographyNodeIds(GEOGRAPHY_GRAPH, geographyCeilingNodeId),
  );
  if (reachable.size === 0) {
    // Ceiling node isn't part of the known static tree (e.g. a stale/custom
    // node id) — fail closed rather than silently granting global access.
    return [];
  }

  return WORLD_COUNTRIES.filter((country) => reachable.has(countryNodeId(country.code))).map(
    (country) => country.name,
  );
}

export { GEOGRAPHY_GRAPH };
