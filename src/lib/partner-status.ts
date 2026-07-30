import {
  isLiveyInternalRole,
  isParticipantGatedRole,
  resolveGoverningRole,
  roleAccessDomain,
  type AccessDomain,
} from "@/domain/contracts/features";
import { PARTNER_LIFECYCLE_STATUSES, type RoleKey } from "@/domain/contracts/taxonomy";

/** Historic alias. Onboarding-document access used to be expressed as one of
 * three legacy app_roles; it now accepts any of the nine governed RoleKeys.
 * @deprecated Use RoleKey. */
export type PartnerDocumentRole = RoleKey;

export type PartnerAccessInput = {
  loading: boolean;
  status: string;
  /** Union of the identity's legacy user_roles rows and its governed
   * assignment role — see use-auth.tsx. Empty means "no governed access yet". */
  roles: RoleKey[];
};

export type PartnerAccessFlags = {
  loading: boolean;
  status: string;
  accessLevel: "none" | "partial" | "full";
  canAccessDashboard: boolean;
  canAccessDeals: boolean;
  canAccessPipeline: boolean;
  canAccessCustomers: boolean;
  canAccessAnalytics: boolean;
  canAccessRewards: boolean;
  canAccessDocuments: boolean;
  canAccessPartnerDocuments: boolean;
  canAccessDealDocuments: boolean;
  canUploadDocuments: boolean;
  canAccessSettings: boolean;
  canAccessNews: boolean;
  canAccessPartnerOnboarding: boolean;
  canAccessPartnerAgreement: boolean;
  canAccessAdmin: boolean;
  statusLabel: string;
  isPartialApproval: boolean;
  isPendingAgreement: boolean;
  isSignedPendingReview: boolean;
  isApproved: boolean;
  // --- Added for the nine-role runtime (product.md §1.4, §5.4, §7.1). ---
  /** Which of the two team domains governs this session. */
  teamDomain: AccessDomain;
  /** True for super_admin / rm / pam / kam / isr / livey_support /
   * restricted_distributor. Internal sessions are never gated by
   * profile.partner_status. */
  isLiveyInternal: boolean;
  /** True for restricted_distributor: LIVEY-internal but participant-gated. */
  isParticipantGated: boolean;
  /** The single role that produced these flags (highest precedence held). */
  governingRole: RoleKey | null;
  /** Broad internal Partner lists (§7.1 excludes these from the Distributor
   * view). Distinct from canAccessPartnerDocuments, which is the Partner's own
   * onboarding document set. */
  canAccessPartnerDirectory: boolean;
  /** Product & Combo catalogue browsing. */
  canAccessCatalog: boolean;
  /** Pricing & Discount Policy configuration (§7.1 Administration). */
  canAccessPricingPolicy: boolean;
  /** Audit & Security / strategic audit (§7.1 Administration). */
  canAccessStrategicAudit: boolean;
};

/** All possible partner statuses in order */
export const PARTNER_STATUSES = PARTNER_LIFECYCLE_STATUSES;

export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

/** Statuses that grant partial portal access (before agreement) */
export const PARTIAL_ACCESS_STATUSES: PartnerStatus[] = [
  "partial_approval",
  "pending_agreement",
  "signed_pending_review",
  "approved",
];

/** Statuses that grant full portal access (after agreement signed) */
export const FULL_ACCESS_STATUSES: PartnerStatus[] = ["approved"];

/** Statuses that allow deal/customer/pipeline access */
export const DEAL_ACCESS_STATUSES: PartnerStatus[] = ["approved"];

/** Statuses that allow document upload */
export const DOCUMENT_UPLOAD_STATUSES: PartnerStatus[] = [
  "submitted",
  "under_review",
  "partial_approval",
  "pending_agreement",
  "signed_pending_review",
  "approved",
];

/** Check if status grants partial portal access */
export function hasPartialAccess(status: string): boolean {
  return PARTIAL_ACCESS_STATUSES.includes(status as PartnerStatus);
}

/** Check if status grants full portal access */
export function hasFullAccess(status: string): boolean {
  return FULL_ACCESS_STATUSES.includes(status as PartnerStatus);
}

/** Check if status allows deal/customer operations */
export function hasDealAccess(status: string): boolean {
  return DEAL_ACCESS_STATUSES.includes(status as PartnerStatus);
}

/** Check if status allows document upload */
export function canUploadDocuments(status: string): boolean {
  return DOCUMENT_UPLOAD_STATUSES.includes(status as PartnerStatus);
}

/** Onboarding-document access. Partner Admin administers their own Company
 * document set (§5.4); a Partner User never does. LIVEY-internal reviewers
 * read Partner documents through "View Partner: S" in §5.5 — except the
 * participant-gated Distributor, which §5.4 excludes from broad partner data. */
export function canAccessPartnerDocuments(role: PartnerDocumentRole): boolean {
  if (isParticipantGatedRole(role)) return false;
  if (isLiveyInternalRole(role)) return true;
  return role === "partner_admin";
}

export function canAccessDealDocuments(status: string): boolean {
  return hasDealAccess(status);
}

/** Full-authority flag set for Super Admin (§5.5: G on every capability). */
function superAdminFlags(loading: boolean, status: string): PartnerAccessFlags {
  return {
    loading,
    status,
    accessLevel: "full",
    canAccessDashboard: true,
    canAccessDeals: true,
    canAccessPipeline: true,
    canAccessCustomers: true,
    canAccessAnalytics: true,
    canAccessRewards: true,
    canAccessDocuments: true,
    canAccessPartnerDocuments: true,
    canAccessDealDocuments: true,
    canUploadDocuments: true,
    canAccessSettings: true,
    canAccessNews: true,
    canAccessPartnerOnboarding: true,
    canAccessPartnerAgreement: true,
    canAccessAdmin: true,
    statusLabel: getStatusLabel(status),
    isPartialApproval: false,
    isPendingAgreement: false,
    isSignedPendingReview: false,
    isApproved: true,
    teamDomain: "livey_internal",
    isLiveyInternal: true,
    isParticipantGated: false,
    governingRole: "super_admin",
    canAccessPartnerDirectory: true,
    canAccessCatalog: true,
    canAccessPricingPolicy: true,
    canAccessStrategicAudit: true,
  };
}

/** RM / PAM / KAM / ISR / LIVEY Support. These are LIVEY employees, not
 * partners: profile.partner_status describes a Partner application they never
 * filed, so it must not gate them (current gaps.md §2.1). Their real limits
 * are the §5.5 capability matrix (role_permissions, surfaced through
 * useAuth().can) plus assignment scope, both enforced server-side. */
function liveyInternalFlags(
  loading: boolean,
  status: string,
  governingRole: RoleKey,
): PartnerAccessFlags {
  return {
    loading,
    status,
    accessLevel: "full",
    canAccessDashboard: true,
    canAccessDeals: true,
    canAccessPipeline: true,
    canAccessCustomers: true,
    canAccessAnalytics: true,
    // §5.5 "Redeem rewards": only Partner Admin / Partner User hold points.
    canAccessRewards: false,
    canAccessDocuments: true,
    canAccessPartnerDocuments: true,
    canAccessDealDocuments: true,
    canUploadDocuments: true,
    canAccessSettings: true,
    canAccessNews: true,
    // Internal staff never walk the Partner onboarding or agreement journey.
    canAccessPartnerOnboarding: false,
    canAccessPartnerAgreement: false,
    // §5.5 "Manage geography / assignments / integrations": G — Super Admin only.
    canAccessAdmin: false,
    statusLabel: getStatusLabel(status),
    isPartialApproval: false,
    isPendingAgreement: false,
    isSignedPendingReview: false,
    isApproved: true,
    teamDomain: "livey_internal",
    isLiveyInternal: true,
    isParticipantGated: false,
    governingRole,
    canAccessPartnerDirectory: true,
    canAccessCatalog: true,
    canAccessPricingPolicy: false,
    canAccessStrategicAudit: false,
  };
}

/** Distributor (§5.4). LIVEY-internal — so the Partner lifecycle does not gate
 * it — but explicitly excluded by §5.4/§7.1 from "internal hierarchy
 * management, global analytics, broad partner lists, pricing-policy
 * configuration, reward administration, strategic audit, or unrestricted
 * exports".
 *
 * The record-level half of the contract — seeing ONLY explicitly tagged
 * Customers and Deals, the fulfillment-safe field projection, and the
 * `logistics.updateDistributorFulfillment` command allowlist — is a later
 * phase. Until it lands, the Deals/Customers surfaces a Distributor reaches
 * are still narrowed server-side by assignment scope in
 * table-policy.server.ts, not by these flags. */
function distributorFlags(loading: boolean, status: string): PartnerAccessFlags {
  return {
    loading,
    status,
    accessLevel: "full",
    canAccessDashboard: true,
    canAccessDeals: true,
    canAccessPipeline: true,
    canAccessCustomers: true,
    // Excluded: global analytics.
    canAccessAnalytics: false,
    // Excluded: reward administration; a Distributor holds no partner points.
    canAccessRewards: false,
    // Excluded: broad partner data. Shared fulfillment documents on a tagged
    // Deal ride on canAccessDealDocuments instead.
    canAccessDocuments: false,
    canAccessPartnerDocuments: false,
    canAccessDealDocuments: true,
    // document.uploadSharedFulfillment is a distinct, later-phase command; the
    // Partner onboarding upload surface this flag drives stays closed.
    canUploadDocuments: false,
    canAccessSettings: true,
    canAccessNews: false,
    canAccessPartnerOnboarding: false,
    canAccessPartnerAgreement: false,
    canAccessAdmin: false,
    statusLabel: getStatusLabel(status),
    isPartialApproval: false,
    isPendingAgreement: false,
    isSignedPendingReview: false,
    isApproved: true,
    teamDomain: "livey_internal",
    isLiveyInternal: true,
    isParticipantGated: true,
    governingRole: "restricted_distributor",
    canAccessPartnerDirectory: false,
    canAccessCatalog: false,
    canAccessPricingPolicy: false,
    canAccessStrategicAudit: false,
  };
}

export function getPartnerAccessFlags({
  loading,
  status,
  roles,
}: PartnerAccessInput): PartnerAccessFlags {
  const governingRole = resolveGoverningRole(roles);

  if (governingRole === "super_admin") {
    return superAdminFlags(loading, status);
  }
  if (governingRole === "restricted_distributor") {
    return distributorFlags(loading, status);
  }
  if (governingRole && isLiveyInternalRole(governingRole)) {
    return liveyInternalFlags(loading, status, governingRole);
  }

  // ---- Partner external domain (unchanged behaviour) ----------------------
  // Everything below is the Partner journey exactly as it shipped: the
  // partner_status lifecycle gate applies only here. A session with no
  // governed role at all also lands here, which keeps an unassigned account
  // on the onboarding path rather than silently granting it access.
  const isPartnerAdmin = governingRole === "partner_admin";
  const documentRole: PartnerDocumentRole = isPartnerAdmin ? "partner_admin" : "partner_user";
  const isPartialApproval = status === "partial_approval";
  const isPendingAgreement = status === "pending_agreement";
  const isSignedPendingReview = status === "signed_pending_review";
  const isApproved = status === "approved";
  const hasPartial = hasPartialAccess(status);
  const hasFull = hasFullAccess(status);
  const partnerDocumentsAccessible = canAccessPartnerDocuments(documentRole);
  const dealDocumentsAccessible = hasDealAccess(status);

  return {
    loading,
    status,
    accessLevel: hasFull ? "full" : hasPartial ? "partial" : "none",
    canAccessDashboard: hasPartial || hasFull,
    canAccessDeals: hasDealAccess(status),
    canAccessPipeline: hasDealAccess(status),
    canAccessCustomers: hasDealAccess(status),
    canAccessAnalytics: hasDealAccess(status),
    canAccessRewards: hasPartial || hasFull,
    canAccessDocuments: partnerDocumentsAccessible,
    canAccessPartnerDocuments: partnerDocumentsAccessible,
    canAccessDealDocuments: dealDocumentsAccessible,
    canUploadDocuments: partnerDocumentsAccessible && canUploadDocuments(status),
    canAccessSettings: hasPartial || hasFull,
    canAccessNews: hasPartial || hasFull,
    canAccessPartnerOnboarding: isPartnerAdmin && !hasPartial && !hasFull,
    canAccessPartnerAgreement: isPendingAgreement || isPartialApproval || isSignedPendingReview,
    canAccessAdmin: false,
    statusLabel: getStatusLabel(status),
    isPartialApproval,
    isPendingAgreement,
    isSignedPendingReview,
    isApproved,
    teamDomain: governingRole ? roleAccessDomain(governingRole) : "partner_external",
    isLiveyInternal: false,
    isParticipantGated: false,
    governingRole,
    canAccessPartnerDirectory: false,
    canAccessCatalog: hasPartial || hasFull,
    canAccessPricingPolicy: false,
    canAccessStrategicAudit: false,
  };
}

/** Get human-readable label for status */
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending_partner_registration: "Partner Registration Pending",
    submitted: "Application Submitted",
    under_review: "Under Review",
    partial_approval: "Partially Approved (Agreement Pending)",
    pending_agreement: "Agreement Sent",
    signed_pending_review: "Signed - Awaiting Review",
    approved: "Approved",
    rejected: "Rejected",
    need_more_info: "More Info Requested",
  };
  return labels[status] ?? status;
}

/** Get status progress percentage (0-100) */
export function getStatusProgress(status: string): number {
  const index = PARTNER_STATUSES.indexOf(status as PartnerStatus);
  if (index === -1) return 0;
  return Math.round((index / (PARTNER_STATUSES.length - 1)) * 100);
}
