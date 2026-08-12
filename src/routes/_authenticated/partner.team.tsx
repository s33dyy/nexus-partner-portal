import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { CsvExportButton } from "@/components/csv-export-button";
import { PageHeader } from "@/components/page-header";
import { AccessDeniedPage } from "@/components/route-placeholder";
import { LookupCombobox } from "@/components/lookup-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGrid, FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/local/client";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { type CsvColumn } from "@/lib/csv-export";
import { ImportFeedback } from "@/lib/import-feedback";
import { resolveStatusTone } from "@/lib/status-tone";
import { type TeamMemberRecord } from "@/lib/portal-records";
import {
  buildImportSummaryMessage,
  downloadTemplateCsv,
  parseSpreadsheetFile,
  validateImportTemplate,
  type ImportValidationError,
} from "@/lib/spreadsheet-import";
import {
  resolveTeamCompanyName,
  TEAM_IMPORT_TEMPLATE_COLUMNS,
  TEAM_IMPORT_TEMPLATE_SAMPLE,
  validateTeamImportRows,
} from "@/lib/team-import";
import { useAuth } from "@/hooks/use-auth";

type TeamForm = {
  full_name: string;
  email: string;
  role_title: string;
  portal_role: string;
  responsibility: string;
  phone: string;
  status: string;
  password?: string;
};

const EMPTY_FORM: TeamForm = {
  full_name: "",
  email: "",
  role_title: "",
  portal_role: "partner_user",
  responsibility: "",
  phone: "",
  status: "invited",
  password: "",
};

const TEAM_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "company_name", header: "Company" },
  { key: "full_name", header: "Full Name" },
  { key: "email", header: "Email" },
  { key: "role_title", header: "Role Title" },
  { key: "portal_role", header: "Portal Role" },
  { key: "responsibility", header: "Responsibility" },
  { key: "status", header: "Status" },
  { key: "last_active", header: "Last Active" },
  { key: "phone", header: "Phone" },
  { key: "permissions", header: "Permissions" },
  { key: "created_at", header: "Created At" },
  { key: "updated_at", header: "Updated At" },
];

export const Route = createFileRoute("/_authenticated/partner/team")({
  component: PartnerTeamPage,
});

function PartnerTeamPage() {
  const { hasRole, profile } = useAuth();
  const companyName = resolveTeamCompanyName(profile?.company_name);
  const companyLabel = companyName ?? "Your company";
  const [members, setMembers] = useState<TeamMemberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<TeamForm>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportValidationError[]>([]);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!companyName) {
      setMembers([]);
      setSource("empty");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("portal_team_members")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const rows = ((data as TeamMemberRecord[] | null) ?? []).filter(
        (row) => normalizeCompanyName(row.company_name) === normalizeCompanyName(companyName),
      );
      setMembers(rows);
      setSource(rows.length > 0 ? "database" : "empty");
    } catch {
      setMembers([]);
      setSource("empty");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [companyName]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredMembers = useMemo(() => {
    const term = query.trim().toLowerCase();
    return members.filter((member) =>
      !term
        ? true
        : [
            member.full_name,
            member.email,
            member.role_title,
            member.portal_role,
            member.responsibility,
          ]
            .join(" ")
            .toLowerCase()
            .includes(term),
    );
  }, [members, query]);

  const addMember = async () => {
    if (!companyName) {
      toast.error("Set your company name before inviting teammates");
      return;
    }
    if (
      !draft.full_name.trim() ||
      !draft.email.trim() ||
      !draft.role_title.trim() ||
      !draft.password?.trim()
    ) {
      toast.error("Name, email, password, and role title are required");
      return;
    }
    setAdding(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.createWorkspaceUser({
        full_name: draft.full_name.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim(),
        company_name: companyName,
        password: draft.password.trim(),
        role: draft.portal_role as "partner_user" | "partner_admin",
        partner_status: "approved",
      });

      if (userError) throw userError;

      const payload = {
        id: userData?.id || crypto.randomUUID(),
        company_name: companyName,
        full_name: draft.full_name,
        email: draft.email,
        role_title: draft.role_title,
        portal_role: draft.portal_role,
        responsibility: draft.responsibility,
        status: draft.portal_role === "partner_user" ? "active" : draft.status,
        last_active: "Just added",
        phone: draft.phone,
        permissions:
          draft.portal_role === "partner_admin"
            ? ["deals", "documents", "deal-documents", "team"]
            : [
                "dashboard",
                "deals",
                "pipeline",
                "customers",
                "analytics",
                "deal-documents",
                "rewards",
              ],
        is_seed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("portal_team_members").insert(payload);
      if (error) throw error;
      toast.success("Teammate invited");
      setDraft(EMPTY_FORM);
      setInviteOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add teammate");
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (member: TeamMemberRecord) => {
    setRemovingId(member.id);
    try {
      const { error } = await supabase.from("portal_team_members").delete().eq("id", member.id);
      if (error) throw error;
      toast.success("Teammate removed");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove teammate");
    } finally {
      setRemovingId(null);
    }
  };

  const toggleStatus = async (member: TeamMemberRecord) => {
    const next = member.status === "active" ? "paused" : "active";
    const { error } = await supabase
      .from("portal_team_members")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", member.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${member.full_name} marked ${next}`);
    await load();
  };

  const downloadImportTemplate = () => {
    downloadTemplateCsv({
      filenameStem: "livey-team-members-import",
      columns: TEAM_IMPORT_TEMPLATE_COLUMNS,
      sampleRows: TEAM_IMPORT_TEMPLATE_SAMPLE,
    });
  };

  const importTeamMembers = async (file: File) => {
    if (!companyName) {
      toast.error("Set your company name before importing teammates");
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
      return;
    }

    setImporting(true);
    setImportErrors([]);
    setImportMessage(null);
    try {
      const parsed = parseSpreadsheetFile(await file.arrayBuffer(), file.name);
      const templateErrors = validateImportTemplate(parsed, TEAM_IMPORT_TEMPLATE_COLUMNS);
      if (templateErrors.length > 0) {
        setImportErrors(templateErrors);
        toast.error("Use the template CSV headers and add at least one row before uploading again");
        return;
      }

      const validation = validateTeamImportRows(parsed.rows);
      if (validation.errors.length > 0) {
        setImportErrors(validation.errors);
        toast.error("Fix the import errors before uploading again");
        return;
      }

      const { data, error } = await supabase.auth.createPartnerTeamMembersBulk({
        company_name: companyName,
        rows: validation.rows,
      });
      if (error || !data) throw new Error(error?.message ?? "Failed to import teammates");

      setImportMessage(buildImportSummaryMessage(data.createdCount, "teammate", file.name));
      toast.success(`Imported ${data.createdCount} teammates`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import teammates");
    } finally {
      setImporting(false);
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  };

  if (!hasRole("partner_admin") && !hasRole("super_admin")) {
    return (
      <AccessDeniedPage
        title="Team"
        roleLabel="Partner Admin"
        description="Team management is available to partner operators only."
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Company"
        icon={<ShieldCheck className="h-3.5 w-3.5" />}
        title="Team"
        description={`Invite colleagues, manage access, and keep partner responsibilities clear for ${companyLabel}.`}
        actions={
          <>
            <Button onClick={() => setInviteOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Invite teammate
            </Button>
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
              filenameStem="livey-team-members"
              columns={TEAM_EXPORT_COLUMNS}
              loadRows={async () =>
                filteredMembers.map((member) => ({
                  company_name: member.company_name,
                  full_name: member.full_name,
                  email: member.email,
                  role_title: member.role_title,
                  portal_role: member.portal_role,
                  responsibility: member.responsibility,
                  status: member.status,
                  last_active: member.last_active,
                  phone: member.phone,
                  permissions: member.permissions,
                  created_at: member.created_at,
                  updated_at: member.updated_at,
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
                if (file) void importTeamMembers(file);
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
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Members" value={String(members.length)} hint="Current roster" />
        <Metric
          label="Active"
          value={String(members.filter((member) => member.status === "active").length)}
          hint="Signed-in users"
        />
        <Metric
          label="Invited"
          value={String(members.filter((member) => member.status === "invited").length)}
          hint="Waiting on access"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Team roster</CardTitle>
                <CardDescription>
                  Search the current roster or remove old test accounts.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading team...
              </div>
            ) : filteredMembers.length === 0 ? (
              <div className="p-8 text-sm text-muted-foreground">No teammates match this view.</div>
            ) : (
              <div className="divide-y">
                {filteredMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between gap-4 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium">{member.full_name}</div>
                        <Badge tone={resolveStatusTone(member.status)}>{member.status}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {member.role_title} · {member.email}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {member.responsibility} · {member.last_active}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => void toggleStatus(member)}>
                        Toggle status
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void removeMember(member)}
                        disabled={removingId === member.id}
                      >
                        {removingId === member.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <ImportFeedback successMessage={importMessage} errors={importErrors} />

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Access notes</CardTitle>
              <CardDescription>What the partner roster is set up to cover.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-6 text-sm text-muted-foreground">
              <div>Partner admins can manage onboarding, deals, team, and document workflows.</div>
              <div>Partner users can handle deals, customers, analytics, and deal documents.</div>
              <Separator />
              <div>
                The roster is deletable, so you can reset the workspace cleanly when needed.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <FormDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        title="Invite teammate"
        description="Add a live record for a new partner user or partner admin."
        busy={adding}
        submitLabel="Invite teammate"
        busyLabel="Inviting…"
        submitDisabled={
          !draft.full_name.trim() ||
          !draft.email.trim() ||
          !draft.role_title.trim() ||
          !draft.password?.trim()
        }
        onSubmit={addMember}
        size="lg"
      >
        <FieldGrid>
          <Field label="Name" htmlFor="team-name" required>
            <Input
              id="team-name"
              value={draft.full_name}
              onChange={(e) => setDraft((value) => ({ ...value, full_name: e.target.value }))}
              autoFocus
            />
          </Field>
          <Field label="Email" htmlFor="team-email" required>
            <Input
              id="team-email"
              type="email"
              value={draft.email}
              onChange={(e) => setDraft((value) => ({ ...value, email: e.target.value }))}
            />
          </Field>
          <Field label="Password" htmlFor="team-password" required>
            <Input
              id="team-password"
              type="password"
              autoComplete="new-password"
              value={draft.password || ""}
              onChange={(e) => setDraft((value) => ({ ...value, password: e.target.value }))}
            />
          </Field>
          <Field label="Role title" htmlFor="team-role-title" required>
            <Input
              id="team-role-title"
              value={draft.role_title}
              onChange={(e) => setDraft((value) => ({ ...value, role_title: e.target.value }))}
              placeholder="Operations Manager"
            />
          </Field>
          <Field label="Portal role">
            <LookupCombobox
              fieldName={LOOKUP_FIELDS.teamRole}
              label="Portal role"
              value={draft.portal_role}
              onValueChange={(value) => setDraft((current) => ({ ...current, portal_role: value }))}
              options={["partner_user", "partner_admin"]}
            />
          </Field>
          <Field label="Responsibility" htmlFor="team-responsibility">
            <Input
              id="team-responsibility"
              value={draft.responsibility}
              onChange={(e) => setDraft((value) => ({ ...value, responsibility: e.target.value }))}
            />
          </Field>
          <Field label="Phone" htmlFor="team-phone">
            <Input
              id="team-phone"
              type="tel"
              value={draft.phone}
              onChange={(e) => setDraft((value) => ({ ...value, phone: e.target.value }))}
            />
          </Field>
          <Field label="Status">
            <LookupCombobox
              fieldName={LOOKUP_FIELDS.teamStatus}
              label="Status"
              value={draft.status}
              onValueChange={(value) => setDraft((current) => ({ ...current, status: value }))}
              options={["invited", "active", "paused"]}
            />
          </Field>
        </FieldGrid>
      </FormDialog>
    </div>
  );
}

function normalizeCompanyName(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
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
