import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ShieldCheck,
  Search,
  FileText,
  Loader2,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Building2,
  ExternalLink,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/admin/partners")({
  component: AdminPartners,
});

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
  years_in_business: number | null;
  annual_turnover: string | null;
  employee_count: string | null;
  business_focus: string[] | null;
  status: string;
  tier: string;
  owner_user_id: string;
  created_at: string;
};

type Doc = {
  id: string;
  doc_type: string;
  file_name: string;
  file_path: string;
};

type Note = {
  id: string;
  note: string;
  status_change: string | null;
  created_at: string;
  author_id: string;
};

const STATUS_FILTERS = [
  "all",
  "submitted",
  "under_review",
  "need_more_info",
  "approved",
  "rejected",
] as const;

const TIERS = ["registered", "silver", "gold", "platinum"] as const;

function tierForTurnover(band: string | null): (typeof TIERS)[number] {
  if (!band) return "registered";
  if (band.includes("250")) return "platinum";
  if (band.includes("50")) return "gold";
  if (band.includes("10")) return "silver";
  return "registered";
}

function AdminPartners() {
  const { hasRole } = useAuth();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("submitted");
  const [selected, setSelected] = useState<Partner | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [acting, setActing] = useState(false);

  const load = async () => {
    setLoading(true);
    const q = supabase
      .from("partners")
      .select("*")
      .order("created_at", { ascending: false });
    if (status !== "all") q.eq("status", status);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setPartners((data as Partner[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [status]);

  const openPartner = async (p: Partner) => {
    setSelected(p);
    setDocs([]);
    setNotes([]);
    const [{ data: d }, { data: n }] = await Promise.all([
      supabase
        .from("partner_documents")
        .select("id, doc_type, file_name, file_path")
        .eq("partner_id", p.id),
      supabase
        .from("partner_review_notes")
        .select("*")
        .eq("partner_id", p.id)
        .order("created_at", { ascending: false }),
    ]);
    setDocs((d as Doc[]) ?? []);
    setNotes((n as Note[]) ?? []);
  };

  const openDoc = async (doc: Doc) => {
    const { data, error } = await supabase.storage
      .from("partner-documents")
      .createSignedUrl(doc.file_path, 60);
    if (error || !data) return toast.error(error?.message ?? "Failed to open");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const decide = async (
    decision: "approved" | "rejected" | "under_review" | "need_more_info",
  ) => {
    if (!selected) return;
    setActing(true);
    try {
      const patch: { status: string; tier?: string } = { status: decision };
      if (decision === "approved") {
        patch.tier = tierForTurnover(selected.annual_turnover);
      }
      const { error } = await supabase.from("partners").update(patch).eq("id", selected.id);
      if (error) throw error;

      await supabase
        .from("profiles")
        .update({ partner_status: decision })
        .eq("id", selected.owner_user_id);

      if (noteDraft.trim() || decision) {
        await supabase.from("partner_review_notes").insert({
          partner_id: selected.id,
          author_id: (await supabase.auth.getUser()).data.user?.id ?? selected.owner_user_id,
          note: noteDraft.trim() || `Status set to ${decision}`,
          status_change: decision,
        });
      }
      toast.success(`Partner ${decision.replace("_", " ")}`);
      setNoteDraft("");
      setSelected(null);
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Action failed";
      toast.error(msg);
    } finally {
      setActing(false);
    }
  };

  if (!hasRole("super_admin")) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          You need Super Admin access to view this page.
        </CardContent>
      </Card>
    );
  }

  const filtered = partners.filter(
    (p) =>
      !query ||
      p.company_name.toLowerCase().includes(query.toLowerCase()) ||
      (p.gst_number ?? "").toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Administration
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Partner approvals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review incoming partner registrations, verify documents, and assign tiers.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search company or GST"
              className="pl-8"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "all" ? "All statuses" : s.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No partner applications in this view.
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => void openPartner(p)}
                  className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition hover:bg-muted/40"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.company_name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {p.state || "—"} · {p.business_type || "—"} · GST {p.gst_number || "—"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {p.tier}
                    </Badge>
                    <StatusBadge status={p.status} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  {selected.company_name}
                </SheetTitle>
                <SheetDescription className="flex items-center gap-2">
                  <StatusBadge status={selected.status} />
                  <Badge variant="outline" className="capitalize">
                    Tier · {selected.tier}
                  </Badge>
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <Section title="Business Information">
                  <KV k="Legal name" v={selected.legal_name} />
                  <KV k="GST" v={selected.gst_number} />
                  <KV k="PAN" v={selected.pan} />
                  <KV k="CIN" v={selected.cin} />
                  <KV k="Website" v={selected.website} />
                </Section>

                <Section title="Company Details">
                  <KV k="Address" v={selected.business_address} />
                  <KV k="Country" v={selected.country} />
                  <KV k="State" v={selected.state} />
                  <KV k="Type" v={selected.business_type} />
                  <KV k="Years" v={selected.years_in_business?.toString()} />
                  <KV k="Turnover" v={selected.annual_turnover} />
                  <KV k="Employees" v={selected.employee_count} />
                </Section>

                <Section title="Business Focus">
                  <div className="col-span-2 flex flex-wrap gap-1.5">
                    {(selected.business_focus ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">None</span>
                    ) : (
                      selected.business_focus!.map((f) => (
                        <Badge key={f} variant="secondary">
                          {f}
                        </Badge>
                      ))
                    )}
                  </div>
                </Section>

                <div>
                  <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                    Documents
                  </div>
                  {docs.length === 0 ? (
                    <div className="rounded-md border p-4 text-xs text-muted-foreground">
                      No documents uploaded.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {docs.map((d) => (
                        <li
                          key={d.id}
                          className="flex items-center justify-between rounded-md border p-3 text-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <div className="truncate font-medium">{d.doc_type}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {d.file_name}
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void openDoc(d)}
                          >
                            <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                    Review notes
                  </div>
                  <Textarea
                    rows={3}
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Add an internal note (optional)…"
                    maxLength={1000}
                  />
                  {notes.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {notes.map((n) => (
                        <li key={n.id} className="rounded-md border bg-muted/30 p-3 text-xs">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <MessageSquare className="h-3 w-3" />
                            {new Date(n.created_at).toLocaleString()}
                            {n.status_change && (
                              <Badge variant="outline" className="capitalize">
                                {n.status_change.replace("_", " ")}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 text-sm">{n.note}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <Separator />

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void decide("under_review")}
                    disabled={acting}
                  >
                    Mark under review
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void decide("need_more_info")}
                    disabled={acting}
                  >
                    Request more info
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => void decide("rejected")}
                    disabled={acting}
                  >
                    <XCircle className="mr-1 h-4 w-4" /> Reject
                  </Button>
                  <Button onClick={() => void decide("approved")} disabled={acting}>
                    {acting ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1 h-4 w-4" />
                    )}
                    Approve
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    submitted: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    under_review: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    need_more_info: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
    rejected: "bg-red-500/10 text-red-600 border-red-500/20",
    pending_partner_registration: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={
        "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize " +
        (map[status] ?? "border-border text-muted-foreground")
      }
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">{title}</div>
      <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-4">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="text-sm">
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="truncate">{v?.trim() ? v : <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}
