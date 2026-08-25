import {
  INVENTORY_MOVEMENT_TYPES,
  STOCK_LOCATION_TYPES,
  STOCK_REQUEST_PRIORITIES,
  STOCK_REQUEST_STATUSES,
} from "@/domain/contracts/distribution";
import {
  ASSIGNMENT_STATUSES,
  DEAL_STAGES,
  DOCUMENT_PURPOSE_CATEGORIES,
  DOCUMENT_VISIBILITY_CLASSES,
  GEOGRAPHY_NODE_TYPES,
  LEAD_STATUSES,
  PARTNER_LIFECYCLE_STATUSES,
  REWARD_STATUSES,
  ROLE_KEYS,
  SHIPMENT_STATUSES,
  TEAM_DOMAINS,
  TASK_STATUSES,
  TICKET_STATUSES,
} from "@/domain/contracts/taxonomy";
import { isGovernedLookupField, listGovernedLookupFields } from "@/domain/contracts/reference-data";
import { WORLD_CURRENCY_CODES } from "@/domain/contracts/world-geography";

export type InventoryRow = Record<string, unknown>;
export type InventoryTables = Record<string, InventoryRow[]>;

export type DuplicateCandidate = {
  fields: string[];
  signature: string;
  count: number;
  exampleIds: string[];
};

export type InventoryIssue = {
  kind:
    | "null-rate"
    | "invalid-enum"
    | "duplicate"
    | "unknown-reference-field"
    | "orphaned-relationship"
    | "string-money"
    | "unsafe-link"
    | "demo-test-row";
  table: string;
  field?: string;
  message: string;
  count: number;
  examples: string[];
};

export type TableInventoryReport = {
  table: string;
  rowCount: number;
  nullRates: Record<string, number>;
  duplicateCandidates: DuplicateCandidate[];
  unknownEnumValues: Record<string, string[]>;
  unresolvedGeographyStrings: Record<string, string[]>;
  orphanedRelationships: Record<string, string[]>;
  stringMoneyValues: Record<string, string[]>;
  unsafePublicLinks: Record<string, string[]>;
  demoTestRows: number;
  dataOwners: string[];
  sourceFields: string[];
};

export type InventoryReport = {
  generatedAt: string;
  source: string;
  tables: TableInventoryReport[];
  issues: InventoryIssue[];
  summary: {
    tableCount: number;
    rowCount: number;
    issueCount: number;
    demoTestRowCount: number;
  };
};

type TableSpec = {
  table: string;
  uniqueKeySets?: readonly (readonly string[])[];
  enumFields?: Record<string, readonly string[]>;
  geographyFields?: readonly string[];
  moneyFields?: readonly string[];
  relationshipFields?: readonly {
    field: string;
    refTable: string;
    refField?: string;
    required?: boolean;
  }[];
  ownerFields?: readonly string[];
  sourceFields?: readonly string[];
};

const COUNTRY_CODES = [
  "IN",
  "US",
  "SG",
  "AE",
  "SA",
  "QA",
  "KW",
  "OM",
  "BH",
  "MY",
  "ID",
  "PH",
  "TH",
  "VN",
  "ZA",
  "NG",
  "KE",
  "GB",
  "CA",
  "AU",
] as const;

const STANDARD_GEO_VALUES = new Set([
  ...COUNTRY_CODES,
  "India",
  "United States",
  "Singapore",
  "United Arab Emirates",
  "Saudi Arabia",
  "Qatar",
  "Kuwait",
  "Oman",
  "Bahrain",
  "Malaysia",
  "Indonesia",
  "Philippines",
  "Thailand",
  "Vietnam",
  "South Africa",
  "Nigeria",
  "Kenya",
  "United Kingdom",
  "Canada",
  "Australia",
  "West",
  "East",
  "North",
  "South",
  "India West",
  "India East",
  "India North",
  "India South",
  "APAC",
  "EMEA",
  "Americas",
]);

const TABLE_SPECS: readonly TableSpec[] = [
  {
    table: "profiles",
    uniqueKeySets: [["email"]],
    enumFields: { partner_status: PARTNER_LIFECYCLE_STATUSES },
    ownerFields: ["email", "partner_id"],
    sourceFields: ["is_seed", "must_reset_password"],
  },
  {
    table: "user_roles",
    uniqueKeySets: [["user_id", "role"]],
    enumFields: { role: ROLE_KEYS },
    relationshipFields: [{ field: "user_id", refTable: "profiles" }],
  },
  {
    table: "governed_tenants",
    uniqueKeySets: [["tenant_id"]],
    enumFields: { tenant_kind: ["livey_organization", "partner"] },
  },
  {
    table: "geography_nodes",
    uniqueKeySets: [["node_code"]],
    enumFields: { node_type: GEOGRAPHY_NODE_TYPES },
    relationshipFields: [
      { field: "tenant_id", refTable: "governed_tenants", refField: "tenant_id" },
      { field: "organization_tenant_id", refTable: "governed_tenants", refField: "tenant_id" },
      { field: "parent_node_id", refTable: "geography_nodes", refField: "node_id" },
    ],
  },
  {
    table: "geography_node_aliases",
    uniqueKeySets: [["legacy_value"]],
    relationshipFields: [{ field: "node_id", refTable: "geography_nodes", refField: "node_id" }],
  },
  {
    table: "assignments",
    uniqueKeySets: [["assignment_id"]],
    enumFields: { status: ASSIGNMENT_STATUSES, team_domain: TEAM_DOMAINS },
    relationshipFields: [
      { field: "user_id", refTable: "profiles" },
      { field: "tenant_id", refTable: "governed_tenants", refField: "tenant_id" },
      { field: "organization_tenant_id", refTable: "governed_tenants", refField: "tenant_id" },
      { field: "geography_ceiling_node_id", refTable: "geography_nodes", refField: "node_id" },
      { field: "partner_id", refTable: "partners" },
      { field: "manager_assignment_id", refTable: "assignments", refField: "assignment_id" },
      { field: "approver_user_id", refTable: "profiles" },
      { field: "predecessor_assignment_id", refTable: "assignments", refField: "assignment_id" },
      { field: "successor_assignment_id", refTable: "assignments", refField: "assignment_id" },
    ],
    sourceFields: ["is_seed"],
  },
  {
    table: "assignment_events",
    uniqueKeySets: [["event_id"]],
    relationshipFields: [
      { field: "assignment_id", refTable: "assignments", refField: "assignment_id" },
      { field: "actor_user_id", refTable: "profiles" },
      { field: "actor_assignment_id", refTable: "assignments", refField: "assignment_id" },
      { field: "predecessor_assignment_id", refTable: "assignments", refField: "assignment_id" },
      { field: "successor_assignment_id", refTable: "assignments", refField: "assignment_id" },
    ],
    sourceFields: ["is_seed"],
  },
  {
    table: "active_contexts",
    uniqueKeySets: [["context_id"]],
    relationshipFields: [
      { field: "user_id", refTable: "profiles" },
      { field: "assignment_id", refTable: "assignments", refField: "assignment_id" },
      { field: "tenant_id", refTable: "governed_tenants", refField: "tenant_id" },
      { field: "organization_tenant_id", refTable: "governed_tenants", refField: "tenant_id" },
    ],
    sourceFields: ["is_seed"],
  },
  {
    table: "partners",
    uniqueKeySets: [["owner_user_id"]],
    enumFields: { status: PARTNER_LIFECYCLE_STATUSES },
    geographyFields: ["country", "state"],
    moneyFields: ["annual_turnover"],
    relationshipFields: [{ field: "owner_user_id", refTable: "profiles" }],
    ownerFields: ["company_name", "owner_user_id"],
    sourceFields: ["is_seed"],
  },
  {
    table: "document_blobs",
    uniqueKeySets: [["file_path"]],
    ownerFields: ["bucket", "file_name"],
    sourceFields: ["is_seed"],
  },
  {
    table: "partner_documents",
    uniqueKeySets: [["partner_id", "file_path"]],
    enumFields: { doc_type: DOCUMENT_PURPOSE_CATEGORIES },
    relationshipFields: [
      { field: "partner_id", refTable: "partners" },
      { field: "uploaded_by", refTable: "profiles" },
      { field: "file_path", refTable: "document_blobs", refField: "file_path" },
    ],
    sourceFields: ["is_seed"],
  },
  {
    table: "deal_documents",
    uniqueKeySets: [["deal_id", "file_path"]],
    enumFields: { doc_type: DOCUMENT_PURPOSE_CATEGORIES },
    relationshipFields: [
      { field: "deal_id", refTable: "portal_deals" },
      { field: "partner_id", refTable: "partners" },
      { field: "uploaded_by", refTable: "profiles" },
      { field: "file_path", refTable: "document_blobs", refField: "file_path" },
    ],
    sourceFields: ["is_seed"],
  },
  {
    table: "portal_deals",
    uniqueKeySets: [["account_name", "contact_name", "product", "close_date"]],
    enumFields: { stage: DEAL_STAGES, status: DEAL_STAGES, currency_code: WORLD_CURRENCY_CODES },
    geographyFields: ["country", "region"],
    moneyFields: ["amount", "customer_budget", "amount_value", "amount_usd"],
    relationshipFields: [
      { field: "user_id", refTable: "profiles" },
      { field: "partner_id", refTable: "partners" },
      { field: "customer_id", refTable: "portal_customers" },
      { field: "poc_profile_id", refTable: "profiles" },
    ],
    ownerFields: ["account_name", "contact_name", "owner_name"],
    sourceFields: ["is_seed", "is_hidden_to_team"],
  },
  {
    table: "portal_deal_collaborators",
    uniqueKeySets: [["deal_id", "user_id"]],
    relationshipFields: [
      { field: "deal_id", refTable: "portal_deals" },
      { field: "user_id", refTable: "profiles" },
    ],
    sourceFields: ["is_seed"],
  },
  {
    table: "portal_customers",
    uniqueKeySets: [["company_name", "region"]],
    geographyFields: ["region"],
    relationshipFields: [
      { field: "user_id", refTable: "profiles" },
      { field: "partner_id", refTable: "partners" },
    ],
    sourceFields: ["is_seed"],
  },
  {
    table: "portal_catalog_items",
    uniqueKeySets: [["sku"]],
    enumFields: { catalog_kind: ["product", "combo"] },
    moneyFields: ["list_price", "margin"],
    sourceFields: ["is_seed"],
  },
  {
    table: "portal_team_members",
    uniqueKeySets: [["email"]],
    enumFields: { portal_role: ROLE_KEYS, status: ["active", "invited", "inactive"] },
    sourceFields: ["is_seed"],
  },
  {
    table: "portal_audit_events",
    uniqueKeySets: [["action", "target_type", "target_name", "created_at"]],
    enumFields: { severity: ["low", "medium", "high", "critical"] },
    sourceFields: ["is_seed"],
  },
  {
    table: "reward_catalog_items",
    uniqueKeySets: [["title"]],
    enumFields: { availability: ["available", "limited", "sold_out"] },
    sourceFields: ["is_seed"],
  },
  {
    table: "reward_point_events",
    relationshipFields: [
      { field: "user_id", refTable: "profiles" },
      { field: "partner_id", refTable: "partners" },
      { field: "approved_by", refTable: "profiles" },
    ],
    sourceFields: ["is_seed"],
  },
  {
    table: "reward_redemptions",
    enumFields: { status: REWARD_STATUSES },
    relationshipFields: [
      { field: "reward_id", refTable: "reward_catalog_items" },
      { field: "user_id", refTable: "profiles" },
      { field: "partner_id", refTable: "partners" },
      { field: "approved_by", refTable: "profiles" },
    ],
    sourceFields: ["is_seed"],
  },
  {
    table: "lookup_values",
    uniqueKeySets: [["field_name", "value_key"]],
    enumFields: {},
    sourceFields: ["is_seed", "domain_key", "value_version"],
  },
  {
    table: "feature_flags",
    uniqueKeySets: [["flag_key"]],
    sourceFields: ["is_seed"],
  },
  {
    table: "domain_activity_events",
    sourceFields: ["correlation_id", "event_name"],
  },
  {
    table: "command_outbox",
    uniqueKeySets: [["outbox_id"]],
    sourceFields: ["correlation_id", "idempotency_key", "status"],
  },
  {
    table: "command_inbox",
    uniqueKeySets: [["source", "source_message_id"]],
    sourceFields: ["correlation_id", "status"],
  },
  {
    table: "support_tickets",
    uniqueKeySets: [["created_by_name", "subject", "created_at"]],
    enumFields: { status: TICKET_STATUSES, priority: ["low", "medium", "high", "critical"] },
    relationshipFields: [
      { field: "partner_id", refTable: "partners" },
      { field: "created_by", refTable: "profiles" },
    ],
    sourceFields: ["is_seed"],
  },
  {
    table: "support_ticket_comments",
    relationshipFields: [
      { field: "ticket_id", refTable: "support_tickets" },
      { field: "author_id", refTable: "profiles" },
    ],
    sourceFields: ["is_seed"],
  },
  {
    table: "notifications",
    relationshipFields: [
      { field: "user_id", refTable: "profiles" },
      { field: "partner_id", refTable: "partners" },
    ],
  },
  // --- Distribution (DMS), product.md §24 --------------------------------
  {
    table: "stock_locations",
    uniqueKeySets: [["location_code"]],
    enumFields: { location_type: STOCK_LOCATION_TYPES },
    relationshipFields: [
      { field: "tenant_id", refTable: "governed_tenants", refField: "tenant_id" },
      { field: "organization_tenant_id", refTable: "governed_tenants", refField: "tenant_id" },
      { field: "geography_node_id", refTable: "geography_nodes", refField: "node_id" },
      { field: "distributor_assignment_id", refTable: "assignments", refField: "assignment_id" },
      { field: "custodian_assignment_id", refTable: "assignments", refField: "assignment_id" },
    ],
  },
  {
    table: "stock_requests",
    uniqueKeySets: [["human_id"], ["idempotency_key"]],
    enumFields: { status: STOCK_REQUEST_STATUSES, priority: STOCK_REQUEST_PRIORITIES },
    relationshipFields: [
      { field: "distributor_assignment_id", refTable: "assignments", refField: "assignment_id" },
      { field: "manager_assignment_id", refTable: "assignments", refField: "assignment_id" },
      { field: "requester_user_id", refTable: "profiles" },
      { field: "destination_location_id", refTable: "stock_locations" },
      { field: "deal_id", refTable: "portal_deals" },
      { field: "customer_id", refTable: "portal_customers" },
    ],
  },
  {
    table: "stock_request_lines",
    // A SKU may appear at most once per request (§24.3).
    uniqueKeySets: [["request_id", "product_sku_id"]],
    relationshipFields: [
      { field: "request_id", refTable: "stock_requests" },
      { field: "source_location_id", refTable: "stock_locations" },
    ],
  },
  {
    table: "inventory_balances",
    // The projection is one row per (SKU, location); a duplicate means two
    // rows disagree about the same physical shelf.
    uniqueKeySets: [["product_sku_id", "location_id"]],
    relationshipFields: [{ field: "location_id", refTable: "stock_locations" }],
  },
  {
    table: "inventory_movements",
    uniqueKeySets: [["idempotency_key"]],
    enumFields: { movement_type: INVENTORY_MOVEMENT_TYPES },
    relationshipFields: [
      { field: "source_location_id", refTable: "stock_locations" },
      { field: "destination_location_id", refTable: "stock_locations" },
      { field: "request_line_id", refTable: "stock_request_lines" },
      { field: "actor_user_id", refTable: "profiles" },
      { field: "assignment_id", refTable: "assignments", refField: "assignment_id" },
    ],
  },
  {
    table: "stock_request_transitions",
    enumFields: { to_status: STOCK_REQUEST_STATUSES },
    relationshipFields: [
      { field: "request_id", refTable: "stock_requests" },
      { field: "actor_user_id", refTable: "profiles" },
      { field: "assignment_id", refTable: "assignments", refField: "assignment_id" },
    ],
  },
];

function isEmpty(value: unknown) {
  return value === null || value === undefined || value === "";
}

function asString(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function hasTestMarker(row: InventoryRow) {
  return Object.values(row).some((value) => {
    if (typeof value !== "string") return false;
    const lower = value.toLowerCase();
    return (
      lower.includes("demo") ||
      lower.includes("test") ||
      lower.includes("sample") ||
      lower.includes("fixture")
    );
  });
}

function detectUnsafeLinks(
  row: InventoryRow,
  allowlist = ["https://res.cloudinary.com/", "http://localhost", "https://localhost"],
) {
  return Object.entries(row)
    .filter(([, value]) => typeof value === "string")
    .filter(([, value]) => {
      const text = value as string;
      if (!/^https?:\/\//i.test(text)) return false;
      return !allowlist.some((prefix) => text.startsWith(prefix));
    })
    .map(([field, value]) => `${field}=${value}`);
}

function buildDuplicateCandidates(
  rows: InventoryRow[],
  keySets: readonly (readonly string[])[] = [],
) {
  const candidates: DuplicateCandidate[] = [];
  for (const fields of keySets) {
    const counts = new Map<string, { count: number; exampleIds: string[] }>();
    for (const row of rows) {
      const signature = fields.map((field) => asString(row[field])).join("|");
      const current = counts.get(signature) ?? { count: 0, exampleIds: [] };
      current.count += 1;
      const id = asString(row.id ?? row[fields[0] ?? "id"]);
      if (id && current.exampleIds.length < 3) {
        current.exampleIds.push(id);
      }
      counts.set(signature, current);
    }

    for (const [signature, entry] of counts.entries()) {
      if (entry.count > 1 && signature.trim().length > 0) {
        candidates.push({
          fields: [...fields],
          signature,
          count: entry.count,
          exampleIds: entry.exampleIds,
        });
      }
    }
  }
  return candidates;
}

function rateOfNull(rows: InventoryRow[], field: string) {
  if (rows.length === 0) return 0;
  const nullCount = rows.filter((row) => isEmpty(row[field])).length;
  return Math.round((nullCount / rows.length) * 10000) / 100;
}

function computeInvalidValues(rows: InventoryRow[], field: string, allowed: readonly string[]) {
  const invalid = new Set<string>();
  for (const row of rows) {
    const value = row[field];
    if (isEmpty(value)) continue;
    const normalized = asString(value);
    if (!allowed.includes(normalized)) {
      invalid.add(normalized);
    }
  }
  return [...invalid].sort();
}

function detectStringMoneyValues(rows: InventoryRow[], fields: readonly string[]) {
  const found: Record<string, string[]> = {};
  for (const field of fields) {
    const values = rows
      .map((row) => row[field])
      .filter((value) => typeof value === "string")
      .map((value) => value as string)
      .filter((value) => /[$₹€£,]|^\s*-?\d+(\.\d+)?\s*$/.test(value));
    if (values.length > 0) {
      found[field] = [...new Set(values)].slice(0, 10);
    }
  }
  return found;
}

function detectUnknownReferenceFields(rows: InventoryRow[]) {
  const unknownFields = new Set<string>();
  for (const row of rows) {
    for (const [fieldName, value] of Object.entries(row)) {
      if (
        fieldName === "field_name" &&
        typeof value === "string" &&
        !isGovernedLookupField(value)
      ) {
        unknownFields.add(value);
      }
    }
  }
  return [...unknownFields].sort();
}

function summarizeOwners(rows: InventoryRow[], ownerFields: readonly string[] = []) {
  const owners = new Set<string>();
  for (const field of ownerFields) {
    for (const row of rows) {
      const value = row[field];
      if (!isEmpty(value)) {
        owners.add(`${field}:${asString(value)}`);
      }
    }
  }
  return [...owners].sort();
}

function buildRelationshipOrphans(
  rows: InventoryRow[],
  snapshot: InventoryTables,
  relationships: readonly NonNullable<TableSpec["relationshipFields"]>[number][],
) {
  const orphaned: Record<string, string[]> = {};
  for (const relationship of relationships) {
    const parentRows = snapshot[relationship.refTable] ?? [];
    const parentValues = new Set(
      parentRows.map((row) => asString(row[relationship.refField ?? "id"])),
    );
    const orphans = rows
      .filter((row) => !isEmpty(row[relationship.field]))
      .filter((row) => !parentValues.has(asString(row[relationship.field])))
      .map((row) => asString(row[relationship.field]));
    if (orphans.length > 0) {
      orphaned[relationship.field] = [...new Set(orphans)].slice(0, 10);
    }
  }
  return orphaned;
}

function buildGeographyIssues(rows: InventoryRow[], fields: readonly string[]) {
  const unresolved: Record<string, string[]> = {};
  for (const field of fields) {
    const values = rows
      .map((row) => row[field])
      .filter((value) => !isEmpty(value))
      .map((value) => asString(value))
      .filter((value) => !STANDARD_GEO_VALUES.has(value) && !/^[A-Z]{2}(-[A-Z0-9]+)?$/.test(value));
    if (values.length > 0) {
      unresolved[field] = [...new Set(values)].slice(0, 10);
    }
  }
  return unresolved;
}

export function analyzeInventoryTables(snapshot: InventoryTables, source: string): InventoryReport {
  const issues: InventoryIssue[] = [];
  const tableReports = TABLE_SPECS.map((spec) => {
    const rows = snapshot[spec.table] ?? [];
    const allFields = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        allFields.add(key);
      }
    }

    const nullRates: Record<string, number> = {};
    for (const field of allFields) {
      nullRates[field] = rateOfNull(rows, field);
      if (nullRates[field] > 0) {
        issues.push({
          kind: "null-rate",
          table: spec.table,
          field,
          message: `${field} is null or empty for ${nullRates[field]}% of rows`,
          count: Math.round((nullRates[field] / 100) * rows.length),
          examples: [],
        });
      }
    }

    const duplicateCandidates = buildDuplicateCandidates(rows, spec.uniqueKeySets ?? []);
    for (const duplicate of duplicateCandidates) {
      issues.push({
        kind: "duplicate",
        table: spec.table,
        field: duplicate.fields.join(","),
        message: `Duplicate candidate for ${duplicate.fields.join(", ")}`,
        count: duplicate.count,
        examples: duplicate.exampleIds,
      });
    }

    const unknownEnumValues: Record<string, string[]> = {};
    for (const [field, allowed] of Object.entries(spec.enumFields ?? {})) {
      const invalidValues = computeInvalidValues(rows, field, allowed);
      if (invalidValues.length > 0) {
        unknownEnumValues[field] = invalidValues;
        issues.push({
          kind: "invalid-enum",
          table: spec.table,
          field,
          message: `${field} contains unsupported values: ${invalidValues.join(", ")}`,
          count: invalidValues.length,
          examples: invalidValues,
        });
      }
    }

    if (spec.table === "lookup_values") {
      const unknownReferenceFields = detectUnknownReferenceFields(rows);
      if (unknownReferenceFields.length > 0) {
        issues.push({
          kind: "unknown-reference-field",
          table: spec.table,
          field: "field_name",
          message: `lookup_values contains ungoverned field names: ${unknownReferenceFields.join(", ")}`,
          count: unknownReferenceFields.length,
          examples: unknownReferenceFields,
        });
      }
    }

    const unresolvedGeographyStrings = buildGeographyIssues(rows, spec.geographyFields ?? []);
    for (const [field, values] of Object.entries(unresolvedGeographyStrings)) {
      issues.push({
        kind: "invalid-enum",
        table: spec.table,
        field,
        message: `${field} contains unresolved geography strings: ${values.join(", ")}`,
        count: values.length,
        examples: values,
      });
    }

    const orphanedRelationships = buildRelationshipOrphans(
      rows,
      snapshot,
      spec.relationshipFields ?? [],
    );
    for (const [field, values] of Object.entries(orphanedRelationships)) {
      issues.push({
        kind: "orphaned-relationship",
        table: spec.table,
        field,
        message: `${field} points at missing parent rows`,
        count: values.length,
        examples: values,
      });
    }

    const stringMoneyValues = detectStringMoneyValues(rows, spec.moneyFields ?? []);
    for (const [field, values] of Object.entries(stringMoneyValues)) {
      issues.push({
        kind: "string-money",
        table: spec.table,
        field,
        message: `${field} stores string-form money or money-like values`,
        count: values.length,
        examples: values,
      });
    }

    const unsafePublicLinks: Record<string, string[]> = {};
    for (const row of rows) {
      const found = detectUnsafeLinks(row);
      if (found.length > 0) {
        for (const item of found) {
          const [field, value] = item.split("=", 2);
          const current = unsafePublicLinks[field] ?? [];
          current.push(value ?? item);
          unsafePublicLinks[field] = current;
        }
      }
    }
    for (const [field, values] of Object.entries(unsafePublicLinks)) {
      issues.push({
        kind: "unsafe-link",
        table: spec.table,
        field,
        message: `${field} contains public or non-allowlisted links`,
        count: values.length,
        examples: [...new Set(values)].slice(0, 10),
      });
    }

    const demoTestRows = rows.filter(hasTestMarker).length;
    if (demoTestRows > 0) {
      issues.push({
        kind: "demo-test-row",
        table: spec.table,
        message: `${demoTestRows} row(s) look like demo/test content`,
        count: demoTestRows,
        examples: rows
          .filter(hasTestMarker)
          .map((row) => asString(row.id ?? row.name ?? row.title))
          .slice(0, 10),
      });
    }

    return {
      table: spec.table,
      rowCount: rows.length,
      nullRates,
      duplicateCandidates,
      unknownEnumValues,
      unresolvedGeographyStrings,
      orphanedRelationships,
      stringMoneyValues,
      unsafePublicLinks,
      demoTestRows,
      dataOwners: summarizeOwners(rows, spec.ownerFields ?? []),
      sourceFields: spec.sourceFields ? [...spec.sourceFields] : [],
    } satisfies TableInventoryReport;
  });

  const rowCount = tableReports.reduce((sum, table) => sum + table.rowCount, 0);
  const demoTestRowCount = tableReports.reduce((sum, table) => sum + table.demoTestRows, 0);

  return {
    generatedAt: new Date().toISOString(),
    source,
    tables: tableReports,
    issues,
    summary: {
      tableCount: tableReports.length,
      rowCount,
      issueCount: issues.length,
      demoTestRowCount,
    },
  };
}

export function formatInventoryReport(report: InventoryReport) {
  const lines = [
    `Inventory report for ${report.source}`,
    `Tables: ${report.summary.tableCount} · Rows: ${report.summary.rowCount} · Issues: ${report.summary.issueCount}`,
  ];

  for (const table of report.tables) {
    lines.push(`- ${table.table}: ${table.rowCount} row(s)`);
    const duplicateCount = table.duplicateCandidates.length;
    const invalidCount = Object.values(table.unknownEnumValues).reduce(
      (sum, values) => sum + values.length,
      0,
    );
    const geoCount = Object.values(table.unresolvedGeographyStrings).reduce(
      (sum, values) => sum + values.length,
      0,
    );
    const orphanCount = Object.values(table.orphanedRelationships).reduce(
      (sum, values) => sum + values.length,
      0,
    );
    const moneyCount = Object.values(table.stringMoneyValues).reduce(
      (sum, values) => sum + values.length,
      0,
    );
    const linkCount = Object.values(table.unsafePublicLinks).reduce(
      (sum, values) => sum + values.length,
      0,
    );
    if (
      duplicateCount ||
      invalidCount ||
      geoCount ||
      orphanCount ||
      moneyCount ||
      linkCount ||
      table.demoTestRows
    ) {
      lines.push(
        `  duplicates=${duplicateCount} invalid=${invalidCount} geography=${geoCount} orphaned=${orphanCount} money=${moneyCount} unsafeLinks=${linkCount} demoRows=${table.demoTestRows}`,
      );
    }
  }

  return lines.join("\n");
}

export async function loadInventorySnapshotFromFixtureJson(
  jsonText: string,
): Promise<InventoryTables> {
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  const tables: InventoryTables = {};
  for (const [table, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) {
      tables[table] = value.filter(
        (row): row is InventoryRow => !!row && typeof row === "object",
      ) as InventoryRow[];
    }
  }
  return tables;
}

export function emptyInventorySnapshot() {
  return Object.fromEntries(TABLE_SPECS.map((spec) => [spec.table, []])) as InventoryTables;
}

export function listInventoryTables() {
  return TABLE_SPECS.map((spec) => spec.table);
}
