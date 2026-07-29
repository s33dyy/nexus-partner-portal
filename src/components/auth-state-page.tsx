import { LogOut, RefreshCcw, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type AuthStatePageProps = {
  icon?: "alert";
  title: string;
  description: string;
  detail: string;
  primaryActionLabel: string;
  onPrimaryAction: () => Promise<void>;
  secondaryActionLabel: string;
  onSecondaryAction: () => Promise<void>;
  primaryHint?: string;
};

export function AuthStatePage({
  title,
  description,
  detail,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
  primaryHint,
}: AuthStatePageProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.14),_transparent_38%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--muted)/0.22))] px-4">
      <Card className="w-full max-w-xl border-dashed shadow-sm">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
            <ShieldAlert className="h-7 w-7" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl">{title}</CardTitle>
            <CardDescription className="text-sm leading-6">{description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">
            {detail}
          </div>
          {primaryHint ? (
            <div className="text-center text-xs uppercase tracking-wider text-muted-foreground">
              {primaryHint}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                await onPrimaryAction();
              }}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              {primaryActionLabel}
            </Button>
            <Button
              onClick={async (event) => {
                event.preventDefault();
                await onSecondaryAction();
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              {secondaryActionLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
