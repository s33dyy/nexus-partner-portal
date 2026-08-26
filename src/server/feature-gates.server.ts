import {
  FEATURE_FLAG_REGISTRY,
  type FeatureFlagKey,
  type FeatureFlagRegistryEntry,
} from "@/domain/contracts/feature-flags";
import { pool } from "@/server/postgres.server";

/**
 * Server-evaluated product-surface readiness.
 *
 * A *product surface* is a whole user-facing capability — a route, its
 * navigation entries, and its commands. Unlike the platform flags in the
 * same registry, a surface flag answers "is this real yet?", so every
 * evaluation here fails closed: a missing flag row, an unmet dependency, a
 * malformed row, or a database error all resolve to `false`, for every
 * role including Super Admin. There is deliberately no super_admin bypass —
 * an unfinished surface is not more finished for an administrator, and a
 * bypass would make the hidden-route tests meaningless.
 *
 * The browser never sees anything from this module except booleans. Flag
 * rows, dependency names, environment variable names, and credential state
 * all stay on the server: `ProductSurfaceSnapshot` is the entire public
 * shape (see integrations/local/feature-gates.ts).
 */
export const PRODUCT_SURFACE_KEYS = [
  "distribution-core",
  "integration-operations-centre",
  "learning-lesson-authoring",
  "gyftr-fulfillment",
  "product-recommendations",
] as const satisfies readonly FeatureFlagKey[];

export type ProductSurfaceKey = (typeof PRODUCT_SURFACE_KEYS)[number];

export type ProductSurfaceSnapshot = {
  distributionCore: boolean;
  integrationOperationsCentre: boolean;
  learningLessonAuthoring: boolean;
  gyftrFulfillment: boolean;
  productRecommendations: boolean;
};

const SNAPSHOT_FIELD_BY_KEY: Record<ProductSurfaceKey, keyof ProductSurfaceSnapshot> = {
  "distribution-core": "distributionCore",
  "integration-operations-centre": "integrationOperationsCentre",
  "learning-lesson-authoring": "learningLessonAuthoring",
  "gyftr-fulfillment": "gyftrFulfillment",
  "product-recommendations": "productRecommendations",
};

export const ALL_PRODUCT_SURFACES_DISABLED: ProductSurfaceSnapshot = {
  distributionCore: false,
  integrationOperationsCentre: false,
  learningLessonAuthoring: false,
  gyftrFulfillment: false,
  productRecommendations: false,
};

export type ProductSurfaceQuery = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;

export type ProductSurfaceDeps = {
  query?: ProductSurfaceQuery;
  env?: Record<string, string | undefined>;
};

/** Surfaces that need more than a flag row before they are honestly "on".
 * A flag can be flipped by an operator; a credential cannot be conjured, so
 * an enabled flag with no credentials must still read as disabled or the
 * product would advertise a provider it cannot reach. */
const REQUIRED_ENV_BY_KEY: Partial<Record<ProductSurfaceKey, readonly string[]>> = {
  "gyftr-fulfillment": ["GYFTR_API_URL", "GYFTR_CLIENT_ID", "GYFTR_SECRET_KEY"],
};

function isProductSurfaceKey(key: string): key is ProductSurfaceKey {
  return (PRODUCT_SURFACE_KEYS as readonly string[]).includes(key);
}

function registryEntry(key: FeatureFlagKey): FeatureFlagRegistryEntry | undefined {
  return FEATURE_FLAG_REGISTRY.find((entry) => entry.key === key);
}

/** The surface plus every flag it transitively depends on. All of them must
 * be enabled, so all of them are fetched in one round trip. */
function requiredFlagKeys(key: ProductSurfaceKey): FeatureFlagKey[] {
  const collected = new Set<FeatureFlagKey>();
  const walk = (current: FeatureFlagKey) => {
    if (collected.has(current)) return;
    collected.add(current);
    for (const dependency of registryEntry(current)?.dependencies ?? []) {
      walk(dependency);
    }
  };
  walk(key);
  return [...collected];
}

function readEnabledFlags(rows: unknown[]): Map<string, boolean> {
  const enabled = new Map<string, boolean>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const candidate = row as { flag_key?: unknown; enabled?: unknown };
    if (typeof candidate.flag_key !== "string") continue;
    // Anything that is not literally `true` is treated as off. A NULL or a
    // string "false" coming back from a hand-edited row must not read as
    // enabled.
    enabled.set(candidate.flag_key, candidate.enabled === true);
  }
  return enabled;
}

function hasRequiredCredentials(
  key: ProductSurfaceKey,
  env: Record<string, string | undefined>,
): boolean {
  const required = REQUIRED_ENV_BY_KEY[key];
  if (!required) return true;
  return required.every((name) => (env[name] ?? "").trim().length > 0);
}

async function loadEnabledFlags(
  keys: readonly FeatureFlagKey[],
  query: ProductSurfaceQuery,
): Promise<Map<string, boolean>> {
  const { rows } = await query(
    `SELECT flag_key, enabled FROM feature_flags WHERE flag_key = ANY($1)`,
    [[...keys]],
  );
  return readEnabledFlags(rows);
}

/**
 * Resolves one product surface. Returns `false` on anything other than an
 * unambiguous "yes": unknown key, missing row, disabled row, missing or
 * disabled dependency, absent credentials, or a thrown query.
 */
export async function resolveProductSurface(
  key: ProductSurfaceKey,
  deps: ProductSurfaceDeps = {},
): Promise<boolean> {
  if (!isProductSurfaceKey(key)) return false;

  const query = deps.query ?? ((sql, params) => pool.query(sql, params as unknown[]));
  const env = deps.env ?? process.env;

  if (!hasRequiredCredentials(key, env)) return false;

  try {
    const required = requiredFlagKeys(key);
    const enabled = await loadEnabledFlags(required, query);
    return required.every((flagKey) => enabled.get(flagKey) === true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[feature-gates] surface "${key}" failed closed: ${message}`);
    return false;
  }
}

/**
 * Resolves every product surface in one round trip. Used by the single GET
 * server function the browser calls, so navigation, routes, and dialogs all
 * read the same answer rather than each deciding for itself.
 */
export async function resolveProductSurfaceSnapshot(
  deps: ProductSurfaceDeps = {},
): Promise<ProductSurfaceSnapshot> {
  const query = deps.query ?? ((sql, params) => pool.query(sql, params as unknown[]));
  const env = deps.env ?? process.env;

  const required = new Set<FeatureFlagKey>();
  for (const key of PRODUCT_SURFACE_KEYS) {
    for (const flagKey of requiredFlagKeys(key)) required.add(flagKey);
  }

  let enabled: Map<string, boolean>;
  try {
    enabled = await loadEnabledFlags([...required], query);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[feature-gates] snapshot failed closed: ${message}`);
    return { ...ALL_PRODUCT_SURFACES_DISABLED };
  }

  const snapshot: ProductSurfaceSnapshot = { ...ALL_PRODUCT_SURFACES_DISABLED };
  for (const key of PRODUCT_SURFACE_KEYS) {
    const flagsSatisfied = requiredFlagKeys(key).every((flagKey) => enabled.get(flagKey) === true);
    snapshot[SNAPSHOT_FIELD_BY_KEY[key]] = flagsSatisfied && hasRequiredCredentials(key, env);
  }
  return snapshot;
}

/** Throws the standard denial the rest of the server uses, so a command
 * behind a disabled surface fails exactly like an unauthorised one. */
export async function assertProductSurfaceEnabled(
  key: ProductSurfaceKey,
  deps: ProductSurfaceDeps = {},
): Promise<void> {
  if (!(await resolveProductSurface(key, deps))) {
    throw new Error("Access denied");
  }
}
