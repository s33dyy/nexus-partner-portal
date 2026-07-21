import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Search, ShieldCheck, XCircle } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/local/client";
import { formatDateLabel, toDateInputValue } from "@/lib/date-utils";
import { DEAL_STAGE_ORDER, type DealRecord } from "@/lib/portal-records";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/admin/deals")({
  component: AdminDealsPage,
});

function AdminDealsPage() {
  const { hasRole } = useAuth();
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("portal_deals")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const rows = ((data as DealRecord[] | null) ?? []).map((deal) => ({
        ...deal,
        close_date: toDateInputValue(deal.close_date),
      }));
      setDeals(rows);
      setSource(rows.length > 0 ? "database" : "empty");
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
    } catch {
      setDeals([]);
      setSource("empty");
      setSelectedId(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredDeals = useMemo(() => {
    const term = query.trim().toLowerCase();
    return deals.filter((deal) => {
      const matchesStatus =
        statusFilter === "all" || deal.status === statusFilter || deal.stage === statusFilter;
      const matchesQuery =
        !term ||
        [deal.account_name, deal.contact_name, deal.owner_name, deal.product, deal.notes]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesStatus && matchesQuery;
    });
  }, [deals, query, statusFilter]);

  const selectedDeal = useMemo(
    () => deals.find((deal) => deal.id === selectedId) ?? null,
    [deals, selectedId],
  );

  const metrics = useMemo(() => {
    const queue = deals.filter((deal) => !["won", "lost"].includes(deal.stage)).length;
    const reviewed = deals.filter(
      (deal) => ["approved", "won", "lost"].includes(deal.status) || deal.status === "approved",
    ).length;
    return { queue, reviewed };
  }, [deals]);

  if (!hasRole("super_admin")) {
    return <AccessDeniedPage title="Deal approvals" roleLabel="Super Admin" />;
  }

  const moderate = async (status: "approved" | "need_more_info" | "rejected" | "won" | "lost") => {
    if (!selectedDeal) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("portal_deals")
        .update({
          status,
          stage:
            status === "approved"
              ? "approved"
              : status === "won"
                ? "won"
                : status === "lost"
                  ? "lost"
                  : selectedDeal.stage,
          notes: note.trim() || selectedDeal.notes,
          last_touch: `Admin set status to ${status}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedDeal.id);
      if (error) throw error;
      toast.success(`Deal marked ${status.replace("_", " ")}`);
      setNote("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update deal");
    } finally {
      setSaving(false);
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
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Deal approvals</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Review strategic opportunities, request more detail, and clear approved deals.
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

      <div className="grid gap-4 sm:grid-cols-2">
        <Metric label="Queue" value={String(metrics.queue)} hint="Awaiting decision" />
        <Metric label="Reviewed" value={String(metrics.reviewed)} hint="Handled by admin" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.95fr]">
        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Approval queue</CardTitle>
                <CardDescription>
                  Search, filter, and pick the deal you want to review.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search deals"
                    className="pl-8"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="need_more_info">Need more info</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="won">Won</SelectItem>
                    <SelectItem value="lost">Lost</SelectItem>
                    {DEAL_STAGE_ORDER.map((stage) => (
                      <SelectItem key={stage} value={stage}>
                        Stage: {stage}
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
                Loading approval queue...
              </div>
            ) : filteredDeals.length === 0 ? (
              <div className="p-8 text-sm text-muted-foreground">No deals match this view.</div>
            ) : (
              <div className="divide-y">
                {filteredDeals.map((deal) => (
                  <button
                    key={deal.id}
                    onClick={() => {
                      setSelectedId(deal.id);
                      setNote(deal.notes);
                    }}
                    className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-muted/40 ${
                      selectedDeal?.id === deal.id ? "bg-muted/40" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium">{deal.account_name}</div>
                        <Badge variant="outline">{deal.status}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {deal.owner_name} · {deal.region} · {deal.stage}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{deal.amount}</div>
                      <div className="text-xs text-muted-foreground">
                        {deal.probability}% probability
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Decision desk</CardTitle>
            <CardDescription>
              {selectedDeal
                ? `Reviewing ${selectedDeal.account_name}`
                : "Select a deal to review it."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {selectedDeal ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{selectedDeal.stage}</Badge>
                  <Badge variant="outline">{selectedDeal.status}</Badge>
                  <Badge variant="secondary">{selectedDeal.amount}</Badge>
                </div>
                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <Meta label="Contact" value={selectedDeal.contact_name} />
                  <Meta label="Owner" value={selectedDeal.owner_name} />
                  <Meta label="Product" value={selectedDeal.product} />
                  <Meta label="Close date" value={formatDateLabel(selectedDeal.close_date)} />
                </div>
                <Field label="Admin note">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
                </Field>
                <Separator />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void moderate("approved")} disabled={saving}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void moderate("need_more_info")}
                    disabled={saving}
                  >
                    Request changes
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => void moderate("rejected")}
                    disabled={saving}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Reject
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                No deal selected.
              </div>
            )}
          </CardContent>
        </Card>
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
