import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { FileSignature, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Shown as a persistent top banner for partners with status = "pending_agreement" or "partial_approval".
 * Appears in the AppShell above all page content.
 */
export function AgreementPendingBanner() {
  const { profile } = useAuth();
  const status = profile?.partner_status ?? 'pending_partner_registration';
  
  // Only show for partial_approval or pending_agreement
  if (status !== 'partial_approval' && status !== 'pending_agreement') {
    return null;
  }
  
  const isPartialApproval = status === 'partial_approval';
  
  return (
    <div className="flex items-center justify-between gap-3 border-b bg-amber-500/10 px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        <FileSignature className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="font-medium">{isPartialApproval ? 'Action Required:' : 'Action Required:'}</span>
        <span className="text-muted-foreground">
          {isPartialApproval
            ? 'Your partner profile has been partially approved. Please sign the agreement to unlock full portal access.'
            : 'Sign your partner agreement to unlock all features.'}
        </span>
      </div>
      <Button size="sm" variant="default" asChild className="shrink-0">
        <Link to="/partner/agreement">Sign Agreement</Link>
      </Button>
    </div>
  );
}
