import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { UnderReviewPage } from "@/components/under-review-page";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
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
  const { loading, session, profile, hasRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // Partners who are under_review have no portal access at all
  const isUnderReview =
    hasRole("partner_admin") &&
    profile?.partner_status === "under_review" &&
    !hasRole("super_admin");

  // Partners with pending_agreement get partial portal access (with a banner).
  // They can navigate freely — no redirect needed.
  const isPendingAgreement =
    hasRole("partner_admin") &&
    profile?.partner_status === "pending_agreement" &&
    !hasRole("super_admin");

  // Partners who haven't started onboarding (or are need_more_info/rejected/submitted)
  // must complete onboarding first.
  const needsOnboarding =
    hasRole("partner_admin") &&
    !hasRole("super_admin") &&
    profile?.partner_status !== "approved" &&
    profile?.partner_status !== "under_review" &&
    profile?.partner_status !== "pending_agreement";

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/auth", replace: true });
    }
    if (!loading && session && profile && isUnderReview) {
      return;
    }
    if (
      !loading &&
      session &&
      profile &&
      needsOnboarding &&
      location.pathname !== "/partner/onboarding"
    ) {
      navigate({ to: "/partner/onboarding", replace: true });
    }
  }, [isUnderReview, loading, session, profile, needsOnboarding, location.pathname, navigate]);

  if (loading || !session || !profile) {
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

  if (isUnderReview) {
    return <UnderReviewPage />;
  }

  // pending_agreement partners pass through — AppShell will show the banner
  return <>{children}</>;
}
