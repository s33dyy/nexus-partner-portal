import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { FileSignature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAgreementCtaLabel } from "@/routes/_authenticated/partner.agreement";

/**
 * Shown as a persistent top banner for partners in the pre-signature agreement workflow.
 * Appears in the AppShell above all page content.
 */
export function AgreementPendingBanner() {
  const { profile } = useAuth();
  const status = profile?.partner_status ?? 'pending_partner_registration';
  
  // Only show while an agreement still needs to be sent or signed
  if (
    status !== 'partial_approval' &&
    status !== 'pending_agreement'
  ) {
    return null;
  }
  
  const message =
    status === 'partial_approval'
      ? 'Your partner profile has been partially approved. Open the agreement page to launch Zoho Sign in a new tab.'
      : 'Your agreement is ready. Open the agreement page and click the sign button to continue.';
  const ctaLabel = getAgreementCtaLabel(status);
  
  return (
    <div className="flex items-center justify-between gap-3 border-b bg-amber-500/10 px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        <FileSignature className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="font-medium">Action Required:</span>
        <span className="text-muted-foreground">{message}</span>
      </div>
      <Button size="sm" variant="default" asChild className="shrink-0">
        <Link to="/partner/agreement">{ctaLabel}</Link>
      </Button>
    </div>
  );
}
