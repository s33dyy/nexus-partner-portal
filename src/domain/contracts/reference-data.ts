import type { Pool } from "pg";

import {
  ASSIGNMENT_STATUSES,
  DEAL_STAGES,
  DOCUMENT_PURPOSE_CATEGORIES,
  DOCUMENT_VISIBILITY_CLASSES,
  GEOGRAPHY_NODE_TYPES,
  HUMAN_READABLE_ID_NAMESPACES,
  LEAD_STATUSES,
  PARTICIPANT_TYPES,
  REWARD_STATUSES,
  ROLE_KEYS,
  SHIPMENT_STATUSES,
  TEAM_DOMAINS,
  TAG_TYPES,
  TASK_STATUSES,
  TICKET_STATUSES,
  type CurrencyCode,
} from "./taxonomy";

export type ReferenceDataItem = {
  fieldName: string;
  domainKey: string;
  valueKey: string;
  value: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  retiredAt: string | null;
  source: string;
  metadata: Record<string, unknown>;
};

export type ReferenceDataBucket = {
  fieldName: string;
  domainKey: string;
  owner: string;
  items: readonly Omit<ReferenceDataItem, "fieldName" | "domainKey" | "source">[];
};

const EFFECTIVE_FROM = "2026-07-29";

const COUNTRY_CODES = [
  ["IN", "India", "Asia"],
  ["US", "United States", "Americas"],
  ["SG", "Singapore", "APAC"],
  ["AE", "United Arab Emirates", "EMEA"],
  ["SA", "Saudi Arabia", "EMEA"],
  ["QA", "Qatar", "EMEA"],
  ["KW", "Kuwait", "EMEA"],
  ["OM", "Oman", "EMEA"],
  ["BH", "Bahrain", "EMEA"],
  ["MY", "Malaysia", "APAC"],
  ["ID", "Indonesia", "APAC"],
  ["PH", "Philippines", "APAC"],
  ["TH", "Thailand", "APAC"],
  ["VN", "Vietnam", "APAC"],
  ["ZA", "South Africa", "EMEA"],
  ["NG", "Nigeria", "EMEA"],
  ["KE", "Kenya", "EMEA"],
  ["GB", "United Kingdom", "EMEA"],
  ["CA", "Canada", "Americas"],
  ["AU", "Australia", "APAC"],
] as const;

const PROVINCE_STATE_CODES = [
  ["IN-GJ", "Gujarat", "IN"],
  ["IN-MH", "Maharashtra", "IN"],
  ["IN-DL", "Delhi", "IN"],
  ["IN-TN", "Tamil Nadu", "IN"],
  ["IN-KA", "Karnataka", "IN"],
  ["IN-WB", "West Bengal", "IN"],
  ["US-CA", "California", "US"],
  ["US-TX", "Texas", "US"],
  ["US-NY", "New York", "US"],
  ["US-WA", "Washington", "US"],
  ["US-FL", "Florida", "US"],
] as const;

const salesRegionItems = [
  { valueKey: "india-west", value: "India West", metadata: { countries: ["IN"] } },
  { valueKey: "india-south", value: "India South", metadata: { countries: ["IN"] } },
  { valueKey: "india-north", value: "India North", metadata: { countries: ["IN"] } },
  { valueKey: "india-east", value: "India East", metadata: { countries: ["IN"] } },
  {
    valueKey: "apac",
    value: "APAC",
    metadata: { countries: ["SG", "MY", "ID", "PH", "TH", "VN", "AU"] },
  },
  {
    valueKey: "emea",
    value: "EMEA",
    metadata: { countries: ["AE", "SA", "QA", "KW", "OM", "BH", "ZA", "NG", "KE", "GB"] },
  },
  { valueKey: "americas", value: "Americas", metadata: { countries: ["US", "CA"] } },
] as const;

export const GOVERNED_REFERENCE_BUCKETS: readonly ReferenceDataBucket[] = [
  {
    // value must stay the exact machine key here (not a "space" display
    // form like the other buckets in this file): LookupCombobox submits
    // `value` directly as the field's stored value, and this feeds
    // user_roles.role, a Postgres enum restricted to super_admin/
    // partner_admin/partner_user. A humanized value would fail enum
    // validation or the identity.change_user_role command's role check.
    fieldName: "users.role",
    domainKey: "role_keys",
    owner: "Identity and Policy",
    items: ROLE_KEYS.map((valueKey) => ({
      valueKey,
      value: valueKey,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: { stable: true },
    })),
  },
  {
    // Same reasoning as "users.role" above: partner.team.tsx does exact
    // string comparisons like `draft.portal_role === "partner_admin"`
    // against this value.
    fieldName: "team.portal_role",
    domainKey: "role_keys",
    owner: "Identity and Policy",
    items: ROLE_KEYS.map((valueKey) => ({
      valueKey,
      value: valueKey,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: { stable: true },
    })),
  },
  {
    fieldName: "team.domain",
    domainKey: "team_domains",
    owner: "Identity and Policy",
    items: TEAM_DOMAINS.map((valueKey) => ({
      valueKey,
      value: valueKey.replace(/_/g, " "),
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: { stable: true },
    })),
  },
  {
    fieldName: "governance.geography_node_type",
    domainKey: "geography_node_types",
    owner: "Governance and Geography",
    items: GEOGRAPHY_NODE_TYPES.map((valueKey) => ({
      valueKey,
      value: valueKey.replace(/_/g, " "),
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: { stable: true },
    })),
  },
  {
    fieldName: "governance.sales_region",
    domainKey: "sales_regions",
    owner: "Governance and Geography",
    items: salesRegionItems.map((entry) => ({
      valueKey: entry.valueKey,
      value: entry.value,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: entry.metadata,
    })),
  },
  {
    fieldName: "governance.country_code",
    domainKey: "country_codes",
    owner: "Governance and Geography",
    items: COUNTRY_CODES.map(([valueKey, value]) => ({
      valueKey,
      value,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: { region: "global" },
    })),
  },
  {
    fieldName: "governance.province_state_code",
    domainKey: "province_state_codes",
    owner: "Governance and Geography",
    items: PROVINCE_STATE_CODES.map(([valueKey, value, countryCode]) => ({
      valueKey,
      value,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: { countryCode },
    })),
  },
  {
    fieldName: "partners.onboarding.business_type",
    domainKey: "business_type",
    owner: "Partner",
    items: [
      "Sole Proprietorship",
      "Partnership",
      "Private Limited",
      "Public Limited",
      "LLP",
      "Other",
    ].map((valueKey) => ({
      valueKey: valueKey.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      value: valueKey,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "partners.onboarding.years_in_business",
    domainKey: "years_in_business",
    owner: "Partner",
    items: ["0-1", "2-3", "4-7", "8-10", "11+"].map((valueKey) => ({
      valueKey: valueKey.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      value: valueKey,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "partners.onboarding.annual_turnover",
    domainKey: "annual_turnover_usd",
    owner: "Partner",
    items: ["<100k", "100k-500k", "500k-1m", "1m-5m", "5m+"].map((valueKey) => ({
      valueKey: valueKey.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      value: valueKey,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: { currencyCode: "USD" satisfies CurrencyCode },
    })),
  },
  {
    fieldName: "partners.onboarding.employee_count",
    domainKey: "employee_count",
    owner: "Partner",
    items: ["1-10", "11-25", "26-50", "51-100", "100+"].map((valueKey) => ({
      valueKey: valueKey.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      value: valueKey,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "partners.onboarding.business_focus",
    domainKey: "business_focus",
    owner: "Partner",
    items: [
      "Installations",
      "Distribution",
      "Retail",
      "Enterprise Sales",
      "Services",
      "Support",
    ].map((valueKey) => ({
      valueKey: valueKey.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      value: valueKey,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "deals.stage",
    domainKey: "deal_stages",
    owner: "CRM",
    items: DEAL_STAGES.map((valueKey, index) => ({
      valueKey,
      value: valueKey,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {
        probability:
          index === 0
            ? 10
            : index === 1
              ? 25
              : index === 2
                ? 35
                : index === 3
                  ? 50
                  : index === 4
                    ? 65
                    : index === 5
                      ? 80
                      : index === 6
                        ? 100
                        : 0,
      },
    })),
  },
  {
    fieldName: "tasks.category",
    domainKey: "task_categories",
    owner: "Work",
    items: ["follow_up", "support", "approval", "training", "implementation", "admin"].map(
      (valueKey) => ({
        valueKey,
        value: valueKey.replace(/_/g, " "),
        version: 1,
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
        retiredAt: null,
        metadata: {},
      }),
    ),
  },
  {
    fieldName: "documents.category",
    domainKey: "document_categories",
    owner: "Protected Files",
    items: DOCUMENT_PURPOSE_CATEGORIES.map((valueKey) => ({
      valueKey,
      value: valueKey.replace(/_/g, " "),
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "support.severity",
    domainKey: "support_severity",
    owner: "Support",
    items: ["sev1", "sev2", "sev3", "sev4"].map((valueKey) => ({
      valueKey,
      value: valueKey.toUpperCase(),
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "support.sla",
    domainKey: "support_sla",
    owner: "Support",
    items: ["4h", "8h", "1d", "2d"].map((valueKey) => ({
      valueKey: valueKey.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      value: valueKey,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "products.reference_key",
    domainKey: "product_reference",
    owner: "CRM",
    items: ["camera", "monitor", "bundle", "installation", "warranty", "subscription"].map(
      (valueKey) => ({
        valueKey,
        value: valueKey.replace(/_/g, " "),
        version: 1,
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
        retiredAt: null,
        metadata: {},
      }),
    ),
  },
  {
    fieldName: "rewards.reference_key",
    domainKey: "reward_reference",
    owner: "Rewards",
    items: REWARD_STATUSES.map((valueKey) => ({
      valueKey,
      value: valueKey.replace(/_/g, " "),
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "integrations.provider",
    domainKey: "integration_reference",
    owner: "Integrations",
    items: ["zohosign", "cloudinary", "postgres", "webhook"].map((valueKey) => ({
      valueKey,
      value: valueKey,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "governance.tag_type",
    domainKey: "tag_types",
    owner: "Governance",
    items: TAG_TYPES.map((valueKey) => ({
      valueKey,
      value: valueKey.replace(/_/g, " "),
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "governance.participant_type",
    domainKey: "participant_types",
    owner: "Governance",
    items: PARTICIPANT_TYPES.map((valueKey) => ({
      valueKey,
      value: valueKey.replace(/_/g, " "),
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "governance.document_visibility",
    domainKey: "document_visibility",
    owner: "Governance",
    items: DOCUMENT_VISIBILITY_CLASSES.map((valueKey) => ({
      valueKey,
      value: valueKey,
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "governance.human_readable_id_namespace",
    domainKey: "id_namespaces",
    owner: "Governance",
    items: HUMAN_READABLE_ID_NAMESPACES.map((valueKey) => ({
      valueKey,
      value: valueKey.replace(/_/g, " "),
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "governance.assignment_status",
    domainKey: "assignment_statuses",
    owner: "Identity and Policy",
    items: ASSIGNMENT_STATUSES.map((valueKey) => ({
      valueKey,
      value: valueKey.replace(/_/g, " "),
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "governance.ticket_status",
    domainKey: "ticket_statuses",
    owner: "Support",
    items: TICKET_STATUSES.map((valueKey) => ({
      valueKey,
      value: valueKey.replace(/_/g, " "),
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "governance.lead_status",
    domainKey: "lead_statuses",
    owner: "CRM",
    items: LEAD_STATUSES.map((valueKey) => ({
      valueKey,
      value: valueKey.replace(/_/g, " "),
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
  {
    fieldName: "governance.shipment_status",
    domainKey: "shipment_statuses",
    owner: "Logistics",
    items: SHIPMENT_STATUSES.map((valueKey) => ({
      valueKey,
      value: valueKey.replace(/_/g, " "),
      version: 1,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: null,
      retiredAt: null,
      metadata: {},
    })),
  },
] as const;

export type GovernedLookupFieldName = (typeof GOVERNED_REFERENCE_BUCKETS)[number]["fieldName"];

export type LookupValueSeedRow = {
  field_name: string;
  value: string;
  value_key: string;
  domain_key: string;
  label_snapshot: string;
  value_version: number;
  effective_from: string;
  effective_to: string | null;
  retired_at: string | null;
  source: string;
  metadata: Record<string, unknown>;
  is_seed: boolean;
};

export function isGovernedLookupField(fieldName: string) {
  return GOVERNED_REFERENCE_BUCKETS.some((bucket) => bucket.fieldName === fieldName);
}

export function listGovernedLookupFields() {
  return GOVERNED_REFERENCE_BUCKETS.map((bucket) => bucket.fieldName);
}

export function buildLookupValueSeedRows(): LookupValueSeedRow[] {
  return GOVERNED_REFERENCE_BUCKETS.flatMap((bucket) =>
    bucket.items.map((item) => ({
      field_name: bucket.fieldName,
      value: item.value,
      value_key: item.valueKey,
      domain_key: bucket.domainKey,
      label_snapshot: item.value,
      value_version: item.version,
      effective_from: item.effectiveFrom,
      effective_to: item.effectiveTo,
      retired_at: item.retiredAt,
      source: "seed",
      metadata: {
        owner: bucket.owner,
        ...item.metadata,
      },
      is_seed: true,
    })),
  );
}

export async function seedGovernedReferenceData(pool: Pick<Pool, "query">) {
  const seedRows = buildLookupValueSeedRows();
  for (const row of seedRows) {
    await pool.query(
      `INSERT INTO lookup_values (
         field_name,
         value,
         value_key,
         domain_key,
         label_snapshot,
         value_version,
         effective_from,
         effective_to,
         retired_at,
         source,
         metadata,
         is_seed
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (field_name, value_key) DO UPDATE SET
         value = EXCLUDED.value,
         domain_key = EXCLUDED.domain_key,
         label_snapshot = EXCLUDED.label_snapshot,
         value_version = EXCLUDED.value_version,
         effective_from = EXCLUDED.effective_from,
         effective_to = EXCLUDED.effective_to,
         retired_at = EXCLUDED.retired_at,
         source = EXCLUDED.source,
         metadata = EXCLUDED.metadata,
         is_seed = EXCLUDED.is_seed`,
      [
        row.field_name,
        row.value,
        row.value_key,
        row.domain_key,
        row.label_snapshot,
        row.value_version,
        row.effective_from,
        row.effective_to,
        row.retired_at,
        row.source,
        JSON.stringify(row.metadata),
        row.is_seed,
      ],
    );
  }
}
