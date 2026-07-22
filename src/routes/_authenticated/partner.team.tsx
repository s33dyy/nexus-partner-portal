import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Search, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedPage } from "@/components/route-placeholder";
import { LookupCombobox } from "@/components/lookup-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/local/client";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { type TeamMemberRecord } from "@/lib/portal-records";
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

export const Route = createFileRoute("/_authenticated/partner/team")({
  component: PartnerTeamPage,
});

function PartnerTeamPage() {
  const { hasRole, profile } = useAuth();
  const companyName = profile?.company_name ?? "Your company";
  const [members, setMembers] = useState<TeamMemberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<TeamForm>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("portal_team_members")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const rows = ((data as TeamMemberRecord[] | null) ?? []).filter(
        (row) => row.company_name === companyName,
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
    if (!draft.full_name.trim() || !draft.email.trim() || !draft.role_title.trim() || !draft.password?.trim()) {
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
        role: draft.portal_role as any,
        partner_status: "active",
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
        status: draft.status,
        last_active: "Just added",
        phone: draft.phone,
        permissions:
          draft.portal_role === "partner_admin" ? ["deals", "documents", "team"] : ["documents"],
        is_seed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("portal_team_members").insert(payload);
      if (error) throw error;
      toast.success("Teammate invited");
      setDraft(EMPTY_FORM);
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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Company
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Team</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Invite colleagues, manage access, and keep partner responsibilities clear for{" "}
            {companyName}.
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
        </div>
      </div>

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
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search members"
                  className="pl-8"
                />
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
                        <Badge variant="outline">{member.status}</Badge>
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
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Invite teammate</CardTitle>
              <CardDescription>Add a live record for a new partner user.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Name">
                  <Input
                    value={draft.full_name}
                    onChange={(e) => setDraft((value) => ({ ...value, full_name: e.target.value }))}
                  />
                </Field>
                <Field label="Email">
                  <Input
                    value={draft.email}
                    onChange={(e) => setDraft((value) => ({ ...value, email: e.target.value }))}
                  />
                </Field>
                <Field label="Password">
                  <Input
                    type="password"
                    value={draft.password || ""}
                    onChange={(e) => setDraft((value) => ({ ...value, password: e.target.value }))}
                  />
                </Field>
                <Field label="Role title">
                  <Input
                    value={draft.role_title}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, role_title: e.target.value }))
                    }
                    placeholder="Operations Manager"
                  />
                </Field>
                <Field label="Portal role">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.teamRole}
                    label="Portal role"
                    value={draft.portal_role}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, portal_role: value }))
                    }
                    options={["partner_user", "partner_admin"]}
                  />
                </Field>
                <Field label="Responsibility">
                  <Input
                    value={draft.responsibility}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, responsibility: e.target.value }))
                    }
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    value={draft.phone}
                    onChange={(e) => setDraft((value) => ({ ...value, phone: e.target.value }))}
                  />
                </Field>
                <Field label="Status">
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.teamStatus}
                    label="Status"
                    value={draft.status}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, status: value }))
                    }
                    options={["invited", "active", "paused"]}
                  />
                </Field>
              </div>
              <Button onClick={() => void addMember()} disabled={adding}>
                {adding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Invite teammate
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Access notes</CardTitle>
              <CardDescription>What the partner roster is set up to cover.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-6 text-sm text-muted-foreground">
              <div>Partner admins can manage deals, team, and document workflows.</div>
              <div>Partner users can handle onboarding and document tasks.</div>
              <Separator />
              <div>
                The roster is deletable, so you can reset the workspace cleanly when needed.
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
