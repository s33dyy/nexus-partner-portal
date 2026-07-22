import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { NewsFeedCard } from "@/components/news-feed-card";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";
import { formatDateLabel } from "@/lib/date-utils";
import { type NewsPostRecord } from "@/lib/portal-news-data";

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
  const { pathname } = useLocation();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [notesOpen, setNotesOpen] = useState(false);
  const [metrics, setMetrics] = useState<
    { id: string; label: string; value: string; hint: string }[]
  >([]);
  const [newsPosts, setNewsPosts] = useState<NewsPostRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const currentUserId = authProfile?.id;
      const currentPartnerId = authProfile?.partner_id ?? null;
      const [profileRes, partnerRes, docsRes, notesRes, newsRes] = await Promise.all([
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
        supabase.from("portal_news_posts").select("*").order("created_at", { ascending: false }),
      ]);

      if (
        profileRes.error ||
        partnerRes.error ||
        docsRes.error ||
        notesRes.error ||
        newsRes.error
      ) {
        throw (
          profileRes.error ?? partnerRes.error ?? docsRes.error ?? notesRes.error ?? newsRes.error
        );
      }

      const profileRow = (profileRes.data as Profile | null) ?? null;
      const partnerRow = (partnerRes.data as Partner | null) ?? null;
      const docRows = (docsRes.data as DocRow[] | null) ?? [];
      const noteRows = (notesRes.data as NoteRow[] | null) ?? [];
      const newsRows = (newsRes.data as NewsPostRecord[] | null) ?? [];

      setProfile(profileRow);
      setPartner(partnerRow);
      setDocs(docRows);
      setNotes(noteRows);
      setNewsPosts(newsRows);
      setMetrics([
        {
          id: "status",
          label: "Status",
          value:
            statusLabel[
              profileRow?.partner_status ?? partnerRow?.status ?? "pending_partner_registration"
            ],
          hint: "Current registration state",
        },
        {
          id: "documents",
          label: "Documents",
          value: String(docRows.length),
          hint: "Uploaded files",
        },
        {
          id: "notes",
          label: "Review notes",
          value: String(noteRows.length),
          hint: "Internal comments",
        },
        {
          id: "focus",
          label: "Focus areas",
          value: String(partnerRow?.business_focus?.length ?? 0),
          hint: "Business areas mapped",
        },
      ]);
      setSource(
        profileRow || partnerRow || docRows.length > 0 || noteRows.length > 0 || newsRows.length > 0
          ? "database"
          : "empty",
      );
    } catch {
      setMetrics([]);
      setNewsPosts([]);
      setSource("empty");
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
  const isOnboardingChild = pathname === "/partner/onboarding";
  const isPartnerChild = pathname !== "/partner";

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

  if (!hasRole("partner_admin") && !hasRole("super_admin") && !isOnboardingChild) {
    return (
      <AccessDeniedPage
        title="Company profile"
        roleLabel="Partner Admin"
        description="Company profile management is reserved for partner operators."
      />
    );
  }

  if (isPartnerChild) {
    return <Outlet />;
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
            {source === "database" ? "Live Postgres data" : "Empty state"}
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
        {metrics.length > 0 ? (
          metrics.map((metric) => (
            <MetricCard
              key={metric.id}
              label={metric.label}
              value={metric.value}
              hint={metric.hint}
            />
          ))
        ) : (
          <Card className="sm:col-span-2 xl:col-span-4">
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div>
                <div className="text-sm font-medium">No partner metrics yet</div>
                <div className="text-xs text-muted-foreground">
                  Complete onboarding to populate this summary.
                </div>
              </div>
              <Badge variant="outline">Empty</Badge>
            </CardContent>
          </Card>
        )}
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
              {status === "approved" ? (
                notes.length > 0 ? (
                  notes.map((note) => (
                    <div key={note.id} className="rounded-lg border bg-muted/20 p-3 text-sm">
                      <div className="text-xs uppercase tracking-widest text-muted-foreground">
                        {note.status_change ?? "Note"} · {formatDateLabel(note.created_at)}
                      </div>
                      <div className="mt-2">{note.note}</div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    No review notes yet.
                  </div>
                )
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  <div>Review notes stay in a popup until your partner profile is approved.</div>
                  <Dialog open={notesOpen} onOpenChange={setNotesOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="mt-4">
                        View review notes
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>Review notes</DialogTitle>
                        <DialogDescription>
                          Internal comments from the LIVEY team while your partner profile is under
                          review.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-3">
                        {notes.length > 0 ? (
                          notes.map((note) => (
                            <div
                              key={note.id}
                              className="rounded-lg border bg-muted/20 p-3 text-sm"
                            >
                              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                                {note.status_change ?? "Note"} · {formatDateLabel(note.created_at)}
                              </div>
                              <div className="mt-2 whitespace-pre-line">{note.note}</div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                            No review notes yet.
                          </div>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">News feed</CardTitle>
            <CardDescription>
              LIVEY updates with images when available and text-only cards when not.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-6">
            {newsPosts.length > 0 ? (
              newsPosts.map((post) => <NewsFeedCard key={post.id} post={post} />)
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No news posts yet.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">What this account can do</CardTitle>
            <CardDescription>Partner access depends on registration status.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-6 text-sm text-muted-foreground">
            <div>Partner admins can manage deals, team, and document workflows.</div>
            <div>Partner users can handle onboarding and document tasks.</div>
            <Separator />
            <div>
              {status === "approved"
                ? "The account is fully approved."
                : "Complete onboarding and submit for review to unlock partner access."}
            </div>
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

const statusLabel: Record<string, string> = {
  pending_partner_registration: "Partner Registration Pending",
  submitted: "Application Submitted",
  under_review: "Under Review",
  need_more_info: "Info Requested",
  approved: "Approved",
  rejected: "Rejected",
};
