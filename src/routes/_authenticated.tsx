import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { UnderReviewPage } from "@/components/under-review-page";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPartialAccess } from "@/lib/partner-status";

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
  const status = profile?.partner_status ?? "pending_partner_registration";

  // Partners who are under_review have no portal access at all
  const isUnderReview = hasRole("partner_admin") && status === "under_review" && !hasRole("super_admin");

  // Partners who haven't reached basic portal access must complete onboarding first.
  const needsOnboarding =
    hasRole("partner_admin") &&
    !hasRole("super_admin") &&
    (status === "pending_partner_registration" ||
      status === "submitted" ||
      status === "under_review" ||
      status === "need_more_info");

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

  // Basic-access partners pass through — AppShell will show the appropriate banner
  return <>{children}</>;
}
