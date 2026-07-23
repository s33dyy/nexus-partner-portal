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
  const isUnderReview = profile?.partner_status === "under_review" && !hasRole("super_admin");
  const needsAdminOnboarding =
    hasRole("partner_admin") &&
    profile?.partner_status !== "approved" &&
    profile?.partner_status !== "under_review";

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
      needsAdminOnboarding &&
      location.pathname !== "/partner/onboarding"
    ) {
      navigate({ to: "/partner/onboarding", replace: true });
    }
  }, [isUnderReview, loading, session, profile, needsAdminOnboarding, location.pathname, navigate]);

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

  return <>{children}</>;
}
