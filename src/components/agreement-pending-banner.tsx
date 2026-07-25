import { Link } from "@tanstack/react-router";
import { FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shown as a persistent top banner for partners with status = "pending_agreement".
 * Appears in the AppShell above all page content.
 */
export function AgreementPendingBanner() {
  return (
    <div className="flex items-center justify-between gap-3 border-b bg-primary/5 px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        <FileSignature className="h-4 w-4 shrink-0 text-primary" />
        <span className="font-medium">Action required:</span>
        <span className="text-muted-foreground">
          Sign your partner agreement to unlock all features.
        </span>
      </div>
      <Button size="sm" variant="default" asChild className="shrink-0">
        <Link to="/partner/agreement">Sign Agreement</Link>
      </Button>
    </div>
  );
}
