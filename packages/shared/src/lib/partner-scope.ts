import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "../contracts/governance";
import type { RoleKey } from "../contracts/taxonomy";

// Deliberately narrower than domain/contracts/features.ts's
// isLiveyInternalRole (which also includes super_admin and
// restricted_distributor) — super_admin is already handled by the
// isSuperAdmin flag above, and restricted_distributor must stay
// tenant-scoped, not gain broader access here. Mirrors
// LIVEY_INTERNAL_ROLES in table-policy.server.ts exactly.
const DEALS_SCOPE_BYPASS_ROLES = new Set<RoleKey>(["rm", "pam", "kam", "isr", "livey_support"]);

export function hasDealsScopeBypass(roleKey: RoleKey | null | undefined): boolean {
  return !!roleKey && DEALS_SCOPE_BYPASS_ROLES.has(roleKey);
}

// Mirrors hasGlobalLiveySupportAccess in table-policy.server.ts exactly —
// the server already allows a globally-ceilinged LIVEY-internal role
// (never restricted_distributor) an unscoped support_tickets read; this
// bypass just stops the client from re-narrowing that response back down
// to self-created-only before it ever reaches the server.
const SUPPORT_SCOPE_BYPASS_ROLES = new Set<RoleKey>(["rm", "pam", "kam", "isr", "livey_support"]);

export function hasSupportScopeBypass(
  roleKey: RoleKey | null | undefined,
  geographyCeilingNodeId: string | null | undefined,
): boolean {
  return (
    !!roleKey &&
    SUPPORT_SCOPE_BYPASS_ROLES.has(roleKey) &&
    geographyCeilingNodeId === GOVERNANCE_GEOGRAPHY_NODE_IDS.global
  );
}

export function applyPartnerScope<T>(
  query: T,
  input: {
    isSuperAdmin: boolean;
    partnerId?: string | null;
    userId?: string | null;
    fallbackColumn?: string;
    // Set true for RM/PAM/KAM/ISR/Support (never restricted_distributor):
    // the server (table-policy.server.ts) already gives them an
    // authorised-scope read, not self-created-only — this client-side
    // filter was applying the old self-only restriction on top of that,
    // silently re-narrowing an already-correct server response back down
    // to nothing. See product.md §5.5/§5.6.
    bypassOwnershipFilter?: boolean;
  },
) {
  const scopedQuery = query as T & { eq: (column: string, value: string) => T };

  if (input.isSuperAdmin || input.bypassOwnershipFilter) {
    return query;
  }

  if (input.partnerId) {
    return scopedQuery.eq("partner_id", input.partnerId);
  }

  if (input.userId) {
    return scopedQuery.eq(input.fallbackColumn ?? "user_id", input.userId);
  }

  return query;
}
