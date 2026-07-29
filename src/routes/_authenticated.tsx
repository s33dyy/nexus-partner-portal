import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthStatePage } from "@/components/auth-state-page";
import { AccessDeniedPage } from "@/components/route-placeholder";
import { UnderReviewPage } from "@/components/under-review-page";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { getAuthenticatedGateState, getAuthenticatedRedirect } from "@/lib/auth-routing";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <AuthProvider>
      <Gate>
        <AppShell>
          <Outlet />
        </AppShell>
      </Gate>
    </AuthProvider>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { loading, session, profile, hasRole, roles, activeContext, assignment, refresh, signOut } =
    useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const status = profile?.partner_status ?? "pending_partner_registration";
  const hasGovernedContext = Boolean(assignment && activeContext);

  // Partners who are under_review have no portal access at all
  const isUnderReview =
    hasRole("partner_admin") && status === "under_review" && !hasRole("super_admin");
  const gateState = getAuthenticatedGateState({
    hasSession: Boolean(session),
    pathname: location.pathname,
    roles,
    profile: profile
      ? {
          partner_status: profile.partner_status,
          must_reset_password: profile.must_reset_password,
        }
      : null,
    hasGovernedContext,
  });

  useEffect(() => {
    const redirect = getAuthenticatedRedirect({
      hasSession: Boolean(session),
      pathname: location.pathname,
      roles,
      profile: profile
        ? {
            partner_status: profile.partner_status,
            must_reset_password: profile.must_reset_password,
          }
        : null,
    });

    if (!loading && redirect === "/auth") {
      navigate({ to: "/auth", replace: true });
    }

    if (!loading && redirect === "/partner/onboarding") {
      navigate({ to: "/partner/onboarding", replace: true });
    }

    if (!loading && redirect === "/settings?passwordReset=1") {
      navigate({ to: "/settings", search: { passwordReset: "1" }, replace: true });
    }
  }, [loading, location.pathname, navigate, profile, roles, session]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="w-full max-w-md space-y-3 p-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  if (!profile) {
    return (
      <AuthStatePage
        title="Loading account details"
        description="Your session is valid, but the portal has not loaded your profile yet."
        detail="LIVEY is syncing your profile, role assignments, and governed context. Refresh to try again, or sign out and back in if this keeps happening."
        primaryActionLabel="Check again"
        onPrimaryAction={async () => {
          await refresh();
        }}
        secondaryActionLabel="Sign out"
        onSecondaryAction={async () => {
          await signOut();
          navigate({ to: "/auth", replace: true });
        }}
        primaryHint="Profile loading is expected to be brief"
      />
    );
  }

  if (isUnderReview) {
    return <UnderReviewPage />;
  }

  if (profile.partner_status === "rejected") {
    return (
      <AccessDeniedPage
        title="Access restricted"
        roleLabel={hasRole("super_admin") ? "super admin" : "partner access"}
        description="This account has been rejected and does not have portal access."
      />
    );
  }

  if (!assignment) {
    return (
      <AuthStatePage
        title="Assignment pending"
        description="Your account is authenticated, but no governed assignment has been issued yet."
        detail="LIVEY does not grant business access from identity alone. A valid Assignment must exist before an Active Context can be issued and the shell can open."
        primaryActionLabel="Check again"
        onPrimaryAction={async () => {
          await refresh();
        }}
        secondaryActionLabel="Sign out"
        onSecondaryAction={async () => {
          await signOut();
          navigate({ to: "/auth", replace: true });
        }}
        primaryHint="Assignments are issued server-side"
      />
    );
  }

  if (gateState === "context-pending") {
    return (
      <AuthStatePage
        title="Active context unavailable"
        description="Your account is authenticated, but the server has not issued a working context yet."
        detail="LIVEY only authorises business actions through a current Assignment and Active Context. If this persists, your access may still be provisioning or awaiting a reassignment."
        primaryActionLabel="Check again"
        onPrimaryAction={async () => {
          await refresh();
        }}
        secondaryActionLabel="Sign out"
        onSecondaryAction={async () => {
          await signOut();
          navigate({ to: "/auth", replace: true });
        }}
        primaryHint="Phase 1 requires server-issued context before the shell opens"
      />
    );
  }

  // Basic-access partners pass through once the governed context exists.
  return <>{children}</>;
}
