import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  UserRoundCog,
} from "lucide-react";
import { toast } from "sonner";

import { CsvExportButton } from "@/components/csv-export-button";
import { AccessDeniedPage } from "@/components/route-placeholder";
import { LookupCombobox } from "@/components/lookup-combobox";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/local/client";
import { assignGovernedRole } from "@/integrations/local/role-assignment-commands";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { type CsvColumn } from "@/lib/csv-export";
import { ImportFeedback } from "@/lib/import-feedback";
import {
  buildImportSummaryMessage,
  downloadTemplateCsv,
  parseSpreadsheetFile,
  validateImportTemplate,
  type ImportValidationError,
} from "@/lib/spreadsheet-import";
import { cn } from "@/lib/utils";
import {
  USER_IMPORT_TEMPLATE_COLUMNS,
  USER_IMPORT_TEMPLATE_SAMPLE,
  validateUserImportRows,
} from "@/lib/user-import";
import type { AppRole } from "@livey/shared/types/auth";
import { useAuth } from "@/hooks/use-auth";
import { PARTNER_STATUSES, type PartnerStatus } from "@/lib/partner-status";
import { ROLE_KEY_LABELS, isLegacyAppRoleKey } from "@/domain/contracts/features";
import { ROLE_KEYS, type RoleKey } from "@/domain/contracts/taxonomy";
import {
  GOVERNANCE_GEOGRAPHY_NODE_IDS,
  countryNodeId,
  salesRegionNodeId,
} from "@/domain/contracts/governance";
import { SALES_REGIONS, WORLD_COUNTRIES } from "@/domain/contracts/world-geography";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Profile = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  company_name: string | null;
  partner_id: string | null;
  partner_status: PartnerStatus;
  is_seed: boolean;
  created_at: string;
};

type RoleRow = {
  user_id: string;
  role: string;
};

type UserRow = Profile & {
  roles: string[];
  geographyCeilingNodeId: string | null;
};

type AssignmentRow = {
  user_id: string;
  geography_ceiling_node_id: string | null;
  status: string;
};

const ROLE_OPTIONS = [...ROLE_KEYS] as const;
const PARTNER_STATUS_OPTIONS = [...PARTNER_STATUSES] as const;

type GeographyMode = "global" | "region" | "country";

/** Region access is per user (this page), not per role (admin.roles.tsx no
 * longer has a Region access panel) — one geography ceiling per role can't
 * express two users on the same role covering different territories. A
 * user's ceiling is a single geography_nodes subtree root, so this reduces
 * to a 3-way choice rather than the multi-select the old role-level panel
 * offered. */
function decodeGeographyCeiling(nodeId: string | null | undefined): {
  mode: GeographyMode;
  regionKey: string;
  countryCode: string;
} {
  if (!nodeId || nodeId === GOVERNANCE_GEOGRAPHY_NODE_IDS.global) {
    return { mode: "global", regionKey: "", countryCode: "" };
  }
  const region = SALES_REGIONS.find((entry) => salesRegionNodeId(entry.key) === nodeId);
  if (region) {
    return { mode: "region", regionKey: region.key, countryCode: "" };
  }
  const country = WORLD_COUNTRIES.find((entry) => countryNodeId(entry.code) === nodeId);
  if (country) {
    return { mode: "country", regionKey: country.regionKey, countryCode: country.code };
  }
  // A node this page doesn't model (e.g. a Province/State) — treat as
  // Global for display rather than crashing; saving will still write
  // whatever the admin picks next.
  return { mode: "global", regionKey: "", countryCode: "" };
}

function encodeGeographyCeiling(
  mode: GeographyMode,
  regionKey: string,
  countryCode: string,
): string {
  if (mode === "country" && countryCode) return countryNodeId(countryCode);
  if (mode === "region" && regionKey) return salesRegionNodeId(regionKey);
  return GOVERNANCE_GEOGRAPHY_NODE_IDS.global;
}

const USER_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "full_name", header: "Full Name" },
  { key: "email", header: "Email" },
  { key: "phone", header: "Phone" },
  { key: "company_name", header: "Company" },
  { key: "partner_id", header: "Partner ID" },
  { key: "partner_status", header: "Partner Status" },
  { key: "roles", header: "Roles" },
  { key: "created_at", header: "Created At" },
];

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const { hasRole } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftRole, setDraftRole] = useState("partner_user");
  const [draftStatus, setDraftStatus] = useState<PartnerStatus>("approved");
  const [draftGeographyMode, setDraftGeographyMode] = useState<GeographyMode>("global");
  const [draftGeographyRegion, setDraftGeographyRegion] = useState("");
  const [draftGeographyCountry, setDraftGeographyCountry] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportValidationError[]>([]);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({
    full_name: "",
    email: "",
    phone: "",
    company_name: "",
    password: "",
    role: "partner_admin" as RoleKey,
  });
  const importInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [profilesRes, rolesRes, assignmentsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "id, email, full_name, phone, company_name, partner_id, partner_status, is_seed, created_at",
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("user_roles")
          .select("user_id, role")
          .order("created_at", { ascending: true }),
        supabase.from("assignments").select("user_id, geography_ceiling_node_id, status"),
      ]);
      if (profilesRes.error || rolesRes.error || assignmentsRes.error) {
        throw profilesRes.error ?? rolesRes.error ?? assignmentsRes.error;
      }
      const profileRows = (profilesRes.data as Profile[] | null) ?? [];
      const roleRows = (rolesRes.data as RoleRow[] | null) ?? [];
      const assignmentRows = (assignmentsRes.data as AssignmentRow[] | null) ?? [];
      const roleMap = new Map<string, string[]>();
      for (const row of roleRows) {
        roleMap.set(row.user_id, [...(roleMap.get(row.user_id) ?? []), row.role]);
      }
      const geographyMap = new Map<string, string | null>();
      for (const row of assignmentRows) {
        if (row.status === "active") geographyMap.set(row.user_id, row.geography_ceiling_node_id);
      }
      const rows = profileRows.map((profile) => ({
        ...profile,
        roles: roleMap.get(profile.id) ?? [],
        geographyCeilingNodeId: geographyMap.get(profile.id) ?? null,
      }));
      setUsers(rows);
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load users");
      setUsers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredUsers = useMemo(() => {
    const term = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesRole = roleFilter === "all" || user.roles.includes(roleFilter);
      const matchesQuery =
        !term ||
        [user.full_name, user.email, user.company_name ?? "", user.roles.join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesRole && matchesQuery;
    });
  }, [query, roleFilter, users]);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedId) ?? null,
    [selectedId, users],
  );

  useEffect(() => {
    if (!selectedUser) return;
    setDraftRole(selectedUser.roles[0] ?? "partner_user");
    setDraftStatus(selectedUser.partner_status);
    const decoded = decodeGeographyCeiling(selectedUser.geographyCeilingNodeId);
    setDraftGeographyMode(decoded.mode);
    setDraftGeographyRegion(decoded.regionKey);
    setDraftGeographyCountry(decoded.countryCode);
  }, [selectedUser]);

  if (!hasRole("super_admin")) {
    return <AccessDeniedPage title="Users & roles" roleLabel="Super Admin" />;
  }

  const saveRoles = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      const roleResult = await assignGovernedRole({
        targetUserId: selectedUser.id,
        roleKey: draftRole,
        geographyCeilingNodeId: encodeGeographyCeiling(
          draftGeographyMode,
          draftGeographyRegion,
          draftGeographyCountry,
        ),
      });
      if (!roleResult.ok) {
        toast.error(roleResult.failure.message);
        return;
      }
      const nextStatus = draftStatus;
      const profileRes = await supabase
        .from("profiles")
        .update({ partner_status: nextStatus, updated_at: new Date().toISOString() })
        .eq("id", selectedUser.id);
      if (profileRes.error) throw profileRes.error;
      toast.success("User roles updated");
      setEditOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update user");
    } finally {
      setSaving(false);
    }
  };

  const approveUser = async () => {
    if (!selectedUser || selectedUser.roles.includes("super_admin")) return;
    if (
      selectedUser.partner_id &&
      !["partial_approval", "pending_agreement", "signed_pending_review", "approved"].includes(
        selectedUser.partner_status,
      )
    ) {
      toast.error("Use Partner Approvals after partial access or agreement preparation begins.");
      return;
    }
    if (selectedUser.partner_status === "approved") return;
    setSaving(true);
    try {
      const profileRes = await supabase
        .from("profiles")
        .update({ partner_status: "approved", updated_at: new Date().toISOString() })
        .eq("id", selectedUser.id);
      if (profileRes.error) throw profileRes.error;

      if (selectedUser.partner_id) {
        const partnerRes = await supabase
          .from("partners")
          .update({ status: "approved" })
          .eq("id", selectedUser.partner_id);
        if (partnerRes.error) throw partnerRes.error;
      }

      // Self-registered partners never get a governed assignment issued at
      // signup — without this, approval would leave them permanently stuck
      // on the "Assignment pending" screen. Issue one from their current
      // role so approval always results in working access. Passes the
      // user's existing geography ceiling through if they already have one
      // (assignGovernedRole ends and reissues the assignment every call) so
      // approving doesn't silently reset a previously-set region override
      // back to the role's default.
      const currentRole = selectedUser.roles[0];
      if (currentRole) {
        const roleResult = await assignGovernedRole({
          targetUserId: selectedUser.id,
          roleKey: currentRole,
          geographyCeilingNodeId: selectedUser.geographyCeilingNodeId,
        });
        if (!roleResult.ok) throw new Error(roleResult.failure.message);
      }

      toast.success("User approved");
      setEditOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to approve user");
    } finally {
      setSaving(false);
    }
  };

  const createUser = async () => {
    if (!newUser.full_name.trim() || !newUser.email.trim() || !newUser.password.trim()) {
      toast.error("Name, email, and password are required");
      return;
    }
    setCreating(true);
    try {
      const legacyRole = isLegacyAppRoleKey(newUser.role);
      const { error, data } = await supabase.auth.createWorkspaceUser({
        full_name: newUser.full_name.trim(),
        email: newUser.email.trim(),
        phone: newUser.phone.trim(),
        company_name: newUser.company_name.trim() || null,
        password: newUser.password,
        role: (legacyRole ? newUser.role : "partner_admin") as AppRole,
        partner_status: legacyRole
          ? newUser.role === "partner_user"
            ? "approved"
            : "pending_partner_registration"
          : "approved",
      });
      if (error || !data) throw error ?? new Error("Failed to create user");

      const roleResult = await assignGovernedRole({
        targetUserId: data.id,
        roleKey: newUser.role,
      });
      if (!roleResult.ok) throw new Error(roleResult.failure.message);

      toast.success("User created");
      setNewUser({
        full_name: "",
        email: "",
        phone: "",
        company_name: "",
        password: "",
        role: "partner_admin",
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const downloadImportTemplate = () => {
    downloadTemplateCsv({
      filenameStem: "livey-users-import",
      columns: USER_IMPORT_TEMPLATE_COLUMNS,
      sampleRows: USER_IMPORT_TEMPLATE_SAMPLE,
    });
  };

  const importUsers = async (file: File) => {
    setImporting(true);
    setImportErrors([]);
    setImportMessage(null);
    try {
      const parsed = parseSpreadsheetFile(await file.arrayBuffer(), file.name);
      const templateErrors = validateImportTemplate(parsed, USER_IMPORT_TEMPLATE_COLUMNS);
      if (templateErrors.length > 0) {
        setImportErrors(templateErrors);
        toast.error("Use the template CSV headers and add at least one row before uploading again");
        return;
      }

      const validation = validateUserImportRows(parsed.rows);
      if (validation.errors.length > 0) {
        setImportErrors(validation.errors);
        toast.error("Fix the import errors before uploading again");
        return;
      }

      const { error, data } = await supabase.auth.createWorkspaceUsersBulk({
        rows: validation.rows,
      });
      if (error || !data) throw new Error(error?.message ?? "Failed to import users");

      setImportMessage(buildImportSummaryMessage(data.createdCount, "user", file.name));
      toast.success(`Imported ${data.createdCount} users`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import users");
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
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Administration
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Users & roles</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Manage internal and partner access, workspace roles, and account ownership.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Live access</Badge>
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
            filenameStem="livey-users"
            columns={USER_EXPORT_COLUMNS}
            loadRows={async () =>
              filteredUsers.map((user) => ({
                full_name: user.full_name,
                email: user.email,
                phone: user.phone,
                company_name: user.company_name,
                partner_id: user.partner_id,
                partner_status: user.partner_status,
                roles: user.roles.join(", "),
                created_at: user.created_at,
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
              if (file) void importUsers(file);
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
        <Metric label="Users" value={String(users.length)} hint="Active profiles" />
        <Metric
          label="Admins"
          value={String(users.filter((user) => user.roles.includes("super_admin")).length)}
          hint="Internal access"
        />
        <Metric
          label="Partner users"
          value={String(
            users.filter((user) => user.roles.some((role) => role.startsWith("partner"))).length,
          )}
          hint="External access"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">User directory</CardTitle>
                <CardDescription>Search and switch between live access records.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <LookupCombobox
                  fieldName={LOOKUP_FIELDS.userRole}
                  label="Role"
                  value={roleFilter === "all" ? "" : roleFilter}
                  onValueChange={(value) => setRoleFilter(value || "all")}
                  placeholder="All roles"
                  clearLabel="All roles"
                  allowClear
                  options={[...ROLE_OPTIONS]}
                  triggerClassName="w-44"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading users...
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-8 text-sm text-muted-foreground">No users match this view.</div>
            ) : (
              <div className="divide-y">
                {filteredUsers.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => {
                      setSelectedId(user.id);
                      setEditOpen(true);
                    }}
                    className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-muted/40 ${
                      selectedUser?.id === user.id ? "bg-muted/40" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium">{user.full_name}</div>
                        <Badge variant="outline">{user.partner_status}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">{user.email}</div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {user.roles.map((role) => (
                          <Badge key={role}>{role}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      <div>{user.company_name ?? "No company"}</div>
                      <div>{user.phone ?? "No phone"}</div>
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
              <CardTitle className="text-base">Create user</CardTitle>
              <CardDescription>
                Create partner admins or active partner users from the super-admin account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <ImportFeedback successMessage={importMessage} errors={importErrors} />
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Full name">
                  <Input
                    value={newUser.full_name}
                    onChange={(e) =>
                      setNewUser((current) => ({ ...current, full_name: e.target.value }))
                    }
                    placeholder="Asha Mehta"
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={newUser.email}
                    onChange={(e) =>
                      setNewUser((current) => ({ ...current, email: e.target.value }))
                    }
                    placeholder="partner@example.com"
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    value={newUser.phone}
                    onChange={(e) =>
                      setNewUser((current) => ({ ...current, phone: e.target.value }))
                    }
                    placeholder="+91 98765 43210"
                  />
                </Field>
                <Field label="Company">
                  <Input
                    value={newUser.company_name}
                    onChange={(e) =>
                      setNewUser((current) => ({ ...current, company_name: e.target.value }))
                    }
                    placeholder="Techilla"
                  />
                </Field>
                <Field label="Password" className="md:col-span-2">
                  <Input
                    type="password"
                    value={newUser.password}
                    onChange={(e) =>
                      setNewUser((current) => ({ ...current, password: e.target.value }))
                    }
                    placeholder="Set an initial password"
                  />
                </Field>
                <Field label="Role" className="md:col-span-2">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.userRole}
                    label="Role"
                    value={newUser.role}
                    onValueChange={(value) =>
                      setNewUser((current) => ({ ...current, role: value as RoleKey }))
                    }
                    options={[...ROLE_OPTIONS]}
                    allowCreate={false}
                  />
                  <p className="text-xs text-muted-foreground">
                    {ROLE_KEY_LABELS[newUser.role] ?? newUser.role}
                  </p>
                </Field>
              </div>
              <Button onClick={() => void createUser()} disabled={creating}>
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create user
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {selectedUser ? `Edit ${selectedUser.full_name}` : "Role editor"}
            </DialogTitle>
            <DialogDescription>
              Update the selected user without keeping the role controls inline on the page.
            </DialogDescription>
          </DialogHeader>

          {selectedUser ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Email
                  </div>
                  <div className="mt-1 text-sm font-medium">{selectedUser.email}</div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Company
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {selectedUser.company_name ?? "Not set"}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Phone
                  </div>
                  <div className="mt-1 text-sm font-medium">{selectedUser.phone ?? "Not set"}</div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Created
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {new Date(selectedUser.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Primary role">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.userRole}
                    label="Role"
                    value={draftRole}
                    onValueChange={setDraftRole}
                    options={[...ROLE_OPTIONS]}
                  />
                  <p className="text-xs text-muted-foreground">
                    {ROLE_KEY_LABELS[draftRole as RoleKey] ?? draftRole}
                  </p>
                </Field>
                <Field label="Partner status">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.partnerStatus}
                    label="Partner status"
                    value={draftStatus}
                    onValueChange={(value) => setDraftStatus(value as PartnerStatus)}
                    options={[...PARTNER_STATUS_OPTIONS]}
                  />
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Region access">
                  <Select
                    value={draftGeographyMode}
                    onValueChange={(value) => {
                      const mode = value as GeographyMode;
                      setDraftGeographyMode(mode);
                      if (mode === "global") {
                        setDraftGeographyRegion("");
                        setDraftGeographyCountry("");
                      } else if (mode === "region") {
                        setDraftGeographyCountry("");
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="global">Global</SelectItem>
                      <SelectItem value="region">Sales region</SelectItem>
                      <SelectItem value="country">Country</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {draftGeographyMode !== "global" ? (
                  <Field label="Sales region">
                    <Select
                      value={draftGeographyRegion}
                      onValueChange={(value) => {
                        setDraftGeographyRegion(value);
                        setDraftGeographyCountry("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a region" />
                      </SelectTrigger>
                      <SelectContent>
                        {SALES_REGIONS.map((region) => (
                          <SelectItem key={region.key} value={region.key}>
                            {region.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
                {draftGeographyMode === "country" && draftGeographyRegion ? (
                  <Field label="Country">
                    <Select value={draftGeographyCountry} onValueChange={setDraftGeographyCountry}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a country" />
                      </SelectTrigger>
                      <SelectContent>
                        {WORLD_COUNTRIES.filter(
                          (country) => country.regionKey === draftGeographyRegion,
                        ).map((country) => (
                          <SelectItem key={country.code} value={country.code}>
                            {country.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void approveUser()}
                  disabled={
                    saving ||
                    (selectedUser.partner_id
                      ? ![
                          "partial_approval",
                          "pending_agreement",
                          "signed_pending_review",
                          "approved",
                        ].includes(selectedUser.partner_status)
                      : false) ||
                    selectedUser.partner_status === "approved" ||
                    selectedUser.roles.includes("super_admin")
                  }
                >
                  Approve user
                </Button>
                <Button onClick={() => void saveRoles()} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <UserRoundCog className="mr-2 h-4 w-4" />
                  )}
                  Save access
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

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
