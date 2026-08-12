import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2,
  MapPin,
  Target,
  FileUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Trash2,
  FileText,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LookupCombobox } from "@/components/lookup-combobox";

import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";
import { usePartnerAccess } from "@/hooks/use-partner-access";
import {
  PARTNER_ONBOARDING_LOOKUP_FIELDS,
  regionLookupField,
} from "@/lib/partner-onboarding-lookups";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";

export const Route = createFileRoute("/_authenticated/partner/onboarding")({
  component: OnboardingPage,
});

type StepKey = "business" | "company" | "focus" | "documents" | "review";

const STEPS: { key: StepKey; label: string; icon: React.ComponentType<{ className?: string }> }[] =
  [
    { key: "business", label: "Business Info", icon: Building2 },
    { key: "company", label: "Company Details", icon: MapPin },
    { key: "focus", label: "Business Focus", icon: Target },
    { key: "documents", label: "Documents", icon: FileUp },
    { key: "review", label: "Review & Submit", icon: CheckCircle2 },
  ];

const FOCUS_AREAS = [
  "Cloud Infrastructure",
  "Cybersecurity",
  "Data & Analytics",
  "AI / ML",
  "SaaS Resale",
  "Managed Services",
  "System Integration",
  "Consulting & Advisory",
  "Hardware & Networking",
  "Vertical Solutions",
];

const REQUIRED_DOC_TYPES = ["GST Certificate", "PAN Card", "CIN / Incorporation"] as const;

const businessSchema = z.object({
  company_name: z.string().trim().min(2, "Company name is required").max(120),
  legal_name: z.string().trim().max(160).optional().or(z.literal("")),
  gst_number: z.string().trim().max(30).optional().or(z.literal("")),
  pan: z.string().trim().max(20).optional().or(z.literal("")),
  cin: z.string().trim().max(30).optional().or(z.literal("")),
  website: z.string().trim().max(200).optional().or(z.literal("")),
});

const companySchema = z.object({
  business_address: z.string().trim().min(5, "Address is required").max(500),
  country: z.string().trim().min(2).max(60),
  state: z.string().trim().min(1).max(60),
  business_type: z.string().min(1, "Select a business type"),
  years_in_business: z.coerce.number().int().min(0).max(200),
  annual_turnover: z.string().min(1, "Select turnover band"),
  employee_count: z.string().min(1, "Select employee band"),
});

type Form = z.infer<typeof businessSchema> &
  z.infer<typeof companySchema> & {
    business_focus: string[];
  };

type DocRow = {
  id: string;
  doc_type: string;
  file_name: string;
  file_path: string;
  size_bytes: number | null;
};

function isDocRow(doc: DocRow | null | undefined): doc is DocRow {
  return Boolean(doc?.id && doc?.doc_type && doc?.file_name && doc?.file_path);
}

function OnboardingPage() {
  const { user, profile, refresh, loading } = useAuth();
  const access = usePartnerAccess();
  const navigate = useNavigate();
  const [stepIdx, setStepIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({
    company_name: profile?.company_name ?? "",
    legal_name: "",
    gst_number: "",
    pan: "",
    cin: "",
    website: "",
    business_address: "",
    country: "India",
    state: "",
    business_type: "",
    years_in_business: 0,
    annual_turnover: "",
    employee_count: "",
    business_focus: [],
  });

  useEffect(() => {
    if (loading) return;
    if (access.canAccessPartnerDocuments) return;
    navigate({ to: "/dashboard", replace: true });
  }, [access.canAccessPartnerDocuments, loading, navigate]);

  // Redirect if already past onboarding stage
  useEffect(() => {
    if (profile?.partner_status === "partial_approval") {
      navigate({ to: "/partner/agreement", replace: true });
    } else if (profile?.partner_status === "pending_agreement") {
      navigate({ to: "/partner/agreement", replace: true });
    } else if (profile?.partner_status === "signed_pending_review") {
      navigate({ to: "/dashboard", replace: true });
    } else if (profile?.partner_status === "approved") {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [profile?.partner_status, navigate]);

  const status = profile?.partner_status ?? "pending_partner_registration";
  const readOnly =
    status === "submitted" ||
    status === "under_review" ||
    status === "partial_approval" ||
    status === "pending_agreement" ||
    status === "signed_pending_review" ||
    status === "approved";
  const regionFieldName = regionLookupField(form.country);

  // Load existing partner if any
  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data } = await supabase
        .from("partners")
        .select("*")
        .eq("owner_user_id", user.id)
        .maybeSingle();
      const partner = data as {
        id: string;
        company_name: string | null;
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
      } | null;
      if (partner) {
        setPartnerId(partner.id);
        setForm((f) => ({
          ...f,
          company_name: partner.company_name ?? f.company_name,
          legal_name: partner.legal_name ?? "",
          gst_number: partner.gst_number ?? "",
          pan: partner.pan ?? "",
          cin: partner.cin ?? "",
          website: partner.website ?? "",
          business_address: partner.business_address ?? "",
          country: partner.country ?? "India",
          state: partner.state ?? "",
          business_type: partner.business_type ?? "",
          years_in_business: partner.years_in_business ?? 0,
          annual_turnover: partner.annual_turnover ?? "",
          employee_count: partner.employee_count ?? "",
          business_focus: partner.business_focus ?? [],
        }));
        const { data: d } = await supabase
          .from("partner_documents")
          .select("id, doc_type, file_name, file_path, size_bytes")
          .eq("partner_id", partner.id)
          .order("created_at", { ascending: false });
        setDocs(((d as Array<DocRow | null | undefined>) ?? []).filter(isDocRow));
      }
    })();
  }, [user]);

  const progress = ((stepIdx + 1) / STEPS.length) * 100;
  const step = STEPS[stepIdx];

  const setField = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const persistDraft = async (): Promise<string | null> => {
    if (!user) return null;
    setSaving(true);
    try {
      const recordId = partnerId ?? globalThis.crypto.randomUUID();
      const payload = {
        id: recordId,
        owner_user_id: user.id,
        company_name: form.company_name || "Unnamed Company",
        legal_name: form.legal_name || null,
        gst_number: form.gst_number || null,
        pan: form.pan || null,
        cin: form.cin || null,
        website: form.website || null,
        business_address: form.business_address || null,
        country: form.country || null,
        state: form.state || null,
        business_type: form.business_type || null,
        years_in_business: form.years_in_business || null,
        annual_turnover: form.annual_turnover || null,
        employee_count: form.employee_count || null,
        business_focus: form.business_focus,
      };
      let id = partnerId;
      if (!id) {
        const { data: existingPartner, error: lookupError } = await supabase
          .from("partners")
          .select("id")
          .eq("owner_user_id", user.id)
          .maybeSingle();
        if (lookupError) throw lookupError;
        id = (existingPartner as { id: string } | null)?.id ?? null;
        if (id) {
          setPartnerId(id);
        }
      }
      if (!id) {
        const { data, error } = await supabase
          .from("partners")
          .insert(payload)
          .select("id")
          .single();
        if (error) {
          const duplicateOwner =
            error.message.includes("duplicate key value violates unique constraint") ||
            error.message.includes("partners_owner_user_id_key");
          if (!duplicateOwner) throw error;

          const { data: conflictedPartner, error: conflictLookupError } = await supabase
            .from("partners")
            .select("id")
            .eq("owner_user_id", user.id)
            .maybeSingle();
          if (conflictLookupError) throw conflictLookupError;
          id = (conflictedPartner as { id: string } | null)?.id ?? null;
          if (!id) throw error;

          const { error: retryError } = await supabase
            .from("partners")
            .update(payload)
            .eq("id", id);
          if (retryError) throw retryError;
        } else {
          id = (data as { id: string } | null)?.id ?? null;
          if (!id) throw new Error("Failed to create partner record");
        }
        setPartnerId(id);
        // link profile.partner_id
        await supabase.from("profiles").update({ partner_id: id }).eq("id", user.id);
      } else {
        const { error } = await supabase.from("partners").update(payload).eq("id", id);
        if (error) throw error;
      }
      return id;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save";
      toast.error(msg);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const validateStep = (): boolean => {
    if (step.key === "business") {
      const r = businessSchema.safeParse(form);
      if (!r.success) {
        toast.error(r.error.issues[0]?.message ?? "Please review the form");
        return false;
      }
    }
    if (step.key === "company") {
      const r = companySchema.safeParse(form);
      if (!r.success) {
        toast.error(r.error.issues[0]?.message ?? "Please review the form");
        return false;
      }
    }
    if (step.key === "focus" && form.business_focus.length === 0) {
      toast.error("Select at least one focus area");
      return false;
    }
    return true;
  };

  const goToStep = async (targetIdx: number) => {
    const nextIdx = Math.max(0, Math.min(targetIdx, STEPS.length - 1));
    if (nextIdx === stepIdx) return;
    if (readOnly) {
      setStepIdx(nextIdx);
      return;
    }
    if (
      nextIdx > stepIdx &&
      (step.key === "business" || step.key === "company" || step.key === "focus")
    ) {
      if (!validateStep()) return;
      const id = await persistDraft();
      if (!id) return;
    }
    setStepIdx(nextIdx);
  };

  const goNext = async () => {
    await goToStep(stepIdx + 1);
  };

  const goPrev = () => setStepIdx((i) => Math.max(i - 1, 0));

  const uploadDoc = async (docType: string, file: File) => {
    if (!user) return;
    let id = partnerId;
    if (!id) {
      id = await persistDraft();
      if (!id) return;
    }
    setUploadingType(docType);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${id}/${docType.replace(/\W+/g, "_")}_${Date.now()}.${ext}`;
      const { data: upResult, error: upErr } = await supabase.storage
        .from("partner-documents")
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;
      const storedPath = upResult?.path ?? path;
      try {
        const { data: row, error: insErr } = await supabase
          .from("partner_documents")
          .insert({
            partner_id: id,
            uploaded_by: user.id,
            doc_type: docType,
            file_path: storedPath,
            file_name: file.name,
            mime_type: file.type,
            size_bytes: file.size,
          })
          .select("id, doc_type, file_name, file_path, size_bytes")
          .single();
        if (insErr) throw insErr;
        const docRow = row as DocRow | null;
        if (!isDocRow(docRow)) {
          throw new Error("Uploaded file saved, but the partner document row was not returned");
        }
        setDocs((d) => [docRow, ...d.filter(isDocRow)]);
      } catch (insertError) {
        await supabase.storage.from("partner-documents").remove([storedPath]);
        throw insertError;
      }
      toast.success(`${docType} uploaded`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast.error(msg);
    } finally {
      setUploadingType(null);
    }
  };

  const removeDoc = async (doc: DocRow) => {
    try {
      await supabase.storage.from("partner-documents").remove([doc.file_path]);
      await supabase.from("partner_documents").delete().eq("id", doc.id);
      setDocs((d) => d.filter((x) => x.id !== doc.id));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast.error(msg);
    }
  };

  const submit = async () => {
    if (!user) return;
    const id = partnerId ?? (await persistDraft());
    if (!id) return;
    const validDocs = docs.filter(isDocRow);
    if (validDocs.length === 0) {
      toast.error("Please upload at least one supporting document");
      return;
    }
    setSubmitting(true);
    try {
      const { error: pErr } = await supabase
        .from("partners")
        .update({ status: "submitted" })
        .eq("id", id);
      if (pErr) throw pErr;
      const { error: prErr } = await supabase
        .from("profiles")
        .update({ partner_status: "submitted" })
        .eq("id", user.id);
      if (prErr) throw prErr;
      await refresh();
      toast.success("Registration submitted for review");
      navigate({ to: "/dashboard" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Submission failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const docsByType = useMemo(() => {
    const m = new Map<string, DocRow[]>();
    for (const d of docs.filter(isDocRow)) {
      const arr = m.get(d.doc_type) ?? [];
      arr.push(d);
      m.set(d.doc_type, arr);
    }
    return m;
  }, [docs]);
  const validDocs = useMemo(() => docs.filter(isDocRow), [docs]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        eyebrow={`Partner registration · Step ${stepIdx + 1} of ${STEPS.length}`}
        title="Complete your partner profile"
        description="Share your business details so LIVEY can verify and assign your partner tier."
      />

      {readOnly && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>
            {status === "approved"
              ? "Your registration is approved"
              : status === "signed_pending_review"
                ? "Agreement submitted for review"
                : "Submitted for review"}
          </AlertTitle>
          <AlertDescription>
            {status === "approved"
              ? "You have full access to the partner portal."
              : status === "signed_pending_review"
                ? "Your signed agreement is with LIVEY for final review. Details are read-only while the account remains on basic access."
                : "The LIVEY partner team is reviewing your application. Details are read-only."}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        <Progress value={progress} />
        <div className="flex flex-wrap gap-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = i === stepIdx;
            const done = i < stepIdx;
            return (
              <button
                key={s.key}
                onClick={() => void goToStep(i)}
                className={
                  "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition " +
                  (active
                    ? "border-primary bg-primary/10 text-primary"
                    : done
                      ? "border-border bg-muted text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <step.icon className="h-5 w-5 text-primary" />
            {step.label}
          </CardTitle>
          <CardDescription>{descriptionFor(step.key)}</CardDescription>
        </CardHeader>
        <CardContent>
          <AnimatePresence mode="wait">
            <motion.div
              key={step.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              {step.key === "business" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Company name*">
                    <Input
                      value={form.company_name}
                      onChange={(e) => setField("company_name", e.target.value)}
                      disabled={readOnly}
                      maxLength={120}
                    />
                  </Field>
                  <Field label="Legal / registered name">
                    <Input
                      value={form.legal_name ?? ""}
                      onChange={(e) => setField("legal_name", e.target.value)}
                      disabled={readOnly}
                      maxLength={160}
                    />
                  </Field>
                  <Field label="GST number">
                    <Input
                      value={form.gst_number ?? ""}
                      onChange={(e) => setField("gst_number", e.target.value.toUpperCase())}
                      disabled={readOnly}
                      maxLength={30}
                    />
                  </Field>
                  <Field label="PAN">
                    <Input
                      value={form.pan ?? ""}
                      onChange={(e) => setField("pan", e.target.value.toUpperCase())}
                      disabled={readOnly}
                      maxLength={20}
                    />
                  </Field>
                  <Field label="CIN">
                    <Input
                      value={form.cin ?? ""}
                      onChange={(e) => setField("cin", e.target.value.toUpperCase())}
                      disabled={readOnly}
                      maxLength={30}
                    />
                  </Field>
                  <Field label="Website">
                    <Input
                      value={form.website ?? ""}
                      onChange={(e) => setField("website", e.target.value)}
                      placeholder="https://"
                      disabled={readOnly}
                      maxLength={200}
                    />
                  </Field>
                </div>
              )}

              {step.key === "company" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Business address*" className="md:col-span-2">
                    <Textarea
                      value={form.business_address}
                      onChange={(e) => setField("business_address", e.target.value)}
                      disabled={readOnly}
                      rows={3}
                      maxLength={500}
                    />
                  </Field>
                  <Field label="Country*">
                    <LookupCombobox
                      fieldName={LOOKUP_FIELDS.countryCode}
                      label="Country"
                      value={form.country}
                      onValueChange={(value) => {
                        setField("country", value);
                        setField("state", "");
                      }}
                      placeholder="Select a country"
                      disabled={readOnly}
                      allowClear={false}
                      allowCreate={false}
                      emptyLabel="No matching country. Try a different search."
                    />
                  </Field>
                  <Field label="Region / State*">
                    <LookupCombobox
                      fieldName={regionFieldName}
                      label="Region"
                      value={form.state}
                      onValueChange={(value) => setField("state", value)}
                      placeholder="Select or create region"
                      disabled={readOnly}
                      allowClear={false}
                    />
                  </Field>
                  <Field label="Business type*">
                    <LookupCombobox
                      fieldName={PARTNER_ONBOARDING_LOOKUP_FIELDS.businessType}
                      label="Business type"
                      value={form.business_type}
                      onValueChange={(value) => setField("business_type", value)}
                      placeholder="Select or create business type"
                      disabled={readOnly}
                      allowClear={false}
                    />
                  </Field>
                  <Field label="Years in business*">
                    <Input
                      type="number"
                      min={0}
                      value={form.years_in_business}
                      onChange={(e) => setField("years_in_business", Number(e.target.value))}
                      disabled={readOnly}
                    />
                  </Field>
                  <Field label="Annual turnover*">
                    <LookupCombobox
                      fieldName={PARTNER_ONBOARDING_LOOKUP_FIELDS.annualTurnover}
                      label="Annual turnover"
                      value={form.annual_turnover}
                      onValueChange={(value) => setField("annual_turnover", value)}
                      placeholder="Select or create turnover band"
                      disabled={readOnly}
                      allowClear={false}
                    />
                  </Field>
                  <Field label="Employee count*">
                    <LookupCombobox
                      fieldName={PARTNER_ONBOARDING_LOOKUP_FIELDS.employeeCount}
                      label="Employee count"
                      value={form.employee_count}
                      onValueChange={(value) => setField("employee_count", value)}
                      placeholder="Select or create employee band"
                      disabled={readOnly}
                      allowClear={false}
                    />
                  </Field>
                </div>
              )}

              {step.key === "focus" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {FOCUS_AREAS.map((area) => {
                    const checked = form.business_focus.includes(area);
                    return (
                      <label
                        key={area}
                        className={
                          "flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm transition " +
                          (checked
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40")
                        }
                      >
                        <Checkbox
                          checked={checked}
                          disabled={readOnly}
                          onCheckedChange={(v) => {
                            const on = Boolean(v);
                            setField(
                              "business_focus",
                              on
                                ? [...form.business_focus, area]
                                : form.business_focus.filter((x) => x !== area),
                            );
                          }}
                        />
                        <span>{area}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {step.key === "documents" && (
                <div className="space-y-4">
                  {REQUIRED_DOC_TYPES.map((t) => {
                    const list = docsByType.get(t) ?? [];
                    const busy = uploadingType === t;
                    return (
                      <div key={t} className="rounded-md border p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-sm font-medium">{t}</div>
                            <div className="text-xs text-muted-foreground">
                              PDF, PNG or JPG · up to 10 MB
                            </div>
                          </div>
                          {!readOnly && (
                            <div className="inline-flex">
                              <input
                                id={`upload-${t.replace(/\s+/g, "-")}`}
                                type="file"
                                className="hidden"
                                accept=".pdf,image/png,image/jpeg"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) void uploadDoc(t, f);
                                  e.currentTarget.value = "";
                                }}
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() =>
                                  document
                                    .getElementById(`upload-${t.replace(/\s+/g, "-")}`)
                                    ?.click()
                                }
                              >
                                {busy ? (
                                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <FileUp className="mr-2 h-3.5 w-3.5" />
                                )}
                                Upload
                              </Button>
                            </div>
                          )}
                        </div>
                        {list.length > 0 && (
                          <ul className="mt-3 space-y-2">
                            {list.map((d) => (
                              <li
                                key={d.id}
                                className="flex flex-col gap-2 rounded border bg-muted/30 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="flex items-center gap-2 truncate">
                                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                                  <span className="truncate">{d.file_name}</span>
                                  {d.size_bytes && (
                                    <span className="text-muted-foreground">
                                      {formatBytes(d.size_bytes)}
                                    </span>
                                  )}
                                </div>
                                {!readOnly && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => void removeDoc(d)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {step.key === "review" && (
                <div className="space-y-6">
                  <ReviewBlock title="Business Information">
                    <ReviewRow label="Company" value={form.company_name} />
                    <ReviewRow label="Legal name" value={form.legal_name} />
                    <ReviewRow label="GST" value={form.gst_number} />
                    <ReviewRow label="PAN" value={form.pan} />
                    <ReviewRow label="CIN" value={form.cin} />
                    <ReviewRow label="Website" value={form.website} />
                  </ReviewBlock>
                  <ReviewBlock title="Company Details">
                    <ReviewRow label="Address" value={form.business_address} />
                    <ReviewRow label="Country" value={form.country} />
                    <ReviewRow label="Region / State" value={form.state} />
                    <ReviewRow label="Business type" value={form.business_type} />
                    <ReviewRow label="Years in business" value={String(form.years_in_business)} />
                    <ReviewRow label="Turnover" value={form.annual_turnover} />
                    <ReviewRow label="Employees" value={form.employee_count} />
                  </ReviewBlock>
                  <ReviewBlock title="Business Focus">
                    <div className="flex flex-wrap gap-2">
                      {form.business_focus.length === 0 && (
                        <span className="text-sm text-muted-foreground">None selected</span>
                      )}
                      {form.business_focus.map((f) => (
                        <Badge key={f} variant="secondary">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  </ReviewBlock>
                  <ReviewBlock title="Documents">
                    {validDocs.length === 0 ? (
                      <span className="text-sm text-muted-foreground">
                        No documents uploaded yet
                      </span>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {validDocs.map((d) => (
                          <li key={d.id} className="flex items-center gap-2">
                            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="font-medium">{d.doc_type}:</span>
                            <span className="text-muted-foreground">{d.file_name}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </ReviewBlock>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          <Separator className="my-6" />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="outline" onClick={goPrev} disabled={stepIdx === 0}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {saving && (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Saving draft…
                </>
              )}
            </div>
            {stepIdx < STEPS.length - 1 ? (
              <Button onClick={() => void goNext()} disabled={saving}>
                Continue <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={() => void submit()} disabled={submitting || readOnly}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit for review
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={"space-y-1.5 " + (className ?? "")}>
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">{title}</div>
      <div className="grid gap-2 rounded-md border bg-muted/20 p-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="text-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate">
        {value?.trim() ? value : <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function descriptionFor(k: StepKey) {
  switch (k) {
    case "business":
      return "Legal identity and compliance identifiers used to verify your organization.";
    case "company":
      return "Where you're based and how you're structured.";
    case "focus":
      return "Choose the practice areas your team operates in — used for tier and deal matching.";
    case "documents":
      return "Upload the supporting documents for verification. Files are private and only visible to LIVEY reviewers.";
    case "review":
      return "Review your submission and send it for LIVEY review.";
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
