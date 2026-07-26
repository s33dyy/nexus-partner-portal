// src/hooks/use-partner-access.ts

import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '@/hooks/use-auth';
import { 
  hasPartialAccess, 
  hasFullAccess, 
  hasDealAccess, 
  canUploadDocuments, 
  getStatusLabel 
} from '@/lib/partner-status';

export type AccessLevel = 'none' | 'partial' | 'full';

export function usePartnerAccess() {
  const { profile, hasRole, loading } = useAuth();
  
  const status = profile?.partner_status ?? 'pending_partner_registration';
  const isSuperAdmin = hasRole('super_admin');
  
  // Super admins always have full access; partner accounts follow workflow status.
  if (isSuperAdmin) {
    return {
      loading,
      status,
      accessLevel: 'full' as AccessLevel,
      canAccessDashboard: true,
      canAccessDeals: true,
      canAccessPipeline: true,
      canAccessCustomers: true,
      canAccessAnalytics: true,
      canAccessRewards: true,
      canAccessDocuments: true,
      canUploadDocuments: true,
      canAccessSettings: true,
      canAccessNews: true,
      canAccessPartnerOnboarding: true,
      canAccessPartnerAgreement: true,
      canAccessAdmin: isSuperAdmin,
      statusLabel: getStatusLabel(status),
      isPartialApproval: false,
      isPendingAgreement: false,
      isSignedPendingReview: false,
      isApproved: true,
    };
  }
  
  const isPartialApproval = status === 'partial_approval';
  const isPendingAgreement = status === 'pending_agreement';
  const isSignedPendingReview = status === 'signed_pending_review';
  const isApproved = status === 'approved';
  const hasPartial = hasPartialAccess(status);
  const hasFull = hasFullAccess(status);
  
  return {
    loading,
    status,
    accessLevel: hasFull ? 'full' : hasPartial ? 'partial' : 'none',
    canAccessDashboard: hasPartial || hasFull,
    canAccessDeals: hasDealAccess(status),
    canAccessPipeline: hasDealAccess(status),
    canAccessCustomers: hasDealAccess(status),
    canAccessAnalytics: hasDealAccess(status),
    canAccessRewards: hasPartial || hasFull,
    canAccessDocuments: hasPartial || hasFull,
    canUploadDocuments: canUploadDocuments(status),
    canAccessSettings: hasPartial || hasFull,
    canAccessNews: hasPartial || hasFull,
    canAccessPartnerOnboarding: !hasPartial && !hasFull, // Only before partial approval
    canAccessPartnerAgreement: isPendingAgreement || isPartialApproval || isSignedPendingReview,
    canAccessAdmin: false,
    statusLabel: getStatusLabel(status),
    isPartialApproval,
    isPendingAgreement,
    isSignedPendingReview,
    isApproved,
  };
}

/** Hook for route-level guards - redirects if access denied */
export function useRequireAccess(required: 'partial' | 'full' = 'partial') {
  const access = usePartnerAccess();
  const navigate = useNavigate();
  
  useEffect(() => {
    if (access.loading) return;
    
    const hasAccess = required === 'partial' 
      ? access.accessLevel !== 'none'
      : access.accessLevel === 'full';
      
    if (!hasAccess) {
      if (
        access.status === 'pending_partner_registration' ||
        access.status === 'submitted' ||
        access.status === 'under_review' ||
        access.status === 'need_more_info'
      ) {
        navigate({ to: '/partner/onboarding', replace: true });
      } else if (
        (access.status === 'partial_approval' ||
          access.status === 'pending_agreement' ||
          access.status === 'signed_pending_review') &&
        required === 'full'
      ) {
        navigate({ to: '/partner/agreement', replace: true });
      } else if (access.status === 'rejected') {
        navigate({ to: '/dashboard', replace: true });
      } else {
        navigate({ to: '/dashboard', replace: true });
      }
    }
  }, [access.loading, access.accessLevel, access.status, required, navigate]);
  
  return access;
}
