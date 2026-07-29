import { pool } from "@/server/postgres.server";

export type QueryFilter = {
  column: string;
  value: unknown;
  operator: "eq";
};

export type TableQueryLike = {
  table: string;
  operation: "select" | "insert" | "update" | "delete" | "count";
  filters?: QueryFilter[];
  order?: {
    column: string;
    ascending?: boolean;
  };
  values?: Record<string, unknown> | Array<Record<string, unknown>>;
  single?: "single" | "maybeSingle" | null;
};

export type TablePolicyAuthContext = {
  userId: string | null;
  roles: string[];
  partnerId: string | null;
  companyName: string | null;
  hasGovernedContext: boolean;
};

export type GenericTableScopeConstraint = {
  clause: string;
  params: unknown[];
};

export type GenericTableAuthContext = {
  session: { user: { id: string } } | null;
  profile: {
    id: string;
    partner_id: string | null;
    company_name?: string | null;
  } | null;
  roles: string[];
  assignment: unknown | null;
  activeContext: unknown | null;
};

export type GenericTableAccessDecision =
  | { allowed: true; scope: GenericTableScopeConstraint | null }
  | { allowed: false; reason: string; scope: null };

const PUBLIC_READ_TABLES = new Set([
  "lookup_values",
  "portal_catalog_items",
  "reward_catalog_items",
  "portal_news_posts",
]);

const GOVERNANCE_TABLES = new Set([
  "governed_tenants",
  "geography_nodes",
  "geography_node_aliases",
  "assignment_events",
]);

const BOOTSTRAP_SELF_SERVICE_TABLES = new Set(["profiles", "partners"]);
const BOOTSTRAP_READ_ONLY_TABLES = new Set([
  "user_roles",
  "assignments",
  "active_contexts",
  "sessions",
]);

type ScopeSpec =
  | { kind: "column"; column: string; value: string | null; fallbackColumn?: string }
  | { kind: "linked-deal" }
  | { kind: "linked-ticket" };

function isSuperAdmin(auth: TablePolicyAuthContext) {
  return auth.roles.includes("super_admin");
}

function isGenericSuperAdmin(auth: GenericTableAuthContext) {
  return auth.roles.includes("super_admin");
}

function getGenericUserId(auth: GenericTableAuthContext) {
  return auth.session?.user.id ?? auth.profile?.id ?? null;
}

function buildGenericScope(clause: string, params: unknown[] = []): GenericTableScopeConstraint {
  return { clause, params };
}

function getGenericScopeSpec(
  table: string,
  auth: GenericTableAuthContext,
): GenericTableScopeConstraint | null {
  const userId = getGenericUserId(auth);
  const partnerId = auth.profile?.partner_id;
  const companyName = auth.profile?.company_name ?? null;

  switch (table) {
    case "profiles":
      return userId ? buildGenericScope(`"id" = $1`, [userId]) : null;
    case "partners":
      if (partnerId) {
        return buildGenericScope(`"id" = $1`, [partnerId]);
      }
      return userId ? buildGenericScope(`"owner_user_id" = $1`, [userId]) : null;
    case "portal_deals":
    case "portal_customers":
    case "portal_customer_activities":
    case "partner_documents":
    case "deal_documents":
    case "partner_review_notes":
    case "support_tickets":
    case "reward_point_events":
    case "reward_redemptions":
    case "notifications":
      if (partnerId) {
        return buildGenericScope(`"partner_id" = $1`, [partnerId]);
      }
      return userId ? buildGenericScope(`"user_id" = $1`, [userId]) : null;
    case "portal_team_members":
      if (companyName) {
        return buildGenericScope(`"company_name" = $1`, [companyName]);
      }
      return userId ? buildGenericScope(`"user_id" = $1`, [userId]) : null;
    case "portal_deal_collaborators":
      if (partnerId) {
        return buildGenericScope(
          `EXISTS (
            SELECT 1
            FROM "portal_deals" d
            WHERE d."id" = "portal_deal_collaborators"."deal_id"
              AND d."partner_id" = $1
          )`,
          [partnerId],
        );
      }
      return userId
        ? buildGenericScope(
            `EXISTS (
            SELECT 1
            FROM "portal_deals" d
            WHERE d."id" = "portal_deal_collaborators"."deal_id"
              AND d."user_id" = $1
          )`,
            [userId],
          )
        : null;
    case "support_ticket_comments":
      if (partnerId) {
        return buildGenericScope(
          `EXISTS (
            SELECT 1
            FROM "support_tickets" t
            WHERE t."id" = "support_ticket_comments"."ticket_id"
              AND t."partner_id" = $1
          )`,
          [partnerId],
        );
      }
      return userId
        ? buildGenericScope(
            `EXISTS (
            SELECT 1
            FROM "support_tickets" t
            WHERE t."id" = "support_ticket_comments"."ticket_id"
              AND t."created_by" = $1
          )`,
            [userId],
          )
        : null;
    default:
      return null;
  }
}

export function decideGenericTableAccess(
  query: {
    table: string;
    operation: TableQueryLike["operation"];
    single?: "single" | "maybeSingle" | null;
  },
  auth: GenericTableAuthContext,
): GenericTableAccessDecision {
  const isPublicRead = PUBLIC_READ_TABLES.has(query.table);
  const isWrite = query.operation !== "select" && query.operation !== "count";

  if (!auth.session && !isPublicRead) {
    return { allowed: false, reason: "Authentication is required", scope: null };
  }

  if (isPublicRead) {
    if (isWrite && !isGenericSuperAdmin(auth)) {
      return { allowed: false, reason: "Access denied", scope: null };
    }
    return { allowed: true, scope: null };
  }

  if (GOVERNANCE_TABLES.has(query.table) && !isGenericSuperAdmin(auth)) {
    return { allowed: false, reason: "Access denied", scope: null };
  }

  const scope = getGenericScopeSpec(query.table, auth);
  return { allowed: true, scope };
}

function normalizeFilters(filters: QueryFilter[] | undefined): QueryFilter[] {
  return [...(filters ?? [])];
}

function sameFilter(left: QueryFilter, right: QueryFilter) {
  return (
    left.operator === right.operator && left.column === right.column && left.value === right.value
  );
}

function appendScopeFilter(filters: QueryFilter[], column: string, value: string) {
  const existing = filters.find((filter) => filter.column === column);
  if (existing) {
    if (!sameFilter(existing, { column, value, operator: "eq" })) {
      throw new Error("Access denied");
    }
    return filters;
  }

  return [...filters, { column, value, operator: "eq" as const }];
}

function getScopeSpec(table: string, auth: TablePolicyAuthContext): ScopeSpec | null {
  switch (table) {
    case "profiles":
      return { kind: "column", column: "id", value: auth.userId };
    case "user_roles":
    case "assignments":
    case "active_contexts":
    case "sessions":
      return { kind: "column", column: "user_id", value: auth.userId };
    case "partners":
      return auth.partnerId
        ? { kind: "column", column: "id", value: auth.partnerId }
        : { kind: "column", column: "owner_user_id", value: auth.userId };
    case "portal_deals":
    case "portal_customers":
    case "reward_point_events":
    case "reward_redemptions":
    case "notifications":
      return auth.partnerId
        ? { kind: "column", column: "partner_id", value: auth.partnerId, fallbackColumn: "user_id" }
        : { kind: "column", column: "user_id", value: auth.userId };
    case "portal_customer_activities":
      return auth.partnerId
        ? {
            kind: "column",
            column: "partner_id",
            value: auth.partnerId,
            fallbackColumn: "actor_id",
          }
        : { kind: "column", column: "actor_id", value: auth.userId };
    case "partner_documents":
    case "deal_documents":
      return auth.partnerId
        ? {
            kind: "column",
            column: "partner_id",
            value: auth.partnerId,
            fallbackColumn: "uploaded_by",
          }
        : { kind: "column", column: "uploaded_by", value: auth.userId };
    case "partner_review_notes":
      return auth.partnerId
        ? {
            kind: "column",
            column: "partner_id",
            value: auth.partnerId,
            fallbackColumn: "author_id",
          }
        : { kind: "column", column: "author_id", value: auth.userId };
    case "support_tickets":
      return auth.partnerId
        ? {
            kind: "column",
            column: "partner_id",
            value: auth.partnerId,
            fallbackColumn: "created_by",
          }
        : { kind: "column", column: "created_by", value: auth.userId };
    case "portal_team_members":
      return { kind: "column", column: "company_name", value: auth.companyName };
    case "portal_deal_collaborators":
      return { kind: "linked-deal" };
    case "support_ticket_comments":
      return { kind: "linked-ticket" };
    default:
      return null;
  }
}

function extractRowValue(row: Record<string, unknown>, column: string): string | null | undefined {
  const value = row[column];
  if (value == null) {
    return null;
  }
  return String(value);
}

function extractFilterValue(filters: QueryFilter[], column: string): string | null {
  const filter = filters.find((entry) => entry.column === column);
  return filter ? String(filter.value) : null;
}

async function assertLinkedDealAccess(dealId: string, auth: TablePolicyAuthContext) {
  const { rows } = await pool.query(
    `SELECT id, partner_id, user_id
     FROM portal_deals
     WHERE id = $1
     LIMIT 1`,
    [dealId],
  );
  const row = rows[0] as
    | { id: string; partner_id: string | null; user_id: string | null }
    | undefined;

  if (!row) {
    throw new Error("Access denied");
  }

  if (isSuperAdmin(auth)) {
    return;
  }

  if (auth.partnerId && row.partner_id === auth.partnerId) {
    return;
  }

  if (auth.userId && row.user_id === auth.userId) {
    return;
  }

  throw new Error("Access denied");
}

async function assertLinkedTicketAccess(ticketId: string, auth: TablePolicyAuthContext) {
  const { rows } = await pool.query(
    `SELECT id, partner_id, created_by
     FROM support_tickets
     WHERE id = $1
     LIMIT 1`,
    [ticketId],
  );
  const row = rows[0] as
    | { id: string; partner_id: string | null; created_by: string | null }
    | undefined;

  if (!row) {
    throw new Error("Access denied");
  }

  if (isSuperAdmin(auth)) {
    return;
  }

  if (auth.partnerId && row.partner_id === auth.partnerId) {
    return;
  }

  if (auth.userId && row.created_by === auth.userId) {
    return;
  }

  throw new Error("Access denied");
}

function scopeValuesForRow(
  row: Record<string, unknown>,
  scopeSpec: Extract<ScopeSpec, { kind: "column" }>,
  auth: TablePolicyAuthContext,
) {
  const value = scopeSpec.value;
  const fallbackValue = scopeSpec.fallbackColumn ? auth.userId : null;

  if (scopeSpec.column === "company_name") {
    const existing = extractRowValue(row, "company_name");
    if (!existing && value) {
      return { ...row, company_name: value };
    }
    if (value && existing && existing !== value) {
      throw new Error("Access denied");
    }
    return row;
  }

  const existing = extractRowValue(row, scopeSpec.column);
  if (!existing && value) {
    return { ...row, [scopeSpec.column]: value };
  }

  if (value && existing && existing !== value) {
    throw new Error("Access denied");
  }

  if (!existing && scopeSpec.fallbackColumn && fallbackValue) {
    const fallbackExisting = extractRowValue(row, scopeSpec.fallbackColumn);
    if (!fallbackExisting) {
      return { ...row, [scopeSpec.fallbackColumn]: fallbackValue };
    }
    if (fallbackExisting !== fallbackValue) {
      throw new Error("Access denied");
    }
  }

  return row;
}

export async function applyTablePolicy(
  query: TableQueryLike,
  auth: TablePolicyAuthContext,
): Promise<TableQueryLike> {
  const superAdmin = isSuperAdmin(auth);
  const isPublicRead = PUBLIC_READ_TABLES.has(query.table);
  const scopeSpec = getScopeSpec(query.table, auth);
  const isWrite = query.operation !== "select" && query.operation !== "count";

  if (!superAdmin && !auth.userId && !isPublicRead) {
    throw new Error("Access denied");
  }

  if (isPublicRead) {
    if (isWrite && !superAdmin) {
      throw new Error("Access denied");
    }
    return { ...query, filters: normalizeFilters(query.filters) };
  }

  if (BOOTSTRAP_SELF_SERVICE_TABLES.has(query.table)) {
    if (!auth.userId && !superAdmin) {
      throw new Error("Authentication is required");
    }

    if (query.operation === "delete") {
      throw new Error("Access denied");
    }

    if (!scopeSpec || scopeSpec.kind !== "column") {
      throw new Error("Access denied");
    }

    if (scopeSpec.value == null && !superAdmin) {
      throw new Error("Access denied");
    }

    const filters = normalizeFilters(query.filters);
    if (query.operation === "insert") {
      const rows = Array.isArray(query.values) ? query.values : [query.values ?? {}];
      const scopedRows = rows.map((row) => {
        if (typeof row !== "object" || row === null || Array.isArray(row)) {
          throw new Error("Insert values must be objects");
        }
        return scopeValuesForRow(row as Record<string, unknown>, scopeSpec, auth);
      });
      return {
        ...query,
        values: Array.isArray(query.values) ? scopedRows : (scopedRows[0] ?? {}),
        filters,
      };
    }

    if (query.operation === "update") {
      if (
        typeof query.values !== "object" ||
        query.values === null ||
        Array.isArray(query.values)
      ) {
        throw new Error("Update values must be an object");
      }
    }

    return {
      ...query,
      filters: appendScopeFilter(filters, scopeSpec.column, String(scopeSpec.value ?? "")),
    };
  }

  if (BOOTSTRAP_READ_ONLY_TABLES.has(query.table)) {
    if (!auth.userId && !superAdmin) {
      throw new Error("Authentication is required");
    }
    if (query.operation !== "select" && query.operation !== "count") {
      throw new Error("Access denied");
    }
    if (!scopeSpec || scopeSpec.kind !== "column" || scopeSpec.value == null) {
      throw new Error("Access denied");
    }
    return {
      ...query,
      filters: appendScopeFilter(
        normalizeFilters(query.filters),
        scopeSpec.column,
        String(scopeSpec.value),
      ),
    };
  }

  if (GOVERNANCE_TABLES.has(query.table)) {
    if (!superAdmin) {
      throw new Error("Access denied");
    }
    return { ...query, filters: normalizeFilters(query.filters) };
  }

  const filters = normalizeFilters(query.filters);

  if (scopeSpec?.kind === "column") {
    if (scopeSpec.value == null && !superAdmin) {
      throw new Error("Access denied");
    }

    if (query.operation === "insert") {
      const rows = Array.isArray(query.values) ? query.values : [query.values ?? {}];
      const scopedRows = rows.map((row) => {
        if (typeof row !== "object" || row === null || Array.isArray(row)) {
          throw new Error("Insert values must be objects");
        }
        return scopeValuesForRow(row as Record<string, unknown>, scopeSpec, auth);
      });
      return {
        ...query,
        values: Array.isArray(query.values) ? scopedRows : (scopedRows[0] ?? {}),
        filters,
      };
    }

    if (query.operation === "update") {
      if (
        typeof query.values !== "object" ||
        query.values === null ||
        Array.isArray(query.values)
      ) {
        throw new Error("Update values must be an object");
      }
      return {
        ...query,
        filters: appendScopeFilter(filters, scopeSpec.column, String(scopeSpec.value ?? "")),
      };
    }

    if (
      query.operation === "delete" ||
      query.operation === "select" ||
      query.operation === "count"
    ) {
      return {
        ...query,
        filters: appendScopeFilter(filters, scopeSpec.column, String(scopeSpec.value ?? "")),
      };
    }
  }

  if (scopeSpec?.kind === "linked-deal") {
    const dealIds =
      query.operation === "insert"
        ? (Array.isArray(query.values) ? query.values : [query.values ?? {}]).map((row) => {
            if (typeof row !== "object" || row === null || Array.isArray(row)) {
              throw new Error("Insert values must be objects");
            }
            return extractRowValue(row as Record<string, unknown>, "deal_id");
          })
        : [extractFilterValue(filters, "deal_id")];

    if (dealIds.some((dealId) => !dealId)) {
      if (query.operation === "select" || query.operation === "count") {
        if (auth.userId) {
          return {
            ...query,
            filters: appendScopeFilter(filters, "user_id", auth.userId),
          };
        }
      }
      throw new Error("Access denied");
    }

    for (const dealId of dealIds) {
      await assertLinkedDealAccess(dealId as string, auth);
    }
    return { ...query, filters };
  }

  if (scopeSpec?.kind === "linked-ticket") {
    const ticketIds =
      query.operation === "insert"
        ? (Array.isArray(query.values) ? query.values : [query.values ?? {}]).map((row) => {
            if (typeof row !== "object" || row === null || Array.isArray(row)) {
              throw new Error("Insert values must be objects");
            }
            return extractRowValue(row as Record<string, unknown>, "ticket_id");
          })
        : [extractFilterValue(filters, "ticket_id")];

    if (ticketIds.some((ticketId) => !ticketId)) {
      if (query.operation === "select" || query.operation === "count") {
        if (auth.userId) {
          return {
            ...query,
            filters: appendScopeFilter(filters, "author_id", auth.userId),
          };
        }
      }
      throw new Error("Access denied");
    }

    for (const ticketId of ticketIds) {
      await assertLinkedTicketAccess(ticketId as string, auth);
    }
    return { ...query, filters };
  }

  if (query.table === "portal_audit_events") {
    if (query.operation === "select" || query.operation === "count") {
      if (!superAdmin) {
        throw new Error("Access denied");
      }
      return { ...query, filters };
    }

    if (query.operation === "insert") {
      return { ...query, filters };
    }

    throw new Error("Access denied");
  }

  if (
    query.table === "portal_news_posts" ||
    query.table === "portal_catalog_items" ||
    query.table === "reward_catalog_items" ||
    query.table === "lookup_values"
  ) {
    if (!superAdmin && isWrite) {
      throw new Error("Access denied");
    }
    return { ...query, filters };
  }

  if (query.table === "reward_point_events") {
    if (query.operation === "select" || query.operation === "count") {
      return scopeSpec?.kind === "column"
        ? {
            ...query,
            filters: appendScopeFilter(filters, scopeSpec.column, String(scopeSpec.value ?? "")),
          }
        : { ...query, filters };
    }
    if (query.operation === "insert") {
      return query;
    }
    throw new Error("Access denied");
  }

  return { ...query, filters };
}
