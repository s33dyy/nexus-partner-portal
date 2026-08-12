import { useNavigate } from "@tanstack/react-router";
import { LogOut, RefreshCcw, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

export function UnderReviewPage() {
  const { profile, refresh, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.14),_transparent_38%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--muted)/0.22))] px-4">
      <Card className="w-full max-w-xl border-dashed shadow-sm">
        <CardHeader className="space-y-4 text-center">
          <div className="tint-warning mx-auto flex h-14 w-14 items-center justify-center rounded-full text-warning-foreground">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl">Your Account Is Under Review</CardTitle>
            <CardDescription className="text-sm leading-6">
              Thanks for completing your submission, {profile?.full_name ?? "partner"}. LIVEY is
              reviewing your details and documents now.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
            You’ll regain access automatically once a super admin approves your account.
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                await refresh();
                navigate({ to: "/dashboard", replace: true });
              }}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Check again
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth", replace: true });
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
