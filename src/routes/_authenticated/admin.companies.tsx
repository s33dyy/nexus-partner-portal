import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Building2, Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AccessDeniedPage } from "@/components/route-placeholder";
import { EmptyState, PageHeader } from "@/components/page-header";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";
import { filterPartnerCompanies } from "@/lib/company-filters";

type PartnerCompany = {
  id: string;
  name: string;
  legal_name: string | null;
  country: string | null;
  region: string | null;
  status: string;
  owner_user_id: string | null;
  linked_user_count?: number;
  linked_customer_count?: number;
};

export const Route = createFileRoute("/_authenticated/admin/companies")({
  component: PartnerCompaniesPage,
});

function PartnerCompaniesPage() {
  const { hasRole } = useAuth();
  const [rows, setRows] = useState<PartnerCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [editing, setEditing] = useState<PartnerCompany | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", legal_name: "", country: "", region: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const result = await supabase.from("companies").select("*").order("name");
    if (result.error) toast.error(result.error.message);
    setRows((result.data as PartnerCompany[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () =>
      filterPartnerCompanies(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          legalName: row.legal_name,
          status: row.status,
        })),
        { query, status },
      ),
    [rows, query, status],
  )
    .map((row) => rows.find((candidate) => candidate.id === row.id))
    .filter(Boolean) as PartnerCompany[];

  if (!hasRole("super_admin"))
    return <AccessDeniedPage title="Partner Companies" roleLabel="Super Admin" />;

  const openCreate = () => {
    setEditing(null);
    setDraft({ name: "", legal_name: "", country: "", region: "" });
    setDialogOpen(true);
  };
  const openEdit = (row: PartnerCompany) => {
    setEditing(row);
    setDraft({
      name: row.name,
      legal_name: row.legal_name ?? "",
      country: row.country ?? "",
      region: row.region ?? "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim()) return toast.error("Partner Company name is required");
    setSaving(true);
    const payload = {
      name: draft.name.trim(),
      legal_name: draft.legal_name.trim() || null,
      country: draft.country.trim() || null,
      region: draft.region.trim() || null,
    };
    const result = editing
      ? await supabase.from("companies").update(payload).eq("id", editing.id)
      : await supabase.from("companies").insert(payload);
    setSaving(false);
    if (result.error) return toast.error(result.error.message);
    toast.success(editing ? "Partner Company updated" : "Partner Company added");
    setEditing(null);
    setDialogOpen(false);
    await load();
  };

  const remove = async (row: PartnerCompany) => {
    if (!window.confirm(`Delete Partner Company ${row.name}?`)) return;
    const result = await supabase.from("companies").update({ status: "deleted" }).eq("id", row.id);
    if (result.error) toast.error(result.error.message);
    else {
      toast.success("Partner Company deleted");
      await load();
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        icon={<Building2 className="h-3.5 w-3.5" />}
        title="Partner Companies"
        description="Manage shared Partner Company records for users and customers."
        actions={
          <>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Partner Company
            </Button>
          </>
        }
      />
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Partner Companies"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="deleted">Deleted</SelectItem>
                <SelectItem value="all">All statuses</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Building2 className="h-5 w-5" />}
              title="No Partner Companies"
              description="Add a Partner Company to assign it to users and customers."
            />
          ) : (
            filtered.map((row) => (
              <div key={row.id} className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <div className="font-medium">{row.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {row.legal_name ?? "No legal name"} · {row.region ?? "No region"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{row.status}</Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => openEdit(row)}
                    aria-label={`Edit ${row.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void remove(row)}
                    aria-label={`Delete ${row.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Partner Company" : "Add Partner Company"}</DialogTitle>
            <DialogDescription>
              Partner Company records are shared across users and customers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Partner Company name">
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Legal name">
              <Input
                value={draft.legal_name}
                onChange={(e) => setDraft({ ...draft, legal_name: e.target.value })}
              />
            </Field>
            <Field label="Country">
              <Input
                value={draft.country}
                onChange={(e) => setDraft({ ...draft, country: e.target.value })}
              />
            </Field>
            <Field label="Region">
              <Input
                value={draft.region}
                onChange={(e) => setDraft({ ...draft, region: e.target.value })}
              />
            </Field>
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Partner Company
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
