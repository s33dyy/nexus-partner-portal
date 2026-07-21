import { Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            {eyebrow}
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
        <Badge variant="secondary">MVP stub</Badge>
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">What this page will cover</CardTitle>
          <CardDescription>
            The nav is wired. This page is ready for the next round of product work.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {bullets.map((bullet) => (
              <div key={bullet} className="rounded-lg border bg-muted/30 p-4 text-sm">
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
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          You need <span className="font-medium text-foreground">{roleLabel}</span> access to view
          this page.
        </div>
        <Button asChild variant="outline">
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
