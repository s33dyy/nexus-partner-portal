import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/app-shell";
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

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/auth", replace: true });
    }
    if (
      !loading &&
      session &&
      profile &&
      !hasRole("super_admin") &&
      profile.partner_status !== "approved" &&
      location.pathname !== "/partner/onboarding"
    ) {
      navigate({ to: "/partner/onboarding", replace: true });
    }
  }, [loading, session, profile, hasRole, location.pathname, navigate]);

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

  return <>{children}</>;
}
