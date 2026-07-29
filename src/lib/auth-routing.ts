import { type PartnerStatus } from "@/lib/partner-status";

type AuthRoutingInput = {
  hasSession: boolean;
  pathname: string;
  roles: string[];
  profile: {
    partner_status: PartnerStatus;
    must_reset_password: boolean;
  } | null;
};

export type AuthenticatedGateState =
  | "loading"
  | "anonymous"
  | "reset-password"
  | "onboarding"
  | "under-review"
  | "context-pending"
  | "ready";

type AuthenticatedGateInput = AuthRoutingInput & {
  hasGovernedContext: boolean;
};

const ONBOARDING_STATUSES: PartnerStatus[] = [
  "pending_partner_registration",
  "submitted",
  "under_review",
  "need_more_info",
];

export function getAuthenticatedRedirect({
  hasSession,
  pathname,
  roles,
  profile,
}: AuthRoutingInput) {
  if (!hasSession) {
    return "/auth";
  }

  if (!profile) {
    return null;
  }

  if (profile.must_reset_password && pathname !== "/settings") {
    return "/settings?passwordReset=1";
  }

  const isSuperAdmin = roles.includes("super_admin");
  const isPartnerAdmin = roles.includes("partner_admin");
  const needsOnboarding =
    isPartnerAdmin && !isSuperAdmin && ONBOARDING_STATUSES.includes(profile.partner_status);

  if (needsOnboarding && pathname !== "/partner/onboarding") {
    return "/partner/onboarding";
  }

  return null;
}

export function getAuthenticatedGateState({
  hasSession,
  pathname,
  roles,
  profile,
  hasGovernedContext,
}: AuthenticatedGateInput): AuthenticatedGateState {
  if (!hasSession) {
    return "anonymous";
  }

  if (!profile) {
    return "loading";
  }

  if (profile.must_reset_password && pathname !== "/settings") {
    return "reset-password";
  }

  const isSuperAdmin = roles.includes("super_admin");
  const isPartnerAdmin = roles.includes("partner_admin");
  const isUnderReview =
    isPartnerAdmin && profile.partner_status === "under_review" && !isSuperAdmin;
  const needsOnboarding =
    isPartnerAdmin && !isSuperAdmin && ONBOARDING_STATUSES.includes(profile.partner_status);

  if (isUnderReview) {
    return "under-review";
  }

  if (needsOnboarding) {
    return "onboarding";
  }

  if (!hasGovernedContext) {
    return "context-pending";
  }

  return "ready";
}
