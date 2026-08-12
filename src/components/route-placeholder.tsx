import { Link } from "@tanstack/react-router";
import { ArrowRight, Lock, Sparkles } from "lucide-react";

import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type RoutePlaceholderProps = {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  ctaLabel?: string;
  ctaTo?: string;
};

type AccessDeniedProps = {
  title: string;
  roleLabel: string;
  description?: string;
};

export function RoutePlaceholderPage({
  eyebrow,
  title,
  description,
  bullets,
  ctaLabel = "Back to dashboard",
  ctaTo = "/dashboard",
}: RoutePlaceholderProps) {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={eyebrow}
        icon={<Sparkles className="h-3.5 w-3.5" />}
        title={title}
        description={description}
        actions={<Badge tone="neutral">MVP stub</Badge>}
      />

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>What this page will cover</CardTitle>
          <CardDescription>
            The nav is wired. This page is ready for the next round of product work.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {bullets.map((bullet) => (
              <div key={bullet} className="rounded-md border bg-secondary/50 p-3 text-[13px]">
                {bullet}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to={ctaTo}>
                {ctaLabel}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

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
