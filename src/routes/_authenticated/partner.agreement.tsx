import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileSignature,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/partner/agreement")({
  component: AgreementPage,
});

type Partner = {
  id: string;
  company_name: string;
  agreement_envelope_id: string | null;
  agreement_sent_at: string | null;
  agreement_signed_at: string | null;
  agreement_signed_doc_path: string | null;
  agreement_provider: string | null;
  status: string;
};

export function hasRealtimeSupport(
  client: typeof supabase,
): client is typeof supabase & {
  channel: (name: string) => {
    on: (...args: unknown[]) => { subscribe: () => unknown };
  };
  removeChannel: (channel: unknown) => Promise<unknown>;
} {
  return typeof (client as { channel?: unknown }).channel === "function";
}

export function getAgreementCtaLabel(status: string) {
  return status === "partial_approval" || status === "pending_agreement"
    ? "Sign with Zoho Sign"
    : "Open Agreement";
}

function AgreementPage() {
  const { user, profile, refresh } = useAuth();
  const navigate = useNavigate();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);

  const loadPartner = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("partners")
      .select(
        "id, company_name, agreement_envelope_id, agreement_sent_at, agreement_signed_at, agreement_signed_doc_path, agreement_provider, status",
      )
      .eq("owner_user_id", user.id)
      .maybeSingle();
    setPartner((data as Partner | null) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    void loadPartner();
  }, [user]);

  // Real-time subscription — auto-refresh when partner row changes
  useEffect(() => {
    if (!partner?.id) return;
    if (!hasRealtimeSupport(supabase)) return;
    const realtime = supabase;
    const channel = realtime
      .channel(`partner-agreement-${partner.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "partners", filter: `id=eq.${partner.id}` },
        () => {
          void loadPartner();
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void realtime.removeChannel(channel);
    };
  }, [partner?.id]);

  // If partner is now approved, send them to dashboard
  useEffect(() => {
    if (profile?.partner_status === "approved") {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [profile?.partner_status, navigate]);

  const handleSignWithZohoSign = async () => {
    setSigning(true);
    try {
      const response = await fetch("/api/integrations/zoho-sign/sign-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        throw new Error("Unable to start Zoho Sign");
      }
      const data = (await response.json()) as { signingUrl?: string };
      if (!data.signingUrl) {
        throw new Error("Missing Zoho Sign URL");
      }
      const opened = window.open(data.signingUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        throw new Error("Zoho Sign popup was blocked");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to open Zoho Sign right now.",
      );
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isPartialApproval = partner?.status === 'partial_approval';
  const isSignedPendingReview =
    partner?.status === 'signed_pending_review' || !!partner?.agreement_signed_at;
  const isPendingAgreement =
    !isSignedPendingReview &&
    (partner?.status === 'pending_agreement' ||
      !!partner?.agreement_envelope_id ||
      !!partner?.agreement_sent_at);
  const isSigned = isSignedPendingReview || !!partner?.agreement_signed_at;
  const agreementCtaLabel = getAgreementCtaLabel(partner?.status ?? "");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <FileSignature className="h-3.5 w-3.5" />
          Partner Onboarding
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Partner Agreement</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isSignedPendingReview
            ? "Your signed agreement is with LIVEY for final review. Basic portal access remains available while approval is completed."
            : "Your application has been approved. Please sign the partner agreement to unlock full portal access."}
        </p>
      </div>

      {/* Status card */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card
          className={
            isSignedPendingReview
              ? "border-sky-500/40 bg-sky-500/5"
              : isSigned
                ? "border-emerald-500/40 bg-emerald-500/5"
              : isPendingAgreement
                ? "border-primary/30 bg-primary/5"
                : isPartialApproval
                  ? "border-amber-500/40 bg-amber-500/5"
                  : "border-amber-500/40 bg-amber-500/5"
          }
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {isSignedPendingReview ? (
                <Clock className="h-5 w-5 text-sky-600" />
              ) : isSigned ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : isPendingAgreement ? (
                <Clock className="h-5 w-5 text-primary" />
              ) : isPartialApproval ? (
                <AlertCircle className="h-5 w-5 text-amber-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-600" />
              )}
              {isSignedPendingReview
                ? "Agreement Signed — Awaiting Review"
                : isSigned
                  ? "Agreement Signed"
                : isPendingAgreement
                  ? "Agreement Sent — Awaiting Your Signature"
                  : isPartialApproval
                    ? "Agreement Pending — Awaiting Admin to Send"
                    : "Agreement Not Yet Available"}
            </CardTitle>
            <CardDescription>
              {isSignedPendingReview
                ? "Your signed agreement has been received. LIVEY is reviewing it before granting full approval."
                : isSigned
                  ? "Your signed agreement has been received. Your account will be fully activated shortly."
                : isPendingAgreement
                  ? "Your agreement is ready. Use the button below to open Zoho Sign in a new tab and sign digitally."
                  : isPartialApproval
                    ? "Your partner profile has been partially approved. A super admin has prepared your agreement for Zoho Sign."
                    : "An agreement will appear here once a super admin prepares it for Zoho Sign."}
            </CardDescription>
          </CardHeader>

          {isPendingAgreement && !isSigned && (
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                {partner?.agreement_sent_at && (
                  <Badge variant="secondary">
                    Sent on {new Date(partner.agreement_sent_at).toLocaleDateString("en-IN")}
                  </Badge>
                )}
                {partner?.agreement_provider && (
                  <Badge variant="outline" className="capitalize">
                    via {partner.agreement_provider === "zohosign" ? "Zoho Sign" : partner.agreement_provider}
                  </Badge>
                )}
              </div>

              <Alert>
                <FileSignature className="h-4 w-4" />
                <AlertTitle>Open Zoho Sign</AlertTitle>
                <AlertDescription>
                  Click the button below to fetch a fresh signing URL and open it in a new tab.
                </AlertDescription>
              </Alert>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSignWithZohoSign} disabled={signing}>
                  {signing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {agreementCtaLabel}
                </Button>
              </div>
            </CardContent>
          )}

          {isSignedPendingReview && (
            <CardContent>
              <div className="flex items-center gap-2 rounded-md bg-sky-500/10 px-4 py-3 text-sm text-sky-700">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Signed agreement received. Basic portal access remains active while LIVEY completes
                the final review.
              </div>
            </CardContent>
          )}

          {isSigned && !isSignedPendingReview && (
            <CardContent>
              <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                Agreement successfully signed on{" "}
                {new Date(partner!.agreement_signed_at!).toLocaleString("en-IN")}.
              </div>
            </CardContent>
          )}

          {isPartialApproval && !isSignedPendingReview && (
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 rounded-md border bg-amber-500/5 px-3 py-2 text-sm text-amber-700">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Your partner profile has been partially approved. A super admin will upload a fresh
                PDF and prepare it for Zoho Sign.
              </div>
            </CardContent>
          )}
        </Card>
      </motion.div>

      {/* What happens next */}
      <Separator />
      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          What happens next
        </div>
        <ol className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              1
            </span>
            A super admin uploads a fresh agreement PDF and prepares it through Zoho Sign.
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              2
            </span>
            You click Sign with Zoho Sign to open a fresh signing tab and complete the signature.
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              3
            </span>
            LIVEY reviews the signed agreement and then grants full portal access.
          </li>
        </ol>
      </div>
    </div>
  );
}
