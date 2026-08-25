import { Link } from "@tanstack/react-router";
import { Lock, PackageOpen } from "lucide-react";

import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type AccessDeniedProps = {
  title: string;
  roleLabel: string;
  description?: string;
};

export function AccessDeniedPage({
  title,
  roleLabel,
  description = "This section is available to a more privileged workspace role.",
}: AccessDeniedProps) {
  return (
    <Card>
      <EmptyState
        icon={<Lock className="h-5 w-5" />}
        title={title}
        description={
          <>
            {description} You need <span className="font-medium text-foreground">{roleLabel}</span>{" "}
            access to view this page.
          </>
        }
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
    </Card>
  );
}

/**
 * The page a route renders when its product surface is not enabled here.
 *
 * Distinct from AccessDeniedPage on purpose. Access denied means "this
 * exists and you may not see it"; this means "this is not switched on in
 * this deployment", which is true for every role including Super Admin —
 * see server/feature-gates.server.ts, which fails closed with no admin
 * bypass. It shows no roadmap, no feature tour, and no action, because
 * there is nothing here to act on: a route that advertises what it *will*
 * do is the placeholder problem this component replaced.
 *
 * The route must render this *instead of* issuing its data queries, not
 * alongside them — a hidden surface that still fetches is only hidden in
 * the screenshot.
 */
export function FeatureUnavailablePage({
  title,
  description = "This capability is not enabled in this workspace.",
}: {
  title: string;
  description?: string;
}) {
  return (
    <Card>
      <EmptyState
        icon={<PackageOpen className="h-5 w-5" />}
        title={title}
        description={description}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        }
      />
    </Card>
  );
}
