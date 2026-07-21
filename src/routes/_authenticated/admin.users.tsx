import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, ShieldCheck, UserRoundCog } from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedPage } from "@/components/route-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/local/client";
import { DEMO_CREDENTIALS } from "@/lib/portal-demo-data";
import { useAuth } from "@/hooks/use-auth";

type Profile = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  company_name: string | null;
  partner_status: string;
  is_seed: boolean;
  created_at: string;
};

type RoleRow = {
  user_id: string;
  role: string;
};

type UserRow = Profile & {
  roles: string[];
};

const ROLE_OPTIONS = ["super_admin", "partner_admin", "partner_user"] as const;

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
  const [saving, setSaving] = useState(false);
  const [draftRole, setDraftRole] = useState<(typeof ROLE_OPTIONS)[number]>("partner_user");
  const [draftStatus, setDraftStatus] = useState("approved");

  const load = async () => {
    setLoading(true);
    try {
      const [profilesRes, rolesRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, email, full_name, phone, company_name, partner_status, is_seed, created_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("user_roles")
          .select("user_id, role")
          .order("created_at", { ascending: true }),
      ]);
      if (profilesRes.error || rolesRes.error) {
        throw profilesRes.error ?? rolesRes.error;
      }
      const profileRows = (profilesRes.data as Profile[] | null) ?? [];
      const roleRows = (rolesRes.data as RoleRow[] | null) ?? [];
      const roleMap = new Map<string, string[]>();
      for (const row of roleRows) {
        roleMap.set(row.user_id, [...(roleMap.get(row.user_id) ?? []), row.role]);
      }
      const rows = profileRows.map((profile) => ({
        ...profile,
        roles: roleMap.get(profile.id) ?? [],
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
    setDraftRole((selectedUser.roles[0] as (typeof ROLE_OPTIONS)[number]) ?? "partner_user");
    setDraftStatus(selectedUser.partner_status);
  }, [selectedUser]);

  if (!hasRole("super_admin")) {
    return <AccessDeniedPage title="Users & roles" roleLabel="Super Admin" />;
  }

  const saveRoles = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      const deleteRes = await supabase.from("user_roles").delete().eq("user_id", selectedUser.id);
      if (deleteRes.error) throw deleteRes.error;
      const insertRes = await supabase.from("user_roles").insert({
        user_id: selectedUser.id,
        role: draftRole,
        is_seed: selectedUser.is_seed,
      });
      if (insertRes.error) throw insertRes.error;
      const profileRes = await supabase
        .from("profiles")
        .update({ partner_status: draftStatus, updated_at: new Date().toISOString() })
        .eq("id", selectedUser.id);
      if (profileRes.error) throw profileRes.error;
      toast.success("User roles updated");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update user");
    } finally {
      setSaving(false);
    }
  };

  const seedHints = DEMO_CREDENTIALS.map((user) => `${user.email} / ${user.password}`);

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
          <Badge variant="secondary">Seeded demo users</Badge>
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
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Users" value={String(users.length)} hint="Seeded profiles" />
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
                <CardDescription>
                  Search and switch between the seeded access records.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search users"
                    className="pl-8"
                  />
                </div>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="All roles" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    {ROLE_OPTIONS.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                    onClick={() => setSelectedId(user.id)}
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
              <CardTitle className="text-base">Role editor</CardTitle>
              <CardDescription>
                {selectedUser
                  ? `Editing ${selectedUser.full_name}`
                  : "Select a user to manage roles."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedUser ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Meta label="Email" value={selectedUser.email} />
                    <Meta label="Company" value={selectedUser.company_name ?? "Not set"} />
                    <Meta label="Phone" value={selectedUser.phone ?? "Not set"} />
                    <Meta
                      label="Created"
                      value={new Date(selectedUser.created_at).toLocaleDateString()}
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Primary role">
                      <Select
                        value={draftRole}
                        onValueChange={(value) =>
                          setDraftRole(value as (typeof ROLE_OPTIONS)[number])
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map((role) => (
                            <SelectItem key={role} value={role}>
                              {role}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Partner status">
                      <Input value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)} />
                    </Field>
                  </div>
                  <Button onClick={() => void saveRoles()} disabled={saving}>
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <UserRoundCog className="mr-2 h-4 w-4" />
                    )}
                    Save access
                  </Button>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No user selected.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Demo credentials</CardTitle>
              <CardDescription>
                These credentials match the seeded Postgres accounts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-6 text-sm">
              {seedHints.map((hint) => (
                <div key={hint} className="rounded-lg border bg-muted/20 p-3 font-mono text-xs">
                  {hint}
                </div>
              ))}
              <Separator />
              <div className="text-muted-foreground">
                Use these accounts to test admin and partner flows locally.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
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
