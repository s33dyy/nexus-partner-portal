import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Search, Users } from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/local/client";
import { DEMO_CUSTOMERS, type CustomerRecord } from "@/lib/portal-demo-data";

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

export const Route = createFileRoute("/_authenticated/customers")({
  component: CustomersPage,
});

function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "fallback" | "empty">("empty");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CustomerForm>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("portal_customers")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const rows = (data as CustomerRecord[] | null) ?? [];
      setCustomers(rows);
      setSource(rows.length > 0 ? "database" : "empty");
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
    } catch {
      setCustomers(DEMO_CUSTOMERS);
      setSource("fallback");
      setSelectedId((current) => current ?? DEMO_CUSTOMERS[0]?.id ?? null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

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
        ...draft,
        id: crypto.randomUUID(),
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
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save customer");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!selectedCustomer) return;
    setDraft({
      company_name: selectedCustomer.company_name,
      account_owner: selectedCustomer.account_owner,
      region: selectedCustomer.region,
      segment: selectedCustomer.segment,
      health_score: selectedCustomer.health_score,
      mrr: selectedCustomer.mrr,
      renewal_date: selectedCustomer.renewal_date,
      status: selectedCustomer.status,
      next_step: selectedCustomer.next_step,
      last_touch: selectedCustomer.last_touch,
    });
  }, [selectedCustomer]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Workspace
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Customers</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Reserve accounts, track health, and keep customer ownership visible across the portal.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {source === "fallback" ? "Fallback demo data" : "Seeded demo data"}
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
        <Metric label="Accounts" value={String(stats.total)} hint="Seeded customers" />
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
                  Search, filter, and jump straight into an account record.
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
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expansion">Expansion</SelectItem>
                    <SelectItem value="watchlist">Watchlist</SelectItem>
                    <SelectItem value="champion">Champion</SelectItem>
                    <SelectItem value="growth">Growth</SelectItem>
                  </SelectContent>
                </Select>
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
                    onClick={() => setSelectedId(customer.id)}
                    className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-muted/40 ${
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
                    <div className="text-right">
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
              <CardTitle className="text-base">Account details</CardTitle>
              <CardDescription>
                {selectedCustomer
                  ? `Editing ${selectedCustomer.company_name}`
                  : "Select a customer to edit."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedCustomer ? (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Company">
                      <Input
                        value={draft.company_name}
                        onChange={(e) =>
                          setDraft((value) => ({ ...value, company_name: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Owner">
                      <Input
                        value={draft.account_owner}
                        onChange={(e) =>
                          setDraft((value) => ({ ...value, account_owner: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Region">
                      <Input
                        value={draft.region}
                        onChange={(e) =>
                          setDraft((value) => ({ ...value, region: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Segment">
                      <Input
                        value={draft.segment}
                        onChange={(e) =>
                          setDraft((value) => ({ ...value, segment: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Health score">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={draft.health_score}
                        onChange={(e) =>
                          setDraft((value) => ({
                            ...value,
                            health_score: Number(e.target.value) || 0,
                          }))
                        }
                      />
                    </Field>
                    <Field label="MRR">
                      <Input
                        value={draft.mrr}
                        onChange={(e) => setDraft((value) => ({ ...value, mrr: e.target.value }))}
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
                      <Select
                        value={draft.status}
                        onValueChange={(value) =>
                          setDraft((current) => ({ ...current, status: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="expansion">Expansion</SelectItem>
                          <SelectItem value="watchlist">Watchlist</SelectItem>
                          <SelectItem value="champion">Champion</SelectItem>
                          <SelectItem value="growth">Growth</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Next step">
                    <Textarea
                      value={draft.next_step}
                      onChange={(e) =>
                        setDraft((value) => ({ ...value, next_step: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Last touch">
                    <Input
                      value={draft.last_touch}
                      onChange={(e) =>
                        setDraft((value) => ({ ...value, last_touch: e.target.value }))
                      }
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void saveCustomer()} disabled={saving}>
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Save changes
                    </Button>
                    <Button variant="outline" onClick={() => setDraft(EMPTY_FORM)}>
                      Reset form
                    </Button>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No customer selected.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Add customer</CardTitle>
              <CardDescription>
                Insert a new seeded-style account into the customer list.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Company">
                  <Input
                    value={draft.company_name}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, company_name: e.target.value }))
                    }
                    placeholder="New account"
                  />
                </Field>
                <Field label="Owner">
                  <Input
                    value={draft.account_owner}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, account_owner: e.target.value }))
                    }
                    placeholder="Partner owner"
                  />
                </Field>
                <Field label="Region">
                  <Input
                    value={draft.region}
                    onChange={(e) => setDraft((value) => ({ ...value, region: e.target.value }))}
                  />
                </Field>
                <Field label="Segment">
                  <Input
                    value={draft.segment}
                    onChange={(e) => setDraft((value) => ({ ...value, segment: e.target.value }))}
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
                  <Input
                    value={draft.mrr}
                    onChange={(e) => setDraft((value) => ({ ...value, mrr: e.target.value }))}
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
                  <Input
                    value={draft.status}
                    onChange={(e) => setDraft((value) => ({ ...value, status: e.target.value }))}
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
                <Input
                  value={draft.last_touch}
                  onChange={(e) => setDraft((value) => ({ ...value, last_touch: e.target.value }))}
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
