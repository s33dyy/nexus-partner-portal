import { createFileRoute } from "@tanstack/react-router";
import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/partner/onboarding")({
  component: OnboardingStub,
});

function OnboardingStub() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          Partner registration · Step 2 of 2
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Business details & documents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The full onboarding form ships in Phase 2 — business info, focus areas, and GST/PAN/CIN
          document uploads, followed by LIVEY review and tier assignment.
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="rounded-md bg-primary/10 p-3 text-primary">
            <Construction className="h-6 w-6" />
          </div>
          <div className="text-lg font-medium">Phase 2 module</div>
          <p className="max-w-md text-sm text-muted-foreground">
            The multi-step registration form (Business Information, Company Details, Business
            Focus, Documents) with LIVEY review workflow is next up.
          </p>
          <Badge variant="secondary">Coming next</Badge>
        </CardContent>
      </Card>
    </div>
  );
}
