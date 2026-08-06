import type { FeatureKey } from "@/domain/contracts/features";
import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { RoleKey } from "@/domain/contracts/taxonomy";
import { pool } from "@/server/postgres.server";
import {
  assertFeatureCapability,
  countriesWithinCeiling,
  loadRoleCapabilities,
} from "@/server/rbac-policy.server";

export type QueryFilter = {
  column: string;
  value: unknown;
  operator: "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte" | "ilike";
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
  limit?: number;
  // A read-only-scope OR condition the policy layer itself computes — never
  // client-supplied. Used where a single ownership column can't express the
  // grant (e.g. tasks: visible if you created OR were assigned it).
  scopeAnyColumnEquals?: { columns: [string, string]; value: string };
  // Same idea, for "I own it OR I'm tagged as an active participant on it" —
  // the ownership check is a plain column, but the tag check needs a
  // correlated EXISTS against deal_participants/customer_participants, which
  // scopeAnyColumnEquals's two-plain-columns shape can't express. See
  // isRestrictedPartnerRole.
  scopeOwnerOrParticipantTag?: {
    ownerColumn: string;
    ownerValue: string;
    participantTable: "deal_participants" | "customer_participants";
    fkColumn: "deal_id" | "customer_id";
  };
};

export type TablePolicyAuthContext = {
  userId: string | null;
  roles: string[];
  partnerId: string | null;
  companyName: string | null;
  hasGovernedContext: boolean;
  governedRoleKey?: RoleKey | null;
  geographyCeilingNodeId?: string | null;
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
  // Insight Hub content is a governed catalogue like the tables above:
  // every authenticated user can browse published tracks/subjects/lessons/
  // assessments, and only super_admin authors them (admin.learning.tsx).
  "learning_tracks",
  "learning_subjects",
  "learning_lessons",
  "learning_assessments",
]);

const GOVERNANCE_TABLES = new Set([
  "governed_tenants",
  "geography_nodes",
  "geography_node_aliases",
  "assignment_events",
  "role_permissions",
  "role_geography_access",
]);

// Tables that must NEVER be reachable through the generic
// queryTable()/supabase.from() path by anyone, including super_admin.
// They are registered in TABLE_COLUMNS (so the inventory analyzer and the
// client-table regression test can see them) but every legitimate access
// goes through a dedicated server function using raw pool.query, which
// never calls applyTablePolicy — so denying here breaks nothing.
//
// Both previously fell through applyTablePolicyInner's final unscoped
// `return { ...query, filters }` catch-all, with no scope spec, no
// TABLE_FEATURE_MAP entry, and no per-table branch. Only anonymous callers
// were blocked, so ANY authenticated user — including the lowest-privilege
// partner_user — could read and write them across every tenant:
//   - document_blobs holds the raw file_data bytes of every partner
//     agreement, GST certificate, PO and deal document. A plain
//     `supabase.from("document_blobs").select("*")` exfiltrated every
//     tenant's documents, bypassing assertDocumentAccess entirely (that
//     guards the storage entry points, not this generic table path).
//   - password_reset_tokens is worse than a read leak: it was writable, so
//     an attacker could INSERT a row pointing at any victim user_id with a
//     token_hash of their own choosing and a future expires_at, then call
//     the public completePasswordReset() with the matching plaintext token
//     to seize any account, including super_admin.
const SERVER_ONLY_TABLES = new Set(["document_blobs", "password_reset_tokens"]);

// Tables reachable through the generic queryTable()/supabase.from() path
// that are gated by the role permission matrix (admin.roles.tsx). Identity/
// session tables (profiles, user_roles, assignments, active_contexts,
// sessions) are deliberately excluded — every request must always be able
// to read its own identity/session to bootstrap the app, and only
// super_admin ever lists other users' rows there today (already enforced
// by the existing scope logic below, independent of this matrix).
const TABLE_FEATURE_MAP: Record<string, FeatureKey> = {
  portal_deals: "deals",
  portal_deal_collaborators: "deals",
  deal_line_items: "deals",
  deal_documents: "deals",
  partners: "partners",
  partner_documents: "partners",
  partner_review_notes: "partners",
  portal_customers: "customers",
  portal_customer_activities: "customers",
  customer_participants: "customers",
  customer_merge_events: "customers",
  deal_participants: "customers",
  portal_catalog_items: "catalog",
  support_tickets: "tickets",
  support_ticket_comments: "tickets",
  tasks: "tasks",
  reward_catalog_items: "rewards",
  reward_point_events: "rewards",
  reward_redemptions: "rewards",
  portal_audit_events: "audit",
  domain_activity_events: "audit",
  portal_news_posts: "news",
  learning_enrollments: "learning",
  learning_assessment_attempts: "learning",
  learning_lesson_progress: "learning",
  call_logs: "calls",
};

// Tables with a resolvable geography column, restricted to a role's region
// access on reads (writes go through their own governed command layer,
// e.g. deal-commands.server.ts's authorizeDealActor for portal_deals).
const GEOGRAPHY_SCOPED_TABLES = new Set(["portal_deals", "partners"]);

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

function canSeeInternalTicketNotes(auth: TablePolicyAuthContext) {
  return auth.roles.includes("super_admin") || auth.roles.includes("livey_support");
}

/** The generic ownership-scope path (getScopeSpec/getGenericScopeSpec) only
 * ever recognises partner_id-owns-row or userId-created-row — it has no
 * concept of a LIVEY-internal role's queue. Without this, rm/pam/kam/isr/
 * livey_support fall through to "created_by = self", meaning a Support
 * agent's ticket queue is invisible unless they personally created every
 * ticket. Scoped narrowly to support_tickets/support_ticket_comments for
 * now (the ticket module this fix touches); the same gap likely exists on
 * other ownership-scoped tables for LIVEY-internal roles and is tracked
 * separately as it needs its own review per table. Matches the identical
 * "geography ceiling === Global" fail-closed policy already implemented in
 * ticket-commands.server.ts's authorizeTicketActor for the write side. */
function hasGlobalLiveySupportAccess(auth: TablePolicyAuthContext) {
  if (auth.partnerId) return false;
  const role = auth.governedRoleKey;
  if (
    !role ||
    role === "partner_admin" ||
    role === "partner_user" ||
    role === "restricted_distributor"
  ) {
    return false;
  }
  return auth.geographyCeilingNodeId === GOVERNANCE_GEOGRAPHY_NODE_IDS.global;
}

const LIVEY_INTERNAL_ROLES = new Set<RoleKey>(["rm", "pam", "kam", "isr", "livey_support"]);

/** True for rm/pam/kam/isr/livey_support (never restricted_distributor, who
 * has a real partnerId and is scoped by tenant instead — see §2.4/8.7a,
 * tracked separately). These roles have no partnerId of their own, so
 * getScopeSpec's partner_id-or-self fallback collapses them to
 * "self-created only" — the same class of bug hasGlobalLiveySupportAccess
 * fixed for support_tickets, generalised to the other ownership-scoped
 * tables product.md §5.5/§5.6 grants them an authorised-scope view of. */
function isLiveyInternalRole(auth: TablePolicyAuthContext): boolean {
  if (auth.partnerId) return false;
  const role = auth.governedRoleKey;
  return !!role && LIVEY_INTERNAL_ROLES.has(role);
}

/** Product decision: an ordinary Partner User sees only Deals/Customers
 * they created or were explicitly tagged as a participant on (via
 * tagDealParticipant/tagCustomerParticipant) — not their whole company's
 * book of business. Partner Admin is deliberately excluded — it keeps the
 * existing flat partner_id-wide visibility, since an admin needs to
 * oversee the whole team. restricted_distributor's own §8.7a gap (it
 * currently gets that same flat whole-tenant access, though product.md
 * §8.7/§8.8 says it should be tag-gated even more strictly than this) is
 * intentionally left untouched here — a separate decision, not bundled
 * into this one. */
function isRestrictedPartnerRole(auth: TablePolicyAuthContext): boolean {
  return auth.governedRoleKey === "partner_user" && !!auth.partnerId;
}

/** True only for restricted_distributor. §2.4's Task/Ticket interim fix:
 * neither table has a participant-tag table like deal_participants/
 * customer_participants (that's the still-open portal_deals/portal_customers
 * half of §2.4/8.7a, deliberately left untouched — see
 * isRestrictedPartnerRole's own comment), so this narrows a Distributor's
 * read scope from the flat partner_id-wide visibility partner_admin/
 * partner_user keep down to "tasks I created or am assigned to" / "tickets
 * I raised", mirroring authorizeTaskActor/authorizeTicketActor's identical
 * restriction on the write side. */
function isRestrictedDistributorRole(auth: TablePolicyAuthContext): boolean {
  return auth.governedRoleKey === "restricted_distributor" && !!auth.partnerId;
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
    case "tasks":
      if (partnerId) {
        return buildGenericScope(`"partner_id" = $1`, [partnerId]);
      }
      return userId ? buildGenericScope(`"creator_id" = $1`, [userId]) : null;
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
      return auth.partnerId
        ? { kind: "column", column: "partner_id", value: auth.partnerId, fallbackColumn: "user_id" }
        : { kind: "column", column: "user_id", value: auth.userId };
    // §2.11/§11.5: "Notifications do not target all members of a Partner
    // merely because partner_id matches" — unlike the partner_id-first tables
    // above, a notification is always recipient-specific, so reads are always
    // scoped to the caller's own user_id regardless of partnerId. The insert
    // side needs a different rule (a caller must be able to create a
    // notification addressed to someone else, the actual recipient) — see
    // the dedicated "notifications" insert bypass in applyTablePolicyInner.
    case "notifications":
      return { kind: "column", column: "user_id", value: auth.userId };
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
    case "tasks":
      return auth.partnerId
        ? {
            kind: "column",
            column: "partner_id",
            value: auth.partnerId,
            fallbackColumn: "creator_id",
          }
        : { kind: "column", column: "creator_id", value: auth.userId };
    case "portal_team_members":
      return { kind: "column", column: "company_name", value: auth.companyName };
    case "portal_deal_collaborators":
    case "deal_line_items":
      return { kind: "linked-deal" };
    case "support_ticket_comments":
      return { kind: "linked-ticket" };
    case "learning_enrollments":
    case "learning_assessment_attempts":
    case "learning_lesson_progress":
      return { kind: "column", column: "user_id", value: auth.userId };
    // Call Center Phase 1: "calls" is livey_support/super_admin only (see
    // role_permissions seed), so unlike the partner-facing tables above
    // there's no partnerId branch — a non-super-admin caller (livey_support)
    // sees only calls they personally handled. The webhook handlers in
    // twilio-voice.server.ts write agent_user_id directly via raw pool
    // queries and never go through this generic path, so this scope only
    // ever applies to the read-only call history list.
    case "call_logs":
      return { kind: "column", column: "agent_user_id", value: auth.userId };
    case "customer_participants":
    case "deal_participants":
    case "customer_merge_events":
      return auth.partnerId
        ? {
            kind: "column",
            column: "partner_id",
            value: auth.partnerId,
            fallbackColumn: "actor_id",
          }
        : { kind: "column", column: "actor_id", value: auth.userId };
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

/** product.md §19.8: audit events must be non-repudiable. recordAuditEvent
 * (workflow-events.ts) is called from client route components with
 * actor_name/actor_role taken from client-side React state — a tampered
 * client could insert an audit row attributing any action to any name/role.
 * Overrides those two fields (and stamps actor_id) from the server-verified
 * session on every insert, discarding whatever the client sent, regardless
 * of what recordAuditEvent's caller passed in. Narrative fields (action,
 * details, outcome, ...) remain client-supplied — a fuller fix moves audit
 * writes entirely server-side inside the domain command modules, tracked
 * separately as a larger change (product.md §18.8). */
async function withNonRepudiableActor(
  values: TableQueryLike["values"],
  auth: TablePolicyAuthContext,
): Promise<TableQueryLike["values"]> {
  if (!auth.userId) {
    throw new Error("Access denied");
  }

  const actorRole = isSuperAdmin(auth)
    ? "super_admin"
    : auth.roles.includes("partner_admin")
      ? "partner_admin"
      : auth.roles.includes("partner_user")
        ? "partner_user"
        : (auth.governedRoleKey ?? "unknown");

  const { rows } = await pool.query(`SELECT full_name FROM profiles WHERE id = $1 LIMIT 1`, [
    auth.userId,
  ]);
  const actorName = (rows[0] as { full_name: string } | undefined)?.full_name ?? "Unknown user";

  const rowsToScope = Array.isArray(values) ? values : [values ?? {}];
  const overridden = rowsToScope.map((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("Insert values must be objects");
    }
    return { ...row, actor_id: auth.userId, actor_name: actorName, actor_role: actorRole };
  });

  return Array.isArray(values) ? overridden : (overridden[0] ?? {});
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

  if (isSuperAdmin(auth) || hasGlobalLiveySupportAccess(auth)) {
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

async function applyTablePolicyInner(
  query: TableQueryLike,
  auth: TablePolicyAuthContext,
): Promise<TableQueryLike> {
  const superAdmin = isSuperAdmin(auth);
  const isPublicRead = PUBLIC_READ_TABLES.has(query.table);
  const scopeSpec = getScopeSpec(query.table, auth);
  const isWrite = query.operation !== "select" && query.operation !== "count";

  // Checked before every other branch, and deliberately without a
  // super_admin bypass — see SERVER_ONLY_TABLES.
  if (SERVER_ONLY_TABLES.has(query.table)) {
    throw new Error("Access denied");
  }

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

    if (superAdmin) {
      return { ...query, filters: normalizeFilters(query.filters) };
    }

    if (!scopeSpec || scopeSpec.kind !== "column") {
      throw new Error("Access denied");
    }

    if (scopeSpec.value == null) {
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
    if (superAdmin) {
      return { ...query, filters: normalizeFilters(query.filters) };
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
    if (superAdmin) {
      return { ...query, filters };
    }

    // §2.11/§11.5: a notification's user_id must be the actual recipient
    // (e.g. a deal's owner), not forced to equal the acting user — the
    // read scope above (now strictly user_id = caller, to close the
    // over-broad partner-wide leak) would otherwise also reject every
    // insert naming someone else as recipient, since the ordinary
    // column-scope enforcement further down requires row.user_id to equal
    // auth.userId whenever there's no partnerId-based fallback in play.
    // notifications carries no link back to the record it's about, so a
    // precise "the actor and the named recipient share a real relationship
    // on this specific record" check isn't expressible here without a
    // schema change; every caller of this generic insert path is already
    // an authenticated, tenant-scoped Deal/Ticket/Task actor (pipeline.tsx/
    // deals.tsx's publishDealNotification; ticket-commands.server.ts writes
    // notifications directly via raw pool queries and never reaches this
    // path at all), so this only relaxes WHO a notification can be
    // addressed to, not WHO may call it. Tracked as a residual gap in
    // current gaps.md pending a stronger per-record check.
    if (query.table === "notifications" && query.operation === "insert") {
      return { ...query, filters };
    }

    if (
      query.table === "support_tickets" &&
      (query.operation === "select" || query.operation === "count") &&
      hasGlobalLiveySupportAccess(auth)
    ) {
      return { ...query, filters };
    }

    // §2.4 interim fix (see authorizeTicketActor's identical write-side
    // restriction): a Distributor's read scope narrows from every ticket at
    // their partner down to tickets they personally raised. Stacked on top
    // of the ordinary partner_id filter below (both are plain "eq" filters
    // on different columns, so they simply AND together) rather than a
    // fallbackColumn substitution, since a Distributor must satisfy BOTH
    // "in my tenant" AND "I created it", not either/or.
    if (
      query.table === "support_tickets" &&
      (query.operation === "select" || query.operation === "count") &&
      isRestrictedDistributorRole(auth) &&
      auth.userId
    ) {
      return {
        ...query,
        filters: appendScopeFilter(
          appendScopeFilter(filters, scopeSpec.column, String(scopeSpec.value ?? "")),
          "created_by",
          auth.userId,
        ),
      };
    }

    // §5.5/§5.6: RM/PAM/KAM/ISR/Support get an "authorised scope" view of
    // deals, not "only what I personally created". Bypass the ownership
    // filter here and let appendGeographyFilter (called after this
    // function returns, for every table in GEOGRAPHY_SCOPED_TABLES) do the
    // real narrowing by the caller's geography ceiling — a Global ceiling
    // sees every deal, a narrower one only deals in-region. This is a
    // deliberate interim step: the spec's fuller PAM/KAM/ISR model is
    // participant-tag-based (§5.7), but that tagging is not automatically
    // populated yet (§5c/§9g, still open) — geography scope is strictly
    // more correct than today's self-created-only bug without requiring
    // that unbuilt tagging engine first.
    if (
      query.table === "portal_deals" &&
      (query.operation === "select" || query.operation === "count") &&
      isLiveyInternalRole(auth)
    ) {
      return { ...query, filters };
    }

    // Product decision (partner_user only — see isRestrictedPartnerRole):
    // narrow visibility from "everyone at partner_id X" to "partner_id X
    // AND (I created it OR I'm an active tagged participant on it)". The
    // partner_id filter still applies underneath via appendScopeFilter —
    // this only ever narrows within the caller's own tenant, it can never
    // widen across tenants.
    if (
      (query.table === "portal_deals" || query.table === "portal_customers") &&
      (query.operation === "select" || query.operation === "count") &&
      isRestrictedPartnerRole(auth) &&
      auth.userId
    ) {
      return {
        ...query,
        filters: appendScopeFilter(filters, scopeSpec.column, String(scopeSpec.value ?? "")),
        scopeOwnerOrParticipantTag: {
          ownerColumn: "user_id",
          ownerValue: auth.userId,
          participantTable:
            query.table === "portal_deals" ? "deal_participants" : "customer_participants",
          fkColumn: query.table === "portal_deals" ? "deal_id" : "customer_id",
        },
      };
    }

    // §10.3: "My Tasks" must show tasks assigned to the current user, not
    // only ones they created — the two are tracked in separate columns.
    // A single ownership column can't express "creator OR assignee", so
    // this bypasses the normal appendScopeFilter path with a dedicated
    // OR-of-two-columns scope the SQL layer applies afterward.
    if (
      query.table === "tasks" &&
      (query.operation === "select" || query.operation === "count") &&
      isLiveyInternalRole(auth) &&
      auth.userId
    ) {
      return {
        ...query,
        filters,
        scopeAnyColumnEquals: { columns: ["creator_id", "assignee_id"], value: auth.userId },
      };
    }

    // §2.4 interim fix (see authorizeTaskActor's identical write-side
    // restriction): a Distributor's read scope narrows from every task at
    // their partner down to tasks they created or are assigned to. Unlike
    // the LIVEY-internal bypass above, the partner_id filter still applies
    // underneath (a Distributor is tenant-scoped, not organisation-wide) —
    // this only adds the creator-or-assignee condition on top of it.
    if (
      query.table === "tasks" &&
      (query.operation === "select" || query.operation === "count") &&
      isRestrictedDistributorRole(auth) &&
      auth.userId
    ) {
      return {
        ...query,
        filters: appendScopeFilter(filters, scopeSpec.column, String(scopeSpec.value ?? "")),
        scopeAnyColumnEquals: { columns: ["creator_id", "assignee_id"], value: auth.userId },
      };
    }

    // portal_team_members is scoped by company_name — a partner-side
    // concept a LIVEY-internal caller's profile never has. That isn't a
    // security violation (there's no company roster to leak), just an
    // empty one; deals.tsx's team-member dropdown query unconditionally
    // runs for every viewer, so throwing "Access denied" here previously
    // took down the entire Deals page load for every RM/PAM/KAM/ISR/
    // Support user via its shared Promise.all.
    if (
      query.table === "portal_team_members" &&
      (query.operation === "select" || query.operation === "count") &&
      scopeSpec.value == null
    ) {
      return {
        ...query,
        filters: appendScopeFilter(filters, "company_name", "__no_company_scope__"),
      };
    }

    if (scopeSpec.value == null) {
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
        if (superAdmin) {
          return { ...query, filters };
        }
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

    const canSeeInternal = canSeeInternalTicketNotes(auth);

    if (ticketIds.some((ticketId) => !ticketId)) {
      if (query.operation === "select" || query.operation === "count") {
        if (superAdmin) {
          return { ...query, filters };
        }
        if (auth.userId) {
          const authorScoped = appendScopeFilter(filters, "author_id", auth.userId);
          return {
            ...query,
            filters: canSeeInternal
              ? authorScoped
              : [...authorScoped, { column: "is_internal", value: false, operator: "eq" as const }],
          };
        }
      }
      throw new Error("Access denied");
    }

    for (const ticketId of ticketIds) {
      await assertLinkedTicketAccess(ticketId as string, auth);
    }

    if (query.operation === "insert") {
      const rows = Array.isArray(query.values) ? query.values : [query.values ?? {}];
      if (!canSeeInternal) {
        for (const row of rows) {
          if (
            typeof row === "object" &&
            row !== null &&
            (row as Record<string, unknown>).is_internal
          ) {
            throw new Error("Access denied");
          }
        }
      }
      return { ...query, filters };
    }

    if ((query.operation === "select" || query.operation === "count") && !canSeeInternal) {
      return {
        ...query,
        filters: [...filters, { column: "is_internal", value: false, operator: "eq" as const }],
      };
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
      return { ...query, filters, values: await withNonRepudiableActor(query.values, auth) };
    }

    throw new Error("Access denied");
  }

  // domain_activity_events spans every subject type (deal, task, ticket,
  // user, ...) with no single owning column, unlike portal_audit_events'
  // sibling block above. A precise per-record scope for every subject_type
  // (product.md §5.6/§9.17/§18.8: visible to "users authorised to see the
  // subject") is a larger piece of work; until it lands, apply the same
  // super-admin-only reads as portal_audit_events rather than ship an
  // under-scoped rule — EXCEPT the one shape actually reachable from the
  // shipped UI today: DealActivityTimeline always queries with an exact
  // subject_type="deal" + subject_id=<dealId> filter pair for one already-
  // open deal, which reuses the existing linked-deal access check rather
  // than needing a generic per-row scope. Writes only ever happen
  // server-side inside domain command modules (deal-commands.server.ts
  // etc.), never through this generic client path.
  if (query.table === "domain_activity_events") {
    if (query.operation === "select" || query.operation === "count") {
      if (superAdmin) {
        return { ...query, filters };
      }
      const subjectType = extractFilterValue(filters, "subject_type");
      const subjectId = extractFilterValue(filters, "subject_id");
      if (subjectType === "deal" && subjectId) {
        await assertLinkedDealAccess(subjectId, auth);
        return { ...query, filters };
      }
      throw new Error("Access denied");
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

function operationToCrud(
  operation: TableQueryLike["operation"],
): "create" | "read" | "update" | "delete" {
  if (operation === "select" || operation === "count") return "read";
  if (operation === "insert") return "create";
  if (operation === "update") return "update";
  return "delete";
}

async function assertGovernedFeatureCapability(
  query: TableQueryLike,
  auth: TablePolicyAuthContext,
) {
  if (isSuperAdmin(auth)) return;
  const featureKey = TABLE_FEATURE_MAP[query.table];
  if (!featureKey) return;

  const capabilities = await loadRoleCapabilities(auth.governedRoleKey ?? null);
  assertFeatureCapability(capabilities, featureKey, operationToCrud(query.operation));
}

function appendGeographyFilter(
  query: TableQueryLike,
  auth: TablePolicyAuthContext,
): TableQueryLike {
  if (isSuperAdmin(auth)) return query;
  if (query.operation !== "select" && query.operation !== "count") return query;
  if (!GEOGRAPHY_SCOPED_TABLES.has(query.table)) return query;

  const countries = countriesWithinCeiling(auth.geographyCeilingNodeId ?? null);
  if (countries === null) return query;

  return {
    ...query,
    filters: [
      ...(query.filters ?? []),
      { column: "country", value: countries, operator: "in" as const },
    ],
  };
}

// transitionTask (task-commands.server.ts) is the only path allowed to move
// a Task through its state machine — it locks the row, checks the allowed
// transition table, and appends task_transitions/Activity/outbox evidence
// atomically. A generic `tasks` update reaching these columns would let any
// scoped caller (including Super Admin) forge a status/version change with
// none of that evidence, so it's rejected here, before every other branch
// including the super_admin bypasses below.
const TASK_LIFECYCLE_UPDATE_FIELDS = new Set([
  "status",
  "blocked_reason",
  "completed_at",
  "cancelled_at",
  "version",
]);

function assertNoProtectedLifecycleUpdate(query: TableQueryLike): void {
  if (query.table !== "tasks" || query.operation !== "update") return;
  if (typeof query.values !== "object" || query.values === null || Array.isArray(query.values)) {
    return;
  }

  const attempted = Object.keys(query.values).filter((field) =>
    TASK_LIFECYCLE_UPDATE_FIELDS.has(field),
  );
  if (attempted.length > 0) {
    throw new Error("Task lifecycle fields require the named transition command");
  }
}

// reward-commands.server.ts owns every points/stock/redemption-state effect
// inside a single locked transaction (reservation, review, release,
// retirement). The generic path previously let ANY authenticated caller
// insert arbitrary reward_point_events rows (crediting themselves points)
// and update their own reward_redemptions.status directly — both silently
// bypassed the reservation/idempotency/version invariants those commands
// enforce. Catalogue create/update stay generic (ordinary descriptive/
// inventory fields); only catalogue delete is blocked, since retirement
// (not deletion) is the only way to remove a reward from new requests.
function assertNoProtectedRewardMutation(query: TableQueryLike): void {
  const isWrite = query.operation !== "select" && query.operation !== "count";
  if (!isWrite) return;

  if (query.table === "reward_point_events" || query.table === "reward_redemptions") {
    throw new Error("Reward lifecycle mutations require a named command");
  }
  if (query.table === "reward_catalog_items" && query.operation === "delete") {
    throw new Error("Reward lifecycle mutations require a named command");
  }
}

/** Applies the existing ownership/scope policy, then layers the role
 * permission matrix (CRUD gate) and, for the handful of geography-bearing
 * tables, a region-access filter on top. Both new checks are no-ops for
 * super_admin and for tables outside their respective maps, so every
 * existing code path's behaviour is unchanged unless a role has actually
 * been narrowed from admin.roles.tsx. */
export async function applyTablePolicy(
  query: TableQueryLike,
  auth: TablePolicyAuthContext,
): Promise<TableQueryLike> {
  assertNoProtectedLifecycleUpdate(query);
  assertNoProtectedRewardMutation(query);
  await assertGovernedFeatureCapability(query, auth);
  const result = await applyTablePolicyInner(query, auth);
  return appendGeographyFilter(result, auth);
}
