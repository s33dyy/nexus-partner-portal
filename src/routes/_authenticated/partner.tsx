import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedPage } from "@/components/route-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/local/client";
import { DEMO_FEED_ITEMS, DEMO_METRICS, DEMO_PARTNER_SPOTLIGHTS } from "@/lib/demo-content";
import type { DemoFeedItem, DemoMetric, DemoPartnerSpotlight } from "@/lib/demo-content";
import { useAuth } from "@/hooks/use-auth";

type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  partner_status: string;
  partner_id: string | null;
};

type Partner = {
  id: string;
  company_name: string;
  legal_name: string | null;
  gst_number: string | null;
  pan: string | null;
  cin: string | null;
  website: string | null;
  business_address: string | null;
  country: string | null;
  state: string | null;
  business_type: string | null;
  annual_turnover: string | null;
  employee_count: string | null;
  business_focus: string[] | null;
  status: string;
  tier: string;
  created_at: string;
};

type DocRow = {
  id: string;
  doc_type: string;
  file_name: string;
  created_at: string;
};

type NoteRow = {
  id: string;
  note: string;
  status_change: string | null;
  created_at: string;
};

export const Route = createFileRoute("/_authenticated/partner")({
  component: PartnerPage,
});

function PartnerPage() {
  const { hasRole, profile: authProfile } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [metrics, setMetrics] = useState<DemoMetric[]>([]);
  const [feedItems, setFeedItems] = useState<DemoFeedItem[]>([]);
  const [spotlights, setSpotlights] = useState<DemoPartnerSpotlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "fallback" | "empty">("empty");
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const currentUserId = authProfile?.id;
      const currentPartnerId = authProfile?.partner_id ?? null;
      const [profileRes, partnerRes, docsRes, notesRes, metricsRes, feedRes, spotlightRes] =
        await Promise.all([
          currentUserId
            ? supabase.from("profiles").select("*").eq("id", currentUserId).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          currentPartnerId
            ? supabase.from("partners").select("*").eq("id", currentPartnerId).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          currentPartnerId
            ? supabase
                .from("partner_documents")
                .select("id, doc_type, file_name, created_at")
                .eq("partner_id", currentPartnerId)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
          currentPartnerId
            ? supabase
                .from("partner_review_notes")
                .select("id, note, status_change, created_at")
                .eq("partner_id", currentPartnerId)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
          supabase.from("portal_demo_metrics").select("*").order("sort_order", { ascending: true }),
          supabase
            .from("portal_demo_feed_items")
            .select("*")
            .order("sort_order", { ascending: true }),
          supabase
            .from("portal_demo_partner_spotlights")
            .select("*")
            .order("sort_order", { ascending: true }),
        ]);

      if (profileRes.error || partnerRes.error || docsRes.error || notesRes.error) {
        throw profileRes.error ?? partnerRes.error ?? docsRes.error ?? notesRes.error;
      }

      const profileRow = (profileRes.data as Profile | null) ?? null;
      const partnerRow = (partnerRes.data as Partner | null) ?? null;
      const docRows = (docsRes.data as DocRow[] | null) ?? [];
      const noteRows = (notesRes.data as NoteRow[] | null) ?? [];
      const metricRows = (metricsRes.data as DemoMetric[] | null) ?? [];
      const feedRows = (feedRes.data as DemoFeedItem[] | null) ?? [];
      const spotlightRows = (spotlightRes.data as DemoPartnerSpotlight[] | null) ?? [];

      setProfile(profileRow);
      setPartner(partnerRow);
      setDocs(docRows);
      setNotes(noteRows);
      setMetrics(metricRows.length > 0 ? metricRows : DEMO_METRICS);
      setFeedItems(feedRows.length > 0 ? feedRows : DEMO_FEED_ITEMS);
      setSpotlights(spotlightRows.length > 0 ? spotlightRows : DEMO_PARTNER_SPOTLIGHTS);
      setSource(profileRow || partnerRow || docRows.length > 0 ? "database" : "empty");
    } catch {
      setMetrics(DEMO_METRICS);
      setFeedItems(DEMO_FEED_ITEMS);
      setSpotlights(DEMO_PARTNER_SPOTLIGHTS);
      setSource("fallback");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authProfile?.id, authProfile?.partner_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const status = profile?.partner_status ?? partner?.status ?? "pending_partner_registration";
  const progress =
    status === "approved" ? 100 : status === "submitted" ? 75 : status === "under_review" ? 55 : 30;

  const submitForReview = async () => {
    if (!profile?.id || !partner?.id) {
      toast.error("Partner profile is not ready yet");
      return;
    }
    setUpdating(true);
    try {
      const results = await Promise.all([
        supabase.from("profiles").update({ partner_status: "submitted" }).eq("id", profile.id),
        supabase.from("partners").update({ status: "submitted" }).eq("id", partner.id),
      ]);
      const error = results.find((result) => result.error)?.error;
      if (error) throw error;
      toast.success("Profile submitted for review");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit profile");
    } finally {
      setUpdating(false);
    }
  };

  if (!hasRole("partner_admin") && !hasRole("super_admin")) {
    return (
      <AccessDeniedPage
        title="Company profile"
        roleLabel="Partner Admin"
        description="Company profile management is reserved for partner operators."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" />
            Company
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {partner?.company_name ?? profile?.company_name ?? "Company profile"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Keep your partner record, documents, and review status aligned in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {source === "fallback" ? "Fallback demo data" : "Seeded demo data"}
          </Badge>
          <Button
            variant="outline"
            onClick={() => {
              setRefreshing(true);
              void load();
            }}
            disabled={loading || refreshing}
          >
            {loading || refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
          <Button asChild variant="outline">
            <Link to="/partner/onboarding">
              <Upload className="mr-2 h-4 w-4" />
              Continue onboarding
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.id}
            label={metric.label}
            value={metric.value}
            hint={metric.hint}
          />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Profile snapshot</CardTitle>
            <CardDescription>Review the company record that powers partner access.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading profile...
              </div>
            ) : partner ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{status}</Badge>
                  <Badge variant="outline">{partner.tier}</Badge>
                  <Badge variant="secondary">{partner.business_type ?? "Business"}</Badge>
                </div>
                <Progress value={progress} className="h-2" />
                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <Meta label="Legal name" value={partner.legal_name ?? "Not set"} />
                  <Meta label="Website" value={partner.website ?? "Not set"} />
                  <Meta label="GST" value={partner.gst_number ?? "Not set"} />
                  <Meta label="PAN" value={partner.pan ?? "Not set"} />
                  <Meta
                    label="Region"
                    value={[partner.state, partner.country].filter(Boolean).join(", ")}
                  />
                  <Meta label="Turnover" value={partner.annual_turnover ?? "Not set"} />
                </div>
                <Separator />
                <div className="space-y-2">
                  <div className="text-sm font-medium">Business focus</div>
                  <div className="flex flex-wrap gap-2">
                    {(partner.business_focus ?? []).map((focus) => (
                      <Badge key={focus} variant="outline">
                        {focus}
                      </Badge>
                    ))}
                    {(partner.business_focus ?? []).length === 0 && (
                      <span className="text-sm text-muted-foreground">
                        No focus areas added yet.
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void submitForReview()}
                    disabled={updating || status === "submitted" || status === "approved"}
                  >
                    {updating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    Submit for review
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/documents">Open documents</Link>
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No partner profile found for the signed-in account yet.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Document checklist</CardTitle>
              <CardDescription>See what is already uploaded for this partner.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-6">
              {docs.length > 0 ? (
                docs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between rounded-lg border bg-muted/20 p-3 text-sm"
                  >
                    <div>
                      <div className="font-medium">{doc.doc_type}</div>
                      <div className="text-muted-foreground">{doc.file_name}</div>
                    </div>
                    <Badge variant="outline">Uploaded</Badge>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No documents uploaded yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Latest review notes</CardTitle>
              <CardDescription>Recent internal comments tied to this partner.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-6">
              {notes.length > 0 ? (
                notes.map((note) => (
                  <div key={note.id} className="rounded-lg border bg-muted/20 p-3 text-sm">
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">
                      {note.status_change ?? "Note"} ·{" "}
                      {new Date(note.created_at).toLocaleDateString()}
                    </div>
                    <div className="mt-2">{note.note}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No review notes yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Activity feed</CardTitle>
            <CardDescription>Seeded product updates and partner activity.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-6">
            {feedItems.map((item) => (
              <div key={item.id} className="rounded-lg border bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{item.title}</div>
                  <Badge variant="outline">{item.time_label}</Badge>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{item.body}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Partner spotlight</CardTitle>
            <CardDescription>A few seeded accounts and their pipeline pulse.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-6">
            {spotlights.map((spotlight) => (
              <div key={spotlight.id} className="rounded-lg border bg-muted/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{spotlight.company_name}</div>
                    <div className="text-sm text-muted-foreground">
                      {spotlight.contact_name} · {spotlight.region}
                    </div>
                  </div>
                  <Badge>{spotlight.status}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                  <div>{spotlight.tier}</div>
                  <div>{spotlight.pipeline_value}</div>
                  <div>{spotlight.last_activity}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div className="text-sm text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
