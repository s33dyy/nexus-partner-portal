import { supabase } from "@/integrations/local/client";
import type { CsvColumn } from "@/lib/csv-export";

export type ExportRole = "super_admin" | "partner_admin" | "partner_user";

export type ExportScope = {
  role: ExportRole;
  isSuperAdmin: boolean;
  partnerId: string | null;
  userId: string | null;
  companyName: string | null;
};

export type ExportDatasetDescriptor = {
  id: string;
  label: string;
  description: string;
  group: "operational" | "governance" | "configuration";
  filenameStem: string;
  visibleTo: ExportRole[];
  routePath?: string;
  columns: CsvColumn[];
  loadCount: (scope: ExportScope) => Promise<number>;
  loadRows: (scope: ExportScope) => Promise<Array<Record<string, unknown>>>;
};

type ScopeMode = "global" | "partner" | "user" | "partner-or-user" | "company";

type ScopeFilter = {
  column: string;
  value: string;
};

function requireScopeValue(value: string | null, fieldName: string) {
  if (!value) {
    throw new Error(`Cannot export without ${fieldName}.`);
  }

  return value;
}

type DatasetConfig = Omit<ExportDatasetDescriptor, "loadCount" | "loadRows"> & {
  table: string;
  scopeMode: ScopeMode;
  fallbackUserColumn?: string;
};

async function loadTableRows(
  table: string,
  scope: ExportScope,
  scopeMode: ScopeMode,
  fallbackUserColumn = "user_id",
) {
  let query = supabase.from(table).select("*");

  for (const filter of resolveScopeFilters(scope, scopeMode, fallbackUserColumn)) {
    query = query.eq(filter.column, filter.value);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function loadTableCount(
  table: string,
  scope: ExportScope,
  scopeMode: ScopeMode,
  fallbackUserColumn = "user_id",
) {
  let query = supabase.from(table).count();

  for (const filter of resolveScopeFilters(scope, scopeMode, fallbackUserColumn)) {
    query = query.eq(filter.column, filter.value);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return typeof data === "number" ? data : 0;
}

export function resolveScopeFilters(
  scope: ExportScope,
  scopeMode: ScopeMode,
  fallbackUserColumn = "user_id",
) {
  if (scope.isSuperAdmin || scopeMode === "global") {
    return [];
  }

  if (scopeMode === "partner") {
    return [{ column: "partner_id", value: requireScopeValue(scope.partnerId, "partner scope") }];
  }

  if (scopeMode === "user") {
    return [{ column: fallbackUserColumn, value: requireScopeValue(scope.userId, "user scope") }];
  }

  if (scopeMode === "company") {
    return [{ column: "company_name", value: requireScopeValue(scope.companyName, "company scope") }];
  }

  if (scopeMode === "partner-or-user") {
    if (scope.role === "partner_admin" && scope.partnerId) {
      return [{ column: "partner_id", value: scope.partnerId }];
    }

    if (scope.role === "partner_user" && scope.userId) {
      return [{ column: fallbackUserColumn, value: scope.userId }];
    }

    if (scope.role === "partner_admin") {
      throw new Error("Cannot export partner-admin data without partner scope.");
    }

    if (scope.role === "partner_user") {
      throw new Error("Cannot export partner-user data without user scope.");
    }

    if (scope.partnerId) {
      return [{ column: "partner_id", value: scope.partnerId }];
    }

    if (scope.userId) {
      return [{ column: fallbackUserColumn, value: scope.userId }];
    }

    throw new Error("Cannot export without partner or user scope.");
  }

  return [];
}

function dataset(config: DatasetConfig): ExportDatasetDescriptor {
  const { table, scopeMode, fallbackUserColumn, ...descriptor } = config;
  const loadRows = (scope: ExportScope) =>
    loadTableRows(table, scope, scopeMode, fallbackUserColumn);

  return {
    ...descriptor,
    loadRows,
    loadCount: (scope) => loadTableCount(table, scope, scopeMode, fallbackUserColumn),
  };
}

const ALL_ROLES: ExportRole[] = ["super_admin", "partner_admin", "partner_user"];
const ADMIN_ROLES: ExportRole[] = ["super_admin", "partner_admin"];
const SUPER_ADMIN_ONLY: ExportRole[] = ["super_admin"];

export const EXPORT_DATASETS: ExportDatasetDescriptor[] = [
  dataset({
    id: "portal-deals",
    table: "portal_deals",
    label: "Deals",
    description: "Registered opportunities and their current pipeline details.",
    group: "operational",
    filenameStem: "livey-deals",
    visibleTo: ALL_ROLES,
    routePath: "/deals",
    scopeMode: "partner-or-user",
    columns: [
      { key: "id", header: "ID" },
      { key: "account_name", header: "Account" },
      { key: "contact_name", header: "Client" },
      { key: "product", header: "Product" },
      { key: "stage", header: "Stage" },
      { key: "status", header: "Status" },
      { key: "quantity", header: "Quantity" },
      { key: "amount", header: "Amount" },
      { key: "customer_budget", header: "Customer Budget" },
      { key: "country", header: "Country" },
      { key: "region", header: "Region" },
      { key: "possible_close_date", header: "Possible Close Date" },
      { key: "close_date", header: "Close Date" },
      { key: "created_at", header: "Created At" },
      { key: "updated_at", header: "Updated At" },
    ],
  }),
  dataset({
    id: "portal-customers",
    table: "portal_customers",
    label: "Customers",
    description: "Canonical client accounts registered by partners.",
    group: "operational",
    filenameStem: "livey-customers",
    visibleTo: ALL_ROLES,
    routePath: "/customers",
    scopeMode: "partner-or-user",
    columns: [
      { key: "id", header: "ID" },
      { key: "company_name", header: "Company" },
      { key: "account_owner", header: "Account Owner" },
      { key: "region", header: "Region" },
      { key: "segment", header: "Segment" },
      { key: "health_score", header: "Health Score" },
      { key: "mrr", header: "MRR" },
      { key: "renewal_date", header: "Renewal Date" },
      { key: "status", header: "Status" },
      { key: "next_step", header: "Next Step" },
      { key: "created_at", header: "Created At" },
      { key: "updated_at", header: "Updated At" },
    ],
  }),
  dataset({
    id: "notifications",
    table: "notifications",
    label: "Notifications",
    description: "Workflow and approval notifications for the current scope.",
    group: "operational",
    filenameStem: "livey-notifications",
    visibleTo: ALL_ROLES,
    routePath: "/notifications",
    scopeMode: "partner-or-user",
    columns: [
      { key: "id", header: "ID" },
      { key: "title", header: "Title" },
      { key: "message", header: "Message" },
      { key: "type", header: "Type" },
      { key: "read", header: "Read" },
      { key: "created_at", header: "Created At" },
    ],
  }),
  dataset({
    id: "partner-documents",
    table: "partner_documents",
    label: "Partner documents",
    description: "Onboarding and commercial documents uploaded by partners.",
    group: "operational",
    filenameStem: "livey-partner-documents",
    visibleTo: ALL_ROLES,
    routePath: "/documents",
    scopeMode: "partner-or-user",
    fallbackUserColumn: "uploaded_by",
    columns: [
      { key: "id", header: "ID" },
      { key: "partner_id", header: "Partner ID" },
      { key: "doc_type", header: "Document Type" },
      { key: "file_name", header: "File Name" },
      { key: "file_path", header: "File Path" },
      { key: "mime_type", header: "MIME Type" },
      { key: "size_bytes", header: "Size (bytes)" },
      { key: "created_at", header: "Created At" },
    ],
  }),
  dataset({
    id: "reward-catalog-items",
    table: "reward_catalog_items",
    label: "Reward catalogue",
    description: "Rewards available for redemption across the portal.",
    group: "operational",
    filenameStem: "livey-reward-catalogue",
    visibleTo: ALL_ROLES,
    routePath: "/rewards",
    scopeMode: "global",
    columns: [
      { key: "id", header: "ID" },
      { key: "title", header: "Title" },
      { key: "description", header: "Description" },
      { key: "category", header: "Category" },
      { key: "points_cost", header: "Points Cost" },
      { key: "stock", header: "Stock" },
      { key: "availability", header: "Availability" },
      { key: "created_at", header: "Created At" },
    ],
  }),
  dataset({
    id: "reward-point-events",
    table: "reward_point_events",
    label: "Reward point activity",
    description: "Points earned and approved for the current scope.",
    group: "operational",
    filenameStem: "livey-reward-points",
    visibleTo: ALL_ROLES,
    routePath: "/rewards",
    scopeMode: "partner-or-user",
    columns: [
      { key: "id", header: "ID" },
      { key: "source_type", header: "Source Type" },
      { key: "source_id", header: "Source ID" },
      { key: "points_delta", header: "Points" },
      { key: "reason", header: "Reason" },
      { key: "approved_at", header: "Approved At" },
      { key: "created_at", header: "Created At" },
    ],
  }),
  dataset({
    id: "reward-redemptions",
    table: "reward_redemptions",
    label: "Reward redemptions",
    description: "Reward requests and fulfillment status for the current scope.",
    group: "operational",
    filenameStem: "livey-reward-redemptions",
    visibleTo: ALL_ROLES,
    routePath: "/rewards",
    scopeMode: "partner-or-user",
    columns: [
      { key: "id", header: "ID" },
      { key: "reward_id", header: "Reward ID" },
      { key: "points_cost", header: "Points Cost" },
      { key: "status", header: "Status" },
      { key: "shipping_name", header: "Shipping Name" },
      { key: "approved_at", header: "Approved At" },
      { key: "created_at", header: "Created At" },
    ],
  }),
  dataset({
    id: "partners",
    table: "partners",
    label: "Partners",
    description: "Partner accounts and approval details.",
    group: "governance",
    filenameStem: "livey-partners",
    visibleTo: SUPER_ADMIN_ONLY,
    routePath: "/admin/partners",
    scopeMode: "global",
    columns: [
      { key: "id", header: "ID" },
      { key: "company_name", header: "Company" },
      { key: "legal_name", header: "Legal Name" },
      { key: "gst_number", header: "GST Number" },
      { key: "country", header: "Country" },
      { key: "state", header: "State" },
      { key: "business_focus", header: "Business Focus" },
      { key: "annual_turnover", header: "Annual Turnover" },
      { key: "status", header: "Status" },
      { key: "tier", header: "Tier" },
      { key: "created_at", header: "Created At" },
    ],
  }),
  dataset({
    id: "profiles",
    table: "profiles",
    label: "User profiles",
    description: "Portal user profile records without authentication secrets.",
    group: "governance",
    filenameStem: "livey-user-profiles",
    visibleTo: SUPER_ADMIN_ONLY,
    routePath: "/admin/users",
    scopeMode: "global",
    columns: [
      { key: "id", header: "ID" },
      { key: "email", header: "Email" },
      { key: "full_name", header: "Full Name" },
      { key: "phone", header: "Phone" },
      { key: "company_name", header: "Company" },
      { key: "partner_id", header: "Partner ID" },
      { key: "partner_status", header: "Partner Status" },
      { key: "created_at", header: "Created At" },
      { key: "updated_at", header: "Updated At" },
    ],
  }),
  dataset({
    id: "admin-users",
    table: "user_roles",
    label: "User roles",
    description: "Role assignments for portal users.",
    group: "governance",
    filenameStem: "livey-user-roles",
    visibleTo: SUPER_ADMIN_ONLY,
    routePath: "/admin/users",
    scopeMode: "global",
    columns: [
      { key: "id", header: "ID" },
      { key: "user_id", header: "User ID" },
      { key: "role", header: "Role" },
      { key: "created_at", header: "Created At" },
    ],
  }),
  dataset({
    id: "portal-team-members",
    table: "portal_team_members",
    label: "Team members",
    description: "Partner team records across the workspace.",
    group: "governance",
    filenameStem: "livey-team-members",
    visibleTo: ADMIN_ROLES,
    routePath: "/partner/team",
    scopeMode: "company",
    columns: [
      { key: "id", header: "ID" },
      { key: "company_name", header: "Company" },
      { key: "full_name", header: "Full Name" },
      { key: "email", header: "Email" },
      { key: "role_title", header: "Role Title" },
      { key: "portal_role", header: "Portal Role" },
      { key: "status", header: "Status" },
      { key: "permissions", header: "Permissions" },
      { key: "created_at", header: "Created At" },
    ],
  }),
  dataset({
    id: "partner-review-notes",
    table: "partner_review_notes",
    label: "Partner review notes",
    description: "Internal partner review decisions and comments.",
    group: "governance",
    filenameStem: "livey-partner-review-notes",
    visibleTo: SUPER_ADMIN_ONLY,
    routePath: "/admin/partners",
    scopeMode: "global",
    columns: [
      { key: "id", header: "ID" },
      { key: "partner_id", header: "Partner ID" },
      { key: "author_id", header: "Author ID" },
      { key: "note", header: "Note" },
      { key: "status_change", header: "Status Change" },
      { key: "created_at", header: "Created At" },
    ],
  }),
  dataset({
    id: "portal-audit-events",
    table: "portal_audit_events",
    label: "Audit events",
    description: "Administrative history for approvals and workspace changes.",
    group: "governance",
    filenameStem: "livey-audit-events",
    visibleTo: SUPER_ADMIN_ONLY,
    routePath: "/admin/audit",
    scopeMode: "global",
    columns: [
      { key: "id", header: "ID" },
      { key: "actor_name", header: "Actor" },
      { key: "actor_role", header: "Actor Role" },
      { key: "action", header: "Action" },
      { key: "target_type", header: "Target Type" },
      { key: "target_name", header: "Target" },
      { key: "outcome", header: "Outcome" },
      { key: "severity", header: "Severity" },
      { key: "details", header: "Details" },
      { key: "created_at", header: "Created At" },
    ],
  }),
  dataset({
    id: "portal-news-posts",
    table: "portal_news_posts",
    label: "News posts",
    description: "Published portal announcements and media captions.",
    group: "governance",
    filenameStem: "livey-news-posts",
    visibleTo: ADMIN_ROLES,
    routePath: "/admin/news",
    scopeMode: "global",
    columns: [
      { key: "id", header: "ID" },
      { key: "title", header: "Title" },
      { key: "caption", header: "Caption" },
      { key: "image_path", header: "Image Path" },
      { key: "posted_by_name", header: "Posted By" },
      { key: "created_at", header: "Created At" },
      { key: "updated_at", header: "Updated At" },
    ],
  }),
  dataset({
    id: "portal-catalog-items",
    table: "portal_catalog_items",
    label: "Product catalogue",
    description: "LIVEY product and availability configuration.",
    group: "governance",
    filenameStem: "livey-product-catalogue",
    visibleTo: SUPER_ADMIN_ONLY,
    routePath: "/admin/catalog",
    scopeMode: "global",
    columns: [
      { key: "id", header: "ID" },
      { key: "sku", header: "SKU" },
      { key: "product_name", header: "Product" },
      { key: "category", header: "Category" },
      { key: "partner_tier", header: "Partner Tier" },
      { key: "list_price", header: "List Price" },
      { key: "margin", header: "Margin" },
      { key: "stock", header: "Stock" },
      { key: "availability", header: "Availability" },
      { key: "created_at", header: "Created At" },
      { key: "updated_at", header: "Updated At" },
    ],
  }),
  dataset({
    id: "lookup-values",
    table: "lookup_values",
    label: "Lookup values",
    description: "Shared dropdown values configured for the portal.",
    group: "configuration",
    filenameStem: "livey-lookup-values",
    visibleTo: SUPER_ADMIN_ONLY,
    scopeMode: "global",
    columns: [
      { key: "id", header: "ID" },
      { key: "field_name", header: "Field" },
      { key: "value", header: "Value" },
      { key: "value_key", header: "Value Key" },
      { key: "created_by", header: "Created By" },
      { key: "created_at", header: "Created At" },
    ],
  }),
];

export function listVisibleExportDatasets(role: ExportRole) {
  return EXPORT_DATASETS.filter((dataset) => dataset.visibleTo.includes(role));
}
