import {
  GOVERNANCE_GEOGRAPHY_NODE_IDS,
  buildGeographyGraph,
  buildGovernanceSeedRows,
  countryNodeId,
  listDescendantGeographyNodeIds,
  type GeographyGraph,
} from "@/domain/contracts/governance";
import { WORLD_COUNTRIES } from "@/domain/contracts/world-geography";
import { FEATURE_KEYS, type CrudOperation, type FeatureKey } from "@/domain/contracts/features";
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
