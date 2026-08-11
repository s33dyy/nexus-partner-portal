// src/hooks/use-partner-access.ts

import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { getPartnerAccessFlags } from "@/lib/partner-status";

export type AccessLevel = "none" | "partial" | "full";

export function usePartnerAccess() {
  const { profile, roles, loading } = useAuth();

  return getPartnerAccessFlags({
    loading,
    status: profile?.partner_status ?? "pending_partner_registration",
    roles,
  });
}

/** Hook for route-level guards - redirects if access denied */
export function useRequireAccess(required: "partial" | "full" = "partial") {
  const access = usePartnerAccess();
  const navigate = useNavigate();

  useEffect(() => {
    if (access.loading) return;

    const hasAccess =
      required === "partial" ? access.accessLevel !== "none" : access.accessLevel === "full";

    if (!hasAccess) {
      if (
        access.status === "pending_partner_registration" ||
        access.status === "submitted" ||
        access.status === "under_review" ||
        access.status === "need_more_info"
      ) {
        navigate({ to: "/partner/onboarding", replace: true });
      } else if (
        (access.status === "partial_approval" ||
          access.status === "pending_agreement" ||
          access.status === "signed_pending_review") &&
        required === "full"
      ) {
        navigate({ to: "/partner/agreement", replace: true });
      } else if (access.status === "rejected") {
        navigate({ to: "/dashboard", replace: true });
      } else {
        navigate({ to: "/dashboard", replace: true });
      }
    }
  }, [access.loading, access.accessLevel, access.status, required, navigate]);

  return access;
}
