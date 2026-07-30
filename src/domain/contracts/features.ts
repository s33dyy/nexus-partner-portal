import type { RoleKey, TeamDomainKey } from "./taxonomy";

/** Coarse-grained capability domains governed by the role permission matrix
 * (admin.roles.tsx) and enforced in table-policy.server.ts / assistant.server.ts.
 * Not every governed table maps 1:1 to a feature — several related tables
 * share one feature key (e.g. support_tickets + support_ticket_comments
 * both fall under "tickets"). */
export const FEATURE_KEYS = [
  "deals",
  "partners",
  "customers",
  "catalog",
  "tickets",
  "tasks",
  "learning",
  "rewards",
  "integrations",
  "users",
  "audit",
  "news",
  "assistant",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  deals: "Deals",
  partners: "Partners",
  customers: "Customers",
  catalog: "Catalog",
  tickets: "Support tickets",
  tasks: "Tasks",
  learning: "Learning",
  rewards: "Rewards",
  integrations: "Integrations",
  users: "Users & roles",
  audit: "Audit",
  news: "News",
  assistant: "Assistant",
};

export type CrudOperation = "create" | "read" | "update" | "delete";

/** Default team domain assigned to a governed assignment when a role is
 * granted through the admin console, absent a more specific choice. */
export const ROLE_KEY_TEAM_DOMAIN: Record<RoleKey, TeamDomainKey> = {
  super_admin: "identity",
  rm: "sales",
  pam: "sales",
  kam: "sales",
  isr: "sales",
  livey_support: "support",
  restricted_distributor: "logistics",
  partner_admin: "partner_success",
  partner_user: "partner_success",
};

export const ROLE_KEY_LABELS: Record<RoleKey, string> = {
  super_admin: "Super Admin",
  rm: "Regional Manager (RM)",
  pam: "Partner Account Manager (PAM)",
  kam: "Key Account Manager (KAM)",
  isr: "Inside Sales Representative (ISR)",
  livey_support: "LIVEY Support",
  restricted_distributor: "Distributor",
  partner_admin: "Partner Admin",
  partner_user: "Partner User",
};

/** RoleKeys that also carry a legacy `app_role` (user_roles table) entry,
 * so hasRole("super_admin")-style checks across the app keep working. */
export const LEGACY_APP_ROLE_KEYS = ["super_admin", "partner_admin", "partner_user"] as const;
export type LegacyAppRoleKey = (typeof LEGACY_APP_ROLE_KEYS)[number];

export function isLegacyAppRoleKey(role: RoleKey): role is LegacyAppRoleKey {
  return (LEGACY_APP_ROLE_KEYS as readonly RoleKey[]).includes(role);
}
