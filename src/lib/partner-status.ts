// src/lib/partner-status.ts

/** All possible partner statuses in order */
export const PARTNER_STATUSES = [
  'pending_partner_registration',
  'submitted',
  'under_review',
  'partial_approval',
  'pending_agreement',
  'signed_pending_review',
  'approved',
  'rejected',
  'need_more_info',
] as const;

export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

/** Statuses that grant partial portal access (before agreement) */
export const PARTIAL_ACCESS_STATUSES: PartnerStatus[] = [
  'partial_approval',
  'pending_agreement',
  'signed_pending_review',
  'approved',
];

/** Statuses that grant full portal access (after agreement signed) */
export const FULL_ACCESS_STATUSES: PartnerStatus[] = [
  'approved',
];

/** Statuses that allow deal/customer/pipeline access */
export const DEAL_ACCESS_STATUSES: PartnerStatus[] = [
  'approved',
];

/** Statuses that allow document upload */
export const DOCUMENT_UPLOAD_STATUSES: PartnerStatus[] = [
  'submitted',
  'under_review',
  'partial_approval',
  'pending_agreement',
  'signed_pending_review',
  'approved',
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

/** Get human-readable label for status */
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending_partner_registration: 'Partner Registration Pending',
    submitted: 'Application Submitted',
    under_review: 'Under Review',
    partial_approval: 'Partially Approved (Agreement Pending)',
    pending_agreement: 'Agreement Sent',
    signed_pending_review: 'Signed - Awaiting Review',
    approved: 'Approved',
    rejected: 'Rejected',
    need_more_info: 'More Info Requested',
  };
  return labels[status] ?? status;
}

/** Get status progress percentage (0-100) */
export function getStatusProgress(status: string): number {
  const index = PARTNER_STATUSES.indexOf(status as PartnerStatus);
  if (index === -1) return 0;
  return Math.round((index / (PARTNER_STATUSES.length - 1)) * 100);
}
