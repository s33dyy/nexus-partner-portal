// src/lib/partner-status.ts

export type PartnerDocumentRole = "super_admin" | "partner_admin" | "partner_user";
export type PartnerAccessInput = {
  loading: boolean;
  status: string;
  roles: PartnerDocumentRole[];
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
};

/** All possible partner statuses in order */
export const PARTNER_STATUSES = [
  "pending_partner_registration",
  "submitted",
  "under_review",
  "partial_approval",
  "pending_agreement",
  "signed_pending_review",
  "approved",
  "rejected",
  "need_more_info",
] as const;

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

export function canAccessPartnerDocuments(role: PartnerDocumentRole): boolean {
  return role === "super_admin" || role === "partner_admin";
}

export function canAccessDealDocuments(status: string): boolean {
  return hasDealAccess(status);
}

export function getPartnerAccessFlags({
  loading,
  status,
  roles,
}: PartnerAccessInput): PartnerAccessFlags {
  const isSuperAdmin = roles.includes("super_admin");
  const isPartnerAdmin = roles.includes("partner_admin");
  const documentRole: PartnerDocumentRole = isSuperAdmin
    ? "super_admin"
    : isPartnerAdmin
      ? "partner_admin"
      : "partner_user";
  const isPartialApproval = status === "partial_approval";
  const isPendingAgreement = status === "pending_agreement";
  const isSignedPendingReview = status === "signed_pending_review";
  const isApproved = status === "approved";
  const hasPartial = hasPartialAccess(status);
  const hasFull = hasFullAccess(status);
  const partnerDocumentsAccessible = canAccessPartnerDocuments(documentRole);
  const canAccessDealDocuments = isSuperAdmin || hasDealAccess(status);

  if (isSuperAdmin) {
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
    };
  }

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
    canAccessDealDocuments,
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
