import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
  FileSignature,
  RefreshCcw,
  Upload,
} from "lucide-react";

import { CsvExportButton } from "@/components/csv-export-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LookupCombobox } from "@/components/lookup-combobox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";

import { supabase } from "@/integrations/local/client";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { useAuth } from "@/hooks/use-auth";
import { type CsvColumn } from "@/lib/csv-export";
import { recordAuditEvent, recordNotification } from "@/lib/workflow-events";

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
  // Agreement fields
  agreement_envelope_id: string | null;
  agreement_sent_at: string | null;
  agreement_signed_at: string | null;
  agreement_source_doc_path: string | null;
  agreement_signed_doc_path: string | null;
  agreement_provider: string | null;
};

type Doc = {
  id: string;
  doc_type: string;
  file_name: string;
  file_path: string;
  created_at: string;
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
  "partial_approval",
  "pending_agreement",
  "signed_pending_review",
  "approved",
  "rejected",
  "need_more_info",
] as const;

const TIERS = ["registered", "silver", "gold", "platinum"] as const;

const PARTNER_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "company_name", header: "Company Name" },
  { key: "legal_name", header: "Legal Name" },
  { key: "gst_number", header: "GST Number" },
  { key: "pan", header: "PAN" },
  { key: "cin", header: "CIN" },
  { key: "website", header: "Website" },
  { key: "business_address", header: "Business Address" },
  { key: "country", header: "Country" },
  { key: "state", header: "State" },
  { key: "business_type", header: "Business Type" },
  { key: "years_in_business", header: "Years In Business" },
  { key: "annual_turnover", header: "Annual Turnover" },
  { key: "employee_count", header: "Employee Count" },
  { key: "business_focus", header: "Business Focus" },
  { key: "status", header: "Status" },
  { key: "tier", header: "Tier" },
  { key: "owner_user_id", header: "Owner User ID" },
  { key: "created_at", header: "Created At" },
];

function tierForTurnover(band: string | null): (typeof TIERS)[number] {
  if (!band) return "registered";
  if (band.includes("250")) return "platinum";
  if (band.includes("50")) return "gold";
  if (band.includes("10")) return "silver";
  return "registered";
}

function inferAgreementRequestStatus(partner: Partner | null): string | null {
  if (
    !partner?.agreement_envelope_id &&
    !partner?.agreement_sent_at &&
    !partner?.agreement_signed_at
  ) {
    return null;
  }

  if (partner.status === "signed_pending_review" || partner.agreement_signed_at) {
    return "completed";
  }

  if (partner.status === "pending_agreement" || partner.status === "partial_approval") {
    return "pending";
  }

  return "unknown";
}

function formatAgreementRequestStatus(status: string | null): string {
  if (!status) return "Not sent";
  return (
    {
      pending: "Pending signature",
      completed: "Signed and awaiting review",
      unknown: "Unknown",
    }[status] ?? status.replace(/_/g, " ")
  );
}

function AdminPartners() {
  const { hasRole, profile } = useAuth();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("submitted");
  const [selected, setSelected] = useState<Partner | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [acting, setActing] = useState(false);
  const [sendingAgreement, setSendingAgreement] = useState(false);
  const [resyncingAgreement, setResyncingAgreement] = useState(false);
  const [agreementRequestStatus, setAgreementRequestStatus] = useState<string | null>(null);
  const [agreementDraftFile, setAgreementDraftFile] = useState<File | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [credentialPreview, setCredentialPreview] = useState<{
    email: string;
    temporaryPassword: string;
  } | null>(null);
  const agreementFileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const q = supabase.from("partners").select("*").order("created_at", { ascending: false });
    if (status !== "all") q.eq("status", status);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setPartners((data as Partner[]) ?? []);
    setLoading(false);
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadPartnerDetails = useCallback(async (partnerId: string) => {
    try {
      const partnerRes = await supabase
        .from("partners")
        .select("*")
        .eq("id", partnerId)
        .maybeSingle();
      const partnerData = partnerRes.data as Partner | null;
      if (!partnerData) {
        setSelected(null);
        setDocs([]);
        setNotes([]);
        setOwnerEmail(null);
        setAgreementRequestStatus(null);
        setAgreementDraftFile(null);
        if (agreementFileRef.current) {
          agreementFileRef.current.value = "";
        }
        return;
      }

      setDocs([]);
      setNotes([]);
      setOwnerEmail(null);
      setAgreementRequestStatus(null);
      setAgreementDraftFile(null);
      if (agreementFileRef.current) {
        agreementFileRef.current.value = "";
      }
      const [{ data: d }, { data: n }, { data: profileData }] = await Promise.all([
        supabase
          .from("partner_documents")
          .select("id, doc_type, file_name, file_path, created_at")
          .eq("partner_id", partnerId)
          .order("created_at", { ascending: false }),
        supabase
          .from("partner_review_notes")
          .select("*")
          .eq("partner_id", partnerId)
          .order("created_at", { ascending: false }),
        supabase.from("profiles").select("email").eq("id", partnerData.owner_user_id).maybeSingle(),
      ]);
      setSelected(partnerData);
      setAgreementRequestStatus(inferAgreementRequestStatus(partnerData));
      setDocs((d as Doc[]) ?? []);
      setNotes((n as Note[]) ?? []);
      setOwnerEmail((profileData as { email?: string } | null)?.email ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load partner details");
      setSelected(null);
      setDocs([]);
      setNotes([]);
      setOwnerEmail(null);
      setAgreementRequestStatus(null);
      setAgreementDraftFile(null);
      if (agreementFileRef.current) {
        agreementFileRef.current.value = "";
      }
    }
  }, []);

  const openPartner = async (p: Partner) => {
    setSelected(p);
    await loadPartnerDetails(p.id);
  };

  const openDoc = async (doc: Doc) => {
    const { data, error } = await supabase.storage
      .from("partner-documents")
      .createSignedUrl(doc.file_path, 60);
    if (error || !data) return toast.error(error?.message ?? "Failed to open");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const downloadDoc = async (doc: Doc) => {
    const { data, error } = await supabase.storage
      .from("partner-documents")
      .createSignedUrl(doc.file_path, 60);
    if (error || !data) return toast.error(error?.message ?? "Failed to download");

    const link = document.createElement("a");
    link.href = data.signedUrl;
    link.download = doc.file_name;
    link.click();
  };

  const decide = async (
    decision: "approved" | "rejected" | "under_review" | "need_more_info" | "partial_approval",
  ) => {
    if (!selected) return;
    if (
      decision === "approved" &&
      !["partial_approval", "pending_agreement", "signed_pending_review", "approved"].includes(
        selected.status,
      )
    ) {
      toast.error("Grant final approval after partial access or agreement preparation begins.");
      return;
    }
    setActing(true);
    try {
      let patch: Partial<Partner>;

      if (decision === "approved") {
        patch = { status: decision, tier: tierForTurnover(selected.annual_turnover) };
      } else if (decision === "partial_approval") {
        patch = { status: decision };
      } else {
        patch = { status: decision };
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
        await recordNotification(supabase, {
          partnerId: selected.id,
          title: `Partner ${decision.replace("_", " ")}`,
          message:
            noteDraft.trim() ||
            `Your partner application status was updated to ${decision.replace("_", " ")}.`,
          type: "status_change",
        });
        await recordAuditEvent(supabase, {
          actorName: (await supabase.auth.getUser()).data.user?.email ?? "Super Admin",
          actorRole: "super_admin",
          action: `partner_${decision}`,
          targetType: "partner",
          targetName: selected.company_name,
          outcome: decision,
          details:
            noteDraft.trim() ||
            `Partner application status updated to ${decision.replace("_", " ")}`,
          severity: decision === "approved" ? "medium" : "low",
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

  const sendAgreement = async () => {
    if (!selected) {
      toast.error("Select a partner before sending the agreement");
      return;
    }
    if (!agreementDraftFile) {
      toast.error("Please upload a PDF before sending the agreement");
      return;
    }
    setSendingAgreement(true);
    try {
      const formData = new FormData();
      formData.append("partnerId", selected.id);
      formData.append("partnerName", selected.legal_name ?? selected.company_name);
      formData.append("partnerCompany", selected.company_name);
      if (profile?.id) {
        formData.append("uploadedBy", profile.id);
      }
      formData.append("agreementFile", agreementDraftFile);

      const res = await fetch("/api/integrations/zoho-sign/send-agreement", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        requestStatus?: string;
      };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to send agreement");
      toast.success("Agreement prepared in Zoho Sign");
      setAgreementRequestStatus(data.requestStatus ?? "pending");
      await loadPartnerDetails(selected.id);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to send agreement");
    } finally {
      setSendingAgreement(false);
    }
  };

  const resyncAgreement = async () => {
    if (!selected) return;
    setResyncingAgreement(true);
    try {
      const res = await fetch("/api/integrations/zoho-sign/resync-agreement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerId: selected.id }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        requestStatus?: string | null;
        partnerStatus?: string;
      };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Failed to refresh agreement");
      setAgreementRequestStatus(data.requestStatus ?? null);
      await loadPartnerDetails(selected.id);
      toast.success(
        data.requestStatus === "completed"
          ? "Agreement marked signed and awaiting review"
          : "Agreement status refreshed",
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to refresh agreement");
    } finally {
      setResyncingAgreement(false);
    }
  };

  const approveSignedAgreement = async () => {
    if (!selected) return;
    setActing(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("partners")
        .update({
          status: "approved",
          tier: tierForTurnover(selected.annual_turnover),
          agreement_signed_at: selected.agreement_signed_at ?? now,
        })
        .eq("id", selected.id);
      if (error) throw error;
      await supabase
        .from("profiles")
        .update({ partner_status: "approved" })
        .eq("id", selected.owner_user_id);

      const tempPasswordResult = await supabase.auth.issueTemporaryPassword(selected.owner_user_id);
      if (tempPasswordResult.error || !tempPasswordResult.data) {
        throw new Error(
          tempPasswordResult.error?.message ?? "Failed to issue a temporary password",
        );
      }

      if (noteDraft.trim()) {
        await supabase.from("partner_review_notes").insert({
          partner_id: selected.id,
          author_id: (await supabase.auth.getUser()).data.user?.id ?? selected.owner_user_id,
          note: noteDraft.trim(),
          status_change: "approved",
        });
      }

      await recordNotification(supabase, {
        partnerId: selected.id,
        title: "Partner approved",
        message:
          "Your partner application was approved. Use the temporary password from the LIVEY admin confirmation to sign in and reset it immediately.",
        type: "status_change",
      });
      await recordAuditEvent(supabase, {
        actorName: (await supabase.auth.getUser()).data.user?.email ?? "Super Admin",
        actorRole: "super_admin",
        action: "partner_approved",
        targetType: "partner",
        targetName: selected.company_name,
        outcome: "approved",
        details: "Partner approved and temporary credentials issued",
        severity: "medium",
      });

      setCredentialPreview({
        email: ownerEmail ?? "Email unavailable",
        temporaryPassword: tempPasswordResult.data.temporaryPassword,
      });
      setNoteDraft("");
      toast.success("Partner approved and temporary credentials issued");
      setSelected(null);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Action failed");
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
  const sourceAgreementDoc =
    docs.find(
      (doc) =>
        doc.doc_type === "agreement_source" ||
        doc.file_path === selected?.agreement_source_doc_path,
    ) ?? null;
  const currentAgreementRequestStatus =
    agreementRequestStatus ?? inferAgreementRequestStatus(selected);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Administration
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Partner approvals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review incoming partner registrations, verify documents, and assign tiers.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
          <CsvExportButton
            label="Export CSV"
            filenameStem="livey-partner-applications"
            columns={PARTNER_EXPORT_COLUMNS}
            loadRows={async () =>
              filtered.map((partner) => ({
                company_name: partner.company_name,
                legal_name: partner.legal_name,
                gst_number: partner.gst_number,
                pan: partner.pan,
                cin: partner.cin,
                website: partner.website,
                business_address: partner.business_address,
                country: partner.country,
                state: partner.state,
                business_type: partner.business_type,
                years_in_business: partner.years_in_business,
                annual_turnover: partner.annual_turnover,
                employee_count: partner.employee_count,
                business_focus: partner.business_focus,
                status: partner.status,
                tier: partner.tier,
                owner_user_id: partner.owner_user_id,
                created_at: partner.created_at,
              }))
            }
            variant="outline"
          />
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
          <LookupCombobox
            fieldName={LOOKUP_FIELDS.partnerStatus}
            label="Status"
            value={status === "all" ? "" : status}
            onValueChange={(value) => setStatus((value || "all") as typeof status)}
            placeholder="All statuses"
            clearLabel="All statuses"
            allowClear
            options={STATUS_FILTERS.filter((s) => s !== "all")}
            triggerClassName="w-48"
          />
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
                  className="flex w-full flex-col gap-3 px-6 py-4 text-left transition sm:flex-row sm:items-center sm:justify-between sm:gap-4 hover:bg-muted/40"
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
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
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

      <Sheet
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) {
            setSelected(null);
            setDocs([]);
            setNotes([]);
            setOwnerEmail(null);
            setAgreementDraftFile(null);
            setAgreementRequestStatus(null);
            if (agreementFileRef.current) {
              agreementFileRef.current.value = "";
            }
          }
        }}
      >
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
                          className="flex flex-col gap-3 rounded-md border p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
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
                          <div className="flex flex-wrap items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => void openDoc(d)}>
                              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => void downloadDoc(d)}>
                              <Upload className="mr-1 h-3.5 w-3.5 rotate-180" /> Download
                            </Button>
                          </div>
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
                  {/* Grant Partial Access - grants portal access but agreement not sent */}
                  <Button
                    variant="outline"
                    onClick={() => void decide("partial_approval")}
                    disabled={
                      acting ||
                      selected.status === "partial_approval" ||
                      selected.status === "pending_agreement" ||
                      selected.status === "signed_pending_review" ||
                      selected.status === "approved"
                    }
                  >
                    Grant Partial Access
                  </Button>
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
                  <Button onClick={() => void approveSignedAgreement()} disabled={acting}>
                    {acting ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1 h-4 w-4" />
                    )}
                    Grant Approval
                  </Button>
                </div>

                {(selected.status === "partial_approval" ||
                  selected.status === "pending_agreement" ||
                  selected.status === "signed_pending_review") && (
                  <>
                    <Separator />
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs uppercase tracking-widest text-muted-foreground">
                          Agreement
                        </div>
                        <Badge variant="outline" className="capitalize">
                          {formatAgreementRequestStatus(currentAgreementRequestStatus)}
                        </Badge>
                      </div>

                      <div className="rounded-md border bg-muted/20 p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-medium">Current source PDF</div>
                            <div className="text-xs text-muted-foreground">
                              {sourceAgreementDoc?.file_name ??
                                (selected.agreement_source_doc_path
                                  ? selected.agreement_source_doc_path
                                  : "No source PDF uploaded yet")}
                            </div>
                          </div>
                          {sourceAgreementDoc && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void openDoc(sourceAgreementDoc)}
                            >
                              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Open
                            </Button>
                          )}
                        </div>
                      </div>

                      {selected.agreement_envelope_id && (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="secondary">
                            Request ID {selected.agreement_envelope_id.slice(0, 8)}…
                          </Badge>
                          {selected.agreement_sent_at && (
                            <Badge variant="outline">
                              Sent {new Date(selected.agreement_sent_at).toLocaleString("en-IN")}
                            </Badge>
                          )}
                          {selected.agreement_signed_at && (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/20 text-emerald-700"
                            >
                              Signed{" "}
                              {new Date(selected.agreement_signed_at).toLocaleString("en-IN")}
                            </Badge>
                          )}
                        </div>
                      )}

                      {selected.status === "partial_approval" && (
                        <div className="space-y-3 rounded-md border bg-background/70 p-3">
                          <div className="text-sm text-muted-foreground">
                            Upload a fresh PDF for this partner before preparing the Zoho Sign
                            request.
                          </div>
                          <div className="space-y-2">
                            <Input
                              ref={agreementFileRef}
                              type="file"
                              accept="application/pdf,.pdf"
                              onChange={(event) => {
                                setAgreementDraftFile(event.target.files?.[0] ?? null);
                              }}
                            />
                            {agreementDraftFile && (
                              <div className="text-xs text-muted-foreground">
                                Selected file: <strong>{agreementDraftFile.name}</strong>
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              onClick={() => void sendAgreement()}
                              disabled={sendingAgreement || !agreementDraftFile}
                            >
                              {sendingAgreement ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Upload className="mr-1 h-3.5 w-3.5" />
                              )}
                              Upload &amp; Prepare Agreement
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void resyncAgreement()}
                              disabled={resyncingAgreement || !selected.agreement_envelope_id}
                            >
                              {resyncingAgreement ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCcw className="mr-1 h-3.5 w-3.5" />
                              )}
                              Refresh Zoho Status
                            </Button>
                          </div>
                          {ownerEmail && (
                            <div className="text-xs text-muted-foreground">
                              Recipient on record: <strong>{ownerEmail}</strong>
                            </div>
                          )}
                        </div>
                      )}

                      {selected.status === "pending_agreement" && (
                        <div className="space-y-2 rounded-md border bg-primary/5 p-3">
                          <div className="flex items-center gap-2 text-sm text-primary">
                            <FileSignature className="h-4 w-4 shrink-0" />
                            Agreement prepared via{" "}
                            {selected.agreement_provider === "zohosign"
                              ? "Zoho Sign"
                              : selected.agreement_provider}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void resyncAgreement()}
                              disabled={resyncingAgreement || !selected.agreement_envelope_id}
                            >
                              {resyncingAgreement ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCcw className="mr-1 h-3.5 w-3.5" />
                              )}
                              Refresh Zoho Status
                            </Button>
                          </div>
                        </div>
                      )}

                      {selected.status === "signed_pending_review" && (
                        <div className="space-y-2 rounded-md border bg-emerald-500/5 p-3">
                          <div className="flex items-center gap-2 text-sm text-emerald-700">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            Agreement signed and awaiting super admin review.
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void resyncAgreement()}
                              disabled={resyncingAgreement || !selected.agreement_envelope_id}
                            >
                              {resyncingAgreement ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RefreshCcw className="mr-1 h-3.5 w-3.5" />
                              )}
                              Refresh Zoho Status
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => void approveSignedAgreement()}
                              disabled={acting}
                            >
                              {acting ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                              )}
                              Approve Partner
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={!!credentialPreview}
        onOpenChange={(open) => !open && setCredentialPreview(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>One-time partner credentials</DialogTitle>
            <DialogDescription>
              These credentials are shown only once. Share them securely with the approved partner
              owner and ask them to reset the password on first sign-in.
            </DialogDescription>
          </DialogHeader>
          {credentialPreview ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/20 p-4 text-sm">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Email</div>
                <div className="mt-1 font-medium">{credentialPreview.email}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4 text-sm">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Temporary password
                </div>
                <div className="mt-1 font-medium">{credentialPreview.temporaryPassword}</div>
              </div>
              <Button className="w-full" onClick={() => setCredentialPreview(null)}>
                Close
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    submitted: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    under_review: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    partial_approval: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    need_more_info: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    pending_agreement: "bg-violet-500/10 text-violet-600 border-violet-500/20",
    signed_pending_review: "bg-sky-500/10 text-sky-600 border-sky-500/20",
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
      <div className="grid gap-3 rounded-md border bg-muted/20 p-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="text-sm">
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="truncate">
        {v?.trim() ? v : <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}
