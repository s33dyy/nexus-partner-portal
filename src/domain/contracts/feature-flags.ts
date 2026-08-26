export type FeatureFlagKey =
  | "governed-reference-data-write"
  | "command-framework-write"
  | "active-context-switch"
  | "baseline-telemetry"
  | "inventory-read-models"
  // Product-surface readiness flags. Unlike the five above (which gate a
  // platform mechanism), these gate whether a whole user-facing surface is
  // exposed at all. Every one ships disabled: a surface is hidden until its
  // implementation is real, and evaluation fails closed for every role
  // including Super Admin — see server/feature-gates.server.ts.
  | "distribution-core"
  | "integration-operations-centre"
  | "learning-lesson-authoring"
  | "gyftr-fulfillment"
  | "product-recommendations";

export type FeatureFlagRegistryEntry = {
  key: FeatureFlagKey;
  label: string;
  enabledByDefault: boolean;
  owner: string;
  cohort: string;
  dependencies: readonly FeatureFlagKey[];
  metrics: readonly string[];
  expiresAt: string | null;
  rollback: string;
  auditRequired: boolean;
};

export const FEATURE_FLAG_REGISTRY: readonly FeatureFlagRegistryEntry[] = [
  {
    key: "governed-reference-data-write",
    label: "Governed reference data writes",
    enabledByDefault: true,
    owner: "Platform Data Foundations",
    cohort: "internal-only",
    dependencies: [],
    metrics: ["seed-idempotency", "lookup-write-denials"],
    expiresAt: "2026-12-31",
    rollback: "Disable governed writes and keep lookup_values read-only.",
    auditRequired: true,
  },
  {
    key: "command-framework-write",
    label: "Command framework writes",
    enabledByDefault: true,
    owner: "Platform Delivery",
    cohort: "internal-only",
    dependencies: ["baseline-telemetry"],
    metrics: ["command-success-rate", "command-denial-rate"],
    expiresAt: "2026-12-31",
    rollback: "Bypass command runtime and revert to read-only command envelopes.",
    auditRequired: true,
  },
  {
    key: "active-context-switch",
    label: "Active context switching",
    enabledByDefault: false,
    owner: "Identity and Policy",
    cohort: "internal-only",
    dependencies: ["command-framework-write"],
    metrics: ["context-switch-denials", "context-switch-latency"],
    expiresAt: "2026-12-31",
    rollback: "Disable context switching and force a single authorized assignment.",
    auditRequired: true,
  },
  {
    key: "baseline-telemetry",
    label: "Baseline telemetry",
    enabledByDefault: true,
    owner: "Platform Observability",
    cohort: "all-environments",
    dependencies: [],
    metrics: ["correlation-id-coverage", "structured-log-redaction"],
    expiresAt: null,
    rollback: "Keep telemetry helpers but stop emitting nonessential events.",
    auditRequired: true,
  },
  {
    key: "inventory-read-models",
    label: "Inventory read models",
    enabledByDefault: true,
    owner: "Platform Data Foundations",
    cohort: "internal-only",
    dependencies: ["baseline-telemetry"],
    metrics: ["inventory-run-success", "inventory-checkpoint-resume"],
    expiresAt: "2026-12-31",
    rollback: "Keep inventory read-only and disable live database execution.",
    auditRequired: true,
  },
  {
    key: "distribution-core",
    label: "Distributor stock requests and inventory",
    enabledByDefault: false,
    owner: "Distribution and Logistics",
    cohort: "internal-only",
    dependencies: ["command-framework-write", "baseline-telemetry"],
    metrics: ["stock-request-throughput", "distribution-denial-rate"],
    expiresAt: null,
    rollback:
      "Disable distribution-core first. Navigation, direct routes, and every DMS command fail closed; movement and request history is retained, never deleted.",
    auditRequired: true,
  },
  {
    key: "integration-operations-centre",
    label: "Integration operations centre",
    enabledByDefault: false,
    owner: "Platform Integrations",
    cohort: "internal-only",
    dependencies: ["baseline-telemetry"],
    metrics: ["integration-readiness-reads"],
    expiresAt: null,
    rollback: "Disable the flag; /admin/integrations returns to the unavailable page.",
    auditRequired: true,
  },
  {
    key: "learning-lesson-authoring",
    label: "Insight Hub lesson authoring",
    enabledByDefault: false,
    owner: "Enablement",
    cohort: "internal-only",
    dependencies: ["command-framework-write"],
    metrics: ["lesson-authoring-writes"],
    expiresAt: null,
    rollback: "Disable the flag; the lesson authoring action disappears from Learning admin.",
    auditRequired: true,
  },
  {
    key: "product-recommendations",
    label: "Product recommendations",
    enabledByDefault: false,
    owner: "Distribution and Logistics",
    cohort: "internal-only",
    dependencies: ["baseline-telemetry"],
    metrics: ["recommendation-impressions", "recommendation-accepts"],
    expiresAt: null,
    rollback:
      "Disable the flag; every recommendation panel disappears and no recommendation query runs. Nothing else changes — recommendations are read-only and derive from history that stays put.",
    auditRequired: true,
  },
  {
    key: "gyftr-fulfillment",
    label: "GyFTR digital reward fulfillment",
    enabledByDefault: false,
    owner: "Rewards",
    cohort: "internal-only",
    dependencies: ["command-framework-write"],
    metrics: ["voucher-issue-success", "voucher-issue-failure"],
    expiresAt: null,
    rollback:
      "Disable the flag; digital rewards become unrequestable and unapprovable, and no provider call is made.",
    auditRequired: true,
  },
] as const;

export type FeatureFlagContext = {
  role: string;
  tenantId: string | null;
  isSuperAdmin: boolean;
  environment: "development" | "preview" | "production";
};

export function isFeatureFlagEnabled(
  key: FeatureFlagKey,
  context: FeatureFlagContext,
  overrides: Partial<Record<FeatureFlagKey, boolean>> = {},
) {
  const registryEntry = FEATURE_FLAG_REGISTRY.find((entry) => entry.key === key);
  if (!registryEntry) {
    throw new Error(`Unknown feature flag: ${key}`);
  }

  const override = overrides[key];
  if (override !== undefined) {
    return override;
  }

  if (context.isSuperAdmin && key === "active-context-switch") {
    return registryEntry.enabledByDefault;
  }

  return registryEntry.enabledByDefault;
}

export function assertFeatureFlagEnabled(
  key: FeatureFlagKey,
  context: FeatureFlagContext,
  overrides: Partial<Record<FeatureFlagKey, boolean>> = {},
) {
  if (!isFeatureFlagEnabled(key, context, overrides)) {
    throw new Error(`Feature flag disabled: ${key}`);
  }
}

export type FeatureFlagSeedRow = {
  flag_key: FeatureFlagKey;
  label: string;
  enabled: boolean;
  owner: string;
  cohort: string;
  dependencies: string[];
  metrics: string[];
  expires_at: string | null;
  rollback: string;
  audit_required: boolean;
  is_seed: boolean;
};

export function buildFeatureFlagSeedRows(): FeatureFlagSeedRow[] {
  return FEATURE_FLAG_REGISTRY.map((entry) => ({
    flag_key: entry.key,
    label: entry.label,
    enabled: entry.enabledByDefault,
    owner: entry.owner,
    cohort: entry.cohort,
    dependencies: [...entry.dependencies],
    metrics: [...entry.metrics],
    expires_at: entry.expiresAt,
    rollback: entry.rollback,
    audit_required: entry.auditRequired,
    is_seed: true,
  }));
}
