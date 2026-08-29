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
  "calls",
  "distribution",
  "outreach",
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
  calls: "Calls",
  distribution: "Distribution",
  outreach: "Outreach sequences",
};

export type CrudOperation = "create" | "read" | "update" | "delete";

/** product.md §1.4: the product serves exactly two team domains — the LIVEY
 * internal domain and the Partner external domain. Membership is a property
 * of the governed role and is *never* inferred from email domain, company
 * name, partner_id, page URL, or UI state (§1.4 forbids all four explicitly).
 * This map is the single authority the runtime consults. */
export const ACCESS_DOMAINS = ["livey_internal", "partner_external"] as const;
export type AccessDomain = (typeof ACCESS_DOMAINS)[number];

export const ROLE_KEY_ACCESS_DOMAIN: Record<RoleKey, AccessDomain> = {
  super_admin: "livey_internal",
  rm: "livey_internal",
  pam: "livey_internal",
  kam: "livey_internal",
  isr: "livey_internal",
  livey_support: "livey_internal",
  // §5.4: "Distributor — a restricted LIVEY-internal role." It sits in the
  // internal domain (so the Partner onboarding lifecycle never gates it) but
  // is participant-gated, see PARTICIPANT_GATED_ROLE_KEYS below.
  restricted_distributor: "livey_internal",
  partner_admin: "partner_external",
  partner_user: "partner_external",
};

export const LIVEY_INTERNAL_ROLE_KEYS = [
  "super_admin",
  "rm",
  "pam",
  "kam",
  "isr",
  "livey_support",
  "restricted_distributor",
] as const satisfies readonly RoleKey[];

export const PARTNER_EXTERNAL_ROLE_KEYS = [
  "partner_admin",
  "partner_user",
] as const satisfies readonly RoleKey[];

export type LiveyInternalRoleKey = (typeof LIVEY_INTERNAL_ROLE_KEYS)[number];
export type PartnerExternalRoleKey = (typeof PARTNER_EXTERNAL_ROLE_KEYS)[number];

export function roleAccessDomain(role: RoleKey): AccessDomain {
  return ROLE_KEY_ACCESS_DOMAIN[role];
}

export function isLiveyInternalRole(role: RoleKey): role is LiveyInternalRoleKey {
  return ROLE_KEY_ACCESS_DOMAIN[role] === "livey_internal";
}

export function isPartnerExternalRole(role: RoleKey): role is PartnerExternalRoleKey {
  return ROLE_KEY_ACCESS_DOMAIN[role] === "partner_external";
}

/** product.md §5.4: roles whose record access is participant-based — the user
 * sees only explicitly tagged records and may run only an allowlisted set of
 * fulfillment-safe commands. Distributor is currently the only such role.
 *
 * NOTE: per-record participant gating (the tagged-Customer / tagged-Deal safe
 * view and the command allowlist) is a later phase. What is enforced today is
 * the *module-level* exclusion from §5.4/§7.1: no Administration, no global
 * analytics, no broad partner lists, no catalogue or pricing policy, no
 * strategic audit. */
export const PARTICIPANT_GATED_ROLE_KEYS = [
  "restricted_distributor",
] as const satisfies readonly RoleKey[];

export type ParticipantGatedRoleKey = (typeof PARTICIPANT_GATED_ROLE_KEYS)[number];

export function isParticipantGatedRole(role: RoleKey): role is ParticipantGatedRoleKey {
  return (PARTICIPANT_GATED_ROLE_KEYS as readonly RoleKey[]).includes(role);
}

/** Precedence used when one identity carries several governed roles (the
 * legacy user_roles rows unioned with the governed assignment role). Ordered
 * most- to least-powerful and kept in lockstep with ROLE_POWER in
 * domain/contracts/governance.ts — duplicated here so the browser-side access
 * resolver does not have to pull in the geography graph that governance.ts
 * builds at module load. */
export const ROLE_KEY_PRECEDENCE = [
  "super_admin",
  "rm",
  "pam",
  "kam",
  "isr",
  "livey_support",
  "restricted_distributor",
  "partner_admin",
  "partner_user",
] as const satisfies readonly RoleKey[];

/** The single role that governs access resolution for a multi-role identity. */
export function resolveGoverningRole(roles: readonly RoleKey[]): RoleKey | null {
  for (const candidate of ROLE_KEY_PRECEDENCE) {
    if (roles.includes(candidate)) return candidate;
  }
  return null;
}

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
