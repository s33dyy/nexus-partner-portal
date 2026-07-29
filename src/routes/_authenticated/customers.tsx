import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Plus, RefreshCw, Search, Upload, Users } from "lucide-react";
import { toast } from "sonner";

import { CsvExportButton } from "@/components/csv-export-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LookupCombobox } from "@/components/lookup-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/local/client";
import { applyPartnerScope } from "@/lib/partner-scope";
import {
  CUSTOMER_IMPORT_TEMPLATE_COLUMNS,
  CUSTOMER_IMPORT_TEMPLATE_SAMPLE,
  validateCustomerImportRows,
} from "@/lib/customer-import";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { formatDateTimeLabel, toDateInputValue } from "@/lib/date-utils";
import { type CsvColumn } from "@/lib/csv-export";
import { ImportFeedback } from "@/lib/import-feedback";
import { type CustomerActivityRecord, type CustomerRecord } from "@/lib/portal-records";
import {
  buildImportSummaryMessage,
  downloadTemplateCsv,
  parseSpreadsheetFile,
  validateImportTemplate,
  type ImportValidationError,
} from "@/lib/spreadsheet-import";
import { useAuth } from "@/hooks/use-auth";
import { useRequireAccess } from "@/hooks/use-partner-access";

type CustomerForm = {
  company_name: string;
  account_owner: string;
  region: string;
  segment: string;
  health_score: number;
  mrr: string;
  renewal_date: string;
  status: string;
  next_step: string;
  last_touch: string;
};

const EMPTY_FORM: CustomerForm = {
  company_name: "",
  account_owner: "",
  region: "India West",
  segment: "Mid-market",
  health_score: 70,
  mrr: "$5K",
  renewal_date: "",
  status: "active",
  next_step: "Schedule QBR",
  last_touch: "Today",
};

const HEALTH_SCORE_OPTIONS = [0, 25, 50, 75, 100] as const;
const LAST_TOUCH_OPTIONS = [
  "Today",
  "This week",
  "Last week",
  "30+ days ago",
  "Needs follow up",
] as const;

const CUSTOMER_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "company_name", header: "Company" },
  { key: "account_owner", header: "Account Owner" },
  { key: "region", header: "Region" },
  { key: "segment", header: "Segment" },
  { key: "health_score", header: "Health Score" },
  { key: "mrr", header: "MRR" },
  { key: "renewal_date", header: "Renewal Date" },
  { key: "status", header: "Status" },
  { key: "next_step", header: "Next Step" },
  { key: "last_touch", header: "Last Touch" },
];

function uniqueStrings(values: Array<string | null | undefined>) {
  return [
    ...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)),
  ];
}

export const Route = createFileRoute("/_authenticated/customers")({
  component: CustomersPage,
});

function CustomersPage() {
  const { profile, hasRole } = useAuth();
  const access = useRequireAccess("full");

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [activities, setActivities] = useState<CustomerActivityRecord[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<CustomerForm>(EMPTY_FORM);
  const [activityDraft, setActivityDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingActivity, setSavingActivity] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportValidationError[]>([]);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("portal_customers")
        .select("*")
        .order("updated_at", { ascending: false });
      let activityQuery = supabase
        .from("portal_customer_activities")
        .select("*")
        .order("created_at", { ascending: false });

      query = applyPartnerScope(query, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
      });
      activityQuery = applyPartnerScope(activityQuery, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
        fallbackColumn: "actor_id",
      });

      const [{ data, error }, { data: activityData, error: activityError }] = await Promise.all([
        query,
        activityQuery,
      ]);
      if (error || activityError) throw error ?? activityError;
      const rows = ((data as CustomerRecord[] | null) ?? []).map((customer) => ({
        ...customer,
        renewal_date: toDateInputValue(customer.renewal_date),
      }));
      const activityRows = (activityData as CustomerActivityRecord[] | null) ?? [];
      setCustomers(rows);
      setActivities(activityRows);
      setSource(rows.length > 0 ? "database" : "empty");
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
    } catch {
      setCustomers([]);
      setActivities([]);
      setSource("empty");
      setSelectedId(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hasRole, profile?.id, profile?.partner_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredCustomers = useMemo(() => {
    const term = query.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesStatus = statusFilter === "all" || customer.status === statusFilter;
      const matchesQuery =
        !term ||
        [
          customer.company_name,
          customer.account_owner,
          customer.region,
          customer.segment,
          customer.next_step,
        ]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesStatus && matchesQuery;
    });
  }, [customers, query, statusFilter]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedId) ?? null,
    [customers, selectedId],
  );
  const selectedActivities = useMemo(
    () => activities.filter((activity) => activity.customer_id === selectedId),
    [activities, selectedId],
  );

  const editOptions = useMemo(() => {
    return {
      owners: uniqueStrings(customers.map((customer) => customer.account_owner)),
      regions: uniqueStrings(customers.map((customer) => customer.region)),
      segments: uniqueStrings(customers.map((customer) => customer.segment)),
      mrrs: uniqueStrings(customers.map((customer) => customer.mrr)),
      statuses: uniqueStrings(customers.map((customer) => customer.status)),
    };
  }, [customers]);

  const stats = useMemo(() => {
    const total = customers.length;
    const avg =
      total === 0
        ? 0
        : Math.round(customers.reduce((sum, customer) => sum + customer.health_score, 0) / total);
    const active = customers.filter((customer) => customer.status === "active").length;
    return { total, avg, active };
  }, [customers]);

  const createCustomer = async () => {
    if (!draft.company_name.trim() || !draft.account_owner.trim() || !draft.renewal_date) {
      toast.error("Company, owner, and renewal date are required");
      return;
    }
    setAdding(true);
    try {
      const payload = {
        id: globalThis.crypto.randomUUID(),
        ...draft,
        health_score: Number(draft.health_score) || 0,
        user_id: profile?.id,
        partner_id: profile?.partner_id,
        is_seed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("portal_customers").insert(payload);
      if (error) throw error;
      toast.success("Customer added");
      setDraft(EMPTY_FORM);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add customer");
    } finally {
      setAdding(false);
    }
  };

  const saveCustomer = async () => {
    if (!selectedCustomer) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("portal_customers")
        .update({
          company_name: draft.company_name,
          account_owner: draft.account_owner,
          region: draft.region,
          segment: draft.segment,
          health_score: draft.health_score,
          mrr: draft.mrr,
          renewal_date: draft.renewal_date,
          status: draft.status,
          next_step: draft.next_step,
          last_touch: draft.last_touch,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedCustomer.id);
      if (error) throw error;
      toast.success("Customer updated");
      setEditOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save customer");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!selectedCustomer) return;
    setActivityDraft("");
    setDraft({
      company_name: selectedCustomer.company_name,
      account_owner: selectedCustomer.account_owner,
      region: selectedCustomer.region,
      segment: selectedCustomer.segment,
      health_score: selectedCustomer.health_score,
      mrr: selectedCustomer.mrr,
      renewal_date: toDateInputValue(selectedCustomer.renewal_date),
      status: selectedCustomer.status,
      next_step: selectedCustomer.next_step,
      last_touch: selectedCustomer.last_touch,
    });
  }, [selectedCustomer]);

  const saveActivity = async () => {
    if (!selectedCustomer) return;
    if (!activityDraft.trim()) {
      toast.error("Add an activity note before saving");
      return;
    }

    setSavingActivity(true);
    try {
      const now = new Date().toISOString();
      const { error: activityError } = await supabase.from("portal_customer_activities").insert({
        id: globalThis.crypto.randomUUID(),
        customer_id: selectedCustomer.id,
        partner_id: selectedCustomer.partner_id,
        actor_id: profile?.id ?? null,
        actor_name: profile?.full_name ?? "LIVEY User",
        summary: activityDraft.trim(),
        next_step: draft.next_step.trim() || null,
        created_at: now,
      });
      if (activityError) throw activityError;

      const { error: customerError } = await supabase
        .from("portal_customers")
        .update({
          next_step: draft.next_step,
          last_touch: draft.last_touch || "Today",
          updated_at: now,
        })
        .eq("id", selectedCustomer.id);
      if (customerError) throw customerError;

      toast.success("Activity saved");
      setActivityDraft("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save activity");
    } finally {
      setSavingActivity(false);
    }
  };

  const downloadImportTemplate = () => {
    downloadTemplateCsv({
      filenameStem: "livey-customers-import",
      columns: CUSTOMER_IMPORT_TEMPLATE_COLUMNS,
      sampleRows: CUSTOMER_IMPORT_TEMPLATE_SAMPLE,
    });
  };

  const importCustomers = async (file: File) => {
    setImporting(true);
    setImportErrors([]);
    setImportMessage(null);
    try {
      const parsed = parseSpreadsheetFile(await file.arrayBuffer(), file.name);
      const templateErrors = validateImportTemplate(parsed, CUSTOMER_IMPORT_TEMPLATE_COLUMNS);
      if (templateErrors.length > 0) {
        setImportErrors(templateErrors);
        toast.error("Use the template CSV headers and add at least one row before uploading again");
        return;
      }

      const validation = validateCustomerImportRows(parsed.rows);
      if (validation.errors.length > 0) {
        setImportErrors(validation.errors);
        toast.error("Fix the import errors before uploading again");
        return;
      }

      const now = new Date().toISOString();
      const payloads = validation.rows.map((row) => ({
        id: globalThis.crypto.randomUUID(),
        ...row,
        user_id: profile?.id ?? null,
        partner_id: profile?.partner_id ?? null,
        is_seed: false,
        created_at: now,
        updated_at: now,
      }));
      const { error } = await supabase.from("portal_customers").insert(payloads);
      if (error) throw error;

      setImportMessage(buildImportSummaryMessage(payloads.length, "customer", file.name));
      toast.success(`Imported ${payloads.length} customers`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import customers");
    } finally {
      setImporting(false);
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Workspace
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Customers</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Reserve accounts, track health, and keep customer ownership visible across the portal.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
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
          <CsvExportButton
            label="Export CSV"
            filenameStem="livey-customers"
            columns={CUSTOMER_EXPORT_COLUMNS}
            loadRows={async () =>
              filteredCustomers.map((customer) => ({
                company_name: customer.company_name,
                account_owner: customer.account_owner,
                region: customer.region,
                segment: customer.segment,
                health_score: customer.health_score,
                mrr: customer.mrr,
                renewal_date: customer.renewal_date,
                status: customer.status,
                next_step: customer.next_step,
                last_touch: customer.last_touch,
              }))
            }
            variant="outline"
          />
          <Button variant="outline" onClick={downloadImportTemplate}>
            <Download className="mr-2 h-4 w-4" />
            Download template CSV
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importCustomers(file);
            }}
          />
          <Button
            variant="outline"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Import CSV/XLSX
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Accounts" value={String(stats.total)} hint="Current account rows" />
        <Metric label="Active" value={String(stats.active)} hint="Live accounts" />
        <Metric label="Avg. health" value={`${stats.avg}%`} hint="Account health score" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Customer directory</CardTitle>
                <CardDescription>
                  Search, filter, and jump straight into a live account record.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search customers"
                    className="pl-8"
                  />
                </div>
                <LookupCombobox
                  fieldName={LOOKUP_FIELDS.customerStatus}
                  label="Status"
                  value={statusFilter === "all" ? "" : statusFilter}
                  onValueChange={(value) => setStatusFilter(value || "all")}
                  placeholder="All statuses"
                  clearLabel="All statuses"
                  allowClear
                  options={editOptions.statuses}
                  triggerClassName="w-44"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading customers...
              </div>
            ) : filteredCustomers.length === 0 ? (
              <div className="space-y-3 p-8 text-sm text-muted-foreground">
                <div className="font-medium text-foreground">No customers match this view.</div>
                <div>Try a different filter or add a fresh account below.</div>
              </div>
            ) : (
              <div className="divide-y">
                {filteredCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    onClick={() => {
                      setSelectedId(customer.id);
                      setEditOpen(true);
                    }}
                    className={`flex w-full flex-col gap-2 px-5 py-4 text-left transition sm:flex-row sm:items-center sm:justify-between sm:gap-4 hover:bg-muted/40 ${
                      selectedCustomer?.id === customer.id ? "bg-muted/40" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium">{customer.company_name}</div>
                        <Badge variant="outline">{customer.status}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {customer.account_owner} · {customer.segment} · {customer.region}
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <div className="font-medium">{customer.mrr}</div>
                      <div className="text-xs text-muted-foreground">
                        {customer.health_score}% health
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Add customer</CardTitle>
              <CardDescription>Insert a new account into the customer list.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ImportFeedback successMessage={importMessage} errors={importErrors} />
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Company">
                  <Input
                    value={draft.company_name}
                    onChange={(e) =>
                      setDraft((current) => ({ ...current, company_name: e.target.value }))
                    }
                    placeholder="Acme Infra"
                  />
                </Field>
                <Field label="Owner">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.customerOwner}
                    label="Owner"
                    value={draft.account_owner}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, account_owner: value }))
                    }
                    placeholder="Select or create owner"
                    options={editOptions.owners}
                  />
                </Field>
                <Field label="Region">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.customerRegion}
                    label="Region"
                    value={draft.region}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, region: value }))
                    }
                    placeholder="Select or create region"
                    options={editOptions.regions}
                  />
                </Field>
                <Field label="Segment">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.customerSegment}
                    label="Segment"
                    value={draft.segment}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, segment: value }))
                    }
                    placeholder="Select or create segment"
                    options={editOptions.segments}
                  />
                </Field>
                <Field label="Health score">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.health_score}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, health_score: Number(e.target.value) || 0 }))
                    }
                  />
                </Field>
                <Field label="MRR">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.customerMrr}
                    label="MRR"
                    value={draft.mrr}
                    onValueChange={(value) => setDraft((current) => ({ ...current, mrr: value }))}
                    placeholder="Select or create MRR"
                    options={editOptions.mrrs}
                  />
                </Field>
                <Field label="Renewal date">
                  <Input
                    type="date"
                    value={draft.renewal_date}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, renewal_date: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Status">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.customerStatus}
                    label="Status"
                    value={draft.status}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, status: value }))
                    }
                    placeholder="Select or create status"
                    options={editOptions.statuses}
                  />
                </Field>
              </div>
              <Field label="Next step">
                <Textarea
                  value={draft.next_step}
                  onChange={(e) => setDraft((value) => ({ ...value, next_step: e.target.value }))}
                />
              </Field>
              <Field label="Last touch">
                <LookupCombobox
                  fieldName={LOOKUP_FIELDS.customerLastTouch}
                  label="Last touch"
                  value={draft.last_touch}
                  onValueChange={(value) =>
                    setDraft((current) => ({ ...current, last_touch: value }))
                  }
                  placeholder="Select or create last touch"
                  options={LAST_TOUCH_OPTIONS as unknown as string[]}
                />
              </Field>
              <Button onClick={() => void createCustomer()} disabled={adding}>
                {adding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Add customer
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selectedCustomer ? `Edit ${selectedCustomer.company_name}` : "Edit customer"}
            </DialogTitle>
            <DialogDescription>
              Update the selected account without expanding the page height.
            </DialogDescription>
          </DialogHeader>

          {selectedCustomer ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Company">
                  <Input
                    value={draft.company_name}
                    onChange={(e) =>
                      setDraft((current) => ({ ...current, company_name: e.target.value }))
                    }
                    placeholder="Acme Infra"
                  />
                </Field>
                <Field label="Owner">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.customerOwner}
                    label="Owner"
                    value={draft.account_owner}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, account_owner: value }))
                    }
                    placeholder="Select or create owner"
                    options={editOptions.owners}
                  />
                </Field>
                <Field label="Region">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.customerRegion}
                    label="Region"
                    value={draft.region}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, region: value }))
                    }
                    placeholder="Select or create region"
                    options={editOptions.regions}
                  />
                </Field>
                <Field label="Segment">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.customerSegment}
                    label="Segment"
                    value={draft.segment}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, segment: value }))
                    }
                    placeholder="Select or create segment"
                    options={editOptions.segments}
                  />
                </Field>
                <Field label="Health score">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.health_score}
                    onChange={(e) =>
                      setDraft((valueState) => ({
                        ...valueState,
                        health_score: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </Field>
                <Field label="MRR">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.customerMrr}
                    label="MRR"
                    value={draft.mrr}
                    onValueChange={(value) => setDraft((current) => ({ ...current, mrr: value }))}
                    placeholder="Select or create MRR"
                    options={editOptions.mrrs}
                  />
                </Field>
                <Field label="Renewal date">
                  <Input
                    type="date"
                    value={draft.renewal_date}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, renewal_date: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Status">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.customerStatus}
                    label="Status"
                    value={draft.status}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, status: value }))
                    }
                    placeholder="Select or create status"
                    options={editOptions.statuses}
                  />
                </Field>
              </div>
              <Field label="Next step">
                <Textarea
                  value={draft.next_step}
                  onChange={(e) => setDraft((value) => ({ ...value, next_step: e.target.value }))}
                />
              </Field>
              <Field label="Last touch">
                <LookupCombobox
                  fieldName={LOOKUP_FIELDS.customerLastTouch}
                  label="Last touch"
                  value={draft.last_touch}
                  onValueChange={(value) =>
                    setDraft((current) => ({ ...current, last_touch: value }))
                  }
                  placeholder="Select or create last touch"
                  options={LAST_TOUCH_OPTIONS as unknown as string[]}
                />
              </Field>
              <Field label="Activity note">
                <Textarea
                  value={activityDraft}
                  onChange={(e) => setActivityDraft(e.target.value)}
                  placeholder="Met the customer, advanced the opportunity, raised a risk, etc."
                />
              </Field>
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Activity timeline
                </div>
                <div className="mt-3 space-y-3">
                  {selectedActivities.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No activity entries yet. Use Save Activity to append the first timeline item.
                    </div>
                  ) : (
                    selectedActivities.map((activity) => (
                      <div key={activity.id} className="rounded-lg border bg-background p-3">
                        <div className="text-sm font-medium">{activity.summary}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {activity.actor_name} · {formatDateTimeLabel(activity.created_at)}
                        </div>
                        {activity.next_step ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Next step: {activity.next_step}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    selectedCustomer &&
                    setDraft({
                      company_name: selectedCustomer.company_name,
                      account_owner: selectedCustomer.account_owner,
                      region: selectedCustomer.region,
                      segment: selectedCustomer.segment,
                      health_score: selectedCustomer.health_score,
                      mrr: selectedCustomer.mrr,
                      renewal_date: toDateInputValue(selectedCustomer.renewal_date),
                      status: selectedCustomer.status,
                      next_step: selectedCustomer.next_step,
                      last_touch: selectedCustomer.last_touch,
                    })
                  }
                >
                  Reset form
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void saveActivity()}
                  disabled={savingActivity}
                >
                  {savingActivity ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save activity
                </Button>
                <Button type="button" onClick={() => void saveCustomer()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save customer
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
