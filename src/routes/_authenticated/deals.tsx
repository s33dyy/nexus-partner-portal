import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Target,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LookupCombobox } from "@/components/lookup-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/local/client";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { formatDateLabel, toDateInputValue } from "@/lib/date-utils";
import {
  DEAL_STAGE_ORDER,
  nextDealStage,
  nextDealStatus,
  type DealRecord,
  type DealStage,
} from "@/lib/portal-records";

type DealForm = {
  account_name: string;
  contact_name: string;
  owner_name: string;
  region: string;
  product: string;
  stage: DealStage;
  status: string;
  amount: string;
  probability: number;
  close_date: string;
  source: string;
  last_touch: string;
  notes: string;
};

const EMPTY_FORM: DealForm = {
  account_name: "",
  contact_name: "",
  owner_name: "",
  region: "India West",
  product: "LIVEY WC350 QHD Webcam",
  stage: "sourced",
  status: "draft",
  amount: "",
  probability: 25,
  close_date: "",
  source: "Partner referral",
  last_touch: "New",
  notes: "",
};

function uniqueStrings(values: Array<string | null | undefined>) {
  return [
    ...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)),
  ];
}

export const Route = createFileRoute("/_authenticated/deals")({
  component: DealsPage,
});

function DealsPage() {
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<DealStage | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<DealForm>(EMPTY_FORM);
  const [note, setNote] = useState("");

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

  const selectedDeal = useMemo(
    () => deals.find((deal) => deal.id === selectedId) ?? null,
    [deals, selectedId],
  );

  const filteredDeals = useMemo(() => {
    const term = query.trim().toLowerCase();
    return deals.filter((deal) => {
      const matchesStage = stageFilter === "all" || deal.stage === stageFilter;
      const matchesQuery =
        !term ||
        [deal.account_name, deal.contact_name, deal.owner_name, deal.product, deal.region]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesStage && matchesQuery;
    });
  }, [deals, query, stageFilter]);

  const kpis = useMemo(() => {
    const pipeline = deals.reduce((sum, deal) => {
      const value = Number.parseFloat(deal.amount.replace(/[^0-9.]/g, ""));
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    const open = deals.filter((deal) => !["won", "lost"].includes(deal.stage)).length;
    const won = deals.filter((deal) => deal.stage === "won").length;
    const avgProbability = deals.length
      ? Math.round(deals.reduce((sum, deal) => sum + deal.probability, 0) / deals.length)
      : 0;
    return [
      {
        label: "Pipeline",
        value: `$${pipeline.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
        hint: "Current opportunity rows",
      },
      { label: "Open deals", value: String(open), hint: "Across all stages" },
      { label: "Won deals", value: String(won), hint: "Closed this cycle" },
      { label: "Avg. probability", value: `${avgProbability}%`, hint: "Current weighted mix" },
    ];
  }, [deals]);

  const editOptions = useMemo(() => {
    return {
      accounts: uniqueStrings(deals.map((deal) => deal.account_name)),
      contacts: uniqueStrings(deals.map((deal) => deal.contact_name)),
      owners: uniqueStrings(deals.map((deal) => deal.owner_name)),
      regions: uniqueStrings(deals.map((deal) => deal.region)),
      products: uniqueStrings(deals.map((deal) => deal.product)),
      statuses: uniqueStrings(deals.map((deal) => deal.status)),
      sources: uniqueStrings(deals.map((deal) => deal.source)),
      touches: uniqueStrings(deals.map((deal) => deal.last_touch)),
    };
  }, [deals]);

  const createDeal = async () => {
    if (
      !draft.account_name.trim() ||
      !draft.contact_name.trim() ||
      !draft.amount.trim() ||
      !draft.close_date
    ) {
      toast.error("Fill in the account, contact, amount, and close date");
      return;
    }
    setCreating(true);
    try {
      const payload = {
        ...draft,
        id: crypto.randomUUID(),
        is_seed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("portal_deals").insert(payload);
      if (error) throw error;
      toast.success("Deal created");
      setDraft(EMPTY_FORM);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create deal");
    } finally {
      setCreating(false);
    }
  };

  const updateDeal = async (patch: Partial<DealRecord>) => {
    if (!selectedDeal) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("portal_deals").update(patch).eq("id", selectedDeal.id);
      if (error) throw error;
      toast.success("Deal updated");
      setNote("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update deal");
    } finally {
      setSaving(false);
    }
  };

  const advance = async () => {
    if (!selectedDeal) return;
    const stage = nextDealStage(selectedDeal.stage);
    await updateDeal({
      stage,
      status: nextDealStatus(selectedDeal.status, stage),
      last_touch: "Advanced in pipeline",
      notes: note.trim() || selectedDeal.notes,
      updated_at: new Date().toISOString(),
    });
  };

  const closeAs = async (status: "won" | "lost") => {
    if (!selectedDeal) return;
    await updateDeal({
      stage: status,
      status,
      probability: status === "won" ? 100 : Math.min(selectedDeal.probability, 10),
      last_touch: status === "won" ? "Closed won" : "Closed lost",
      notes: note.trim() || selectedDeal.notes,
      updated_at: new Date().toISOString(),
    });
  };

  const selectedIndex = filteredDeals.findIndex((deal) => deal.id === selectedId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Target className="h-3.5 w-3.5" />
            Workspace
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Deals</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Register opportunities, move them through the pipeline, and keep every deal tied to a
            real next step.
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="space-y-1 p-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                {kpi.label}
              </div>
              <div className="text-2xl font-semibold tracking-tight">{kpi.value}</div>
              <div className="text-sm text-muted-foreground">{kpi.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_0.9fr]">
        <Card className="h-fit">
          <CardHeader className="space-y-4 border-b pb-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Pipeline queue</CardTitle>
                <CardDescription>
                  Search live deals or create a fresh one for testing.
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
                <LookupCombobox
                  fieldName={LOOKUP_FIELDS.dealStage}
                  label="Stage"
                  value={stageFilter === "all" ? "" : stageFilter}
                  onValueChange={(value) => setStageFilter((value || "all") as DealStage | "all")}
                  placeholder="All stages"
                  clearLabel="All stages"
                  allowClear
                  options={DEAL_STAGE_ORDER.map((stage) => stage)}
                  triggerClassName="w-44"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading deals...
              </div>
            ) : filteredDeals.length === 0 ? (
              <div className="space-y-3 p-8 text-sm text-muted-foreground">
                <div className="font-medium text-foreground">No deals match this view.</div>
                <div>Try a different filter, or create a new deal using the form below.</div>
              </div>
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
                        <Badge variant="outline">{deal.stage}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {deal.contact_name} · {deal.owner_name} · {deal.region}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{deal.amount}</div>
                      <div className="text-xs text-muted-foreground">
                        {deal.probability}% · closes {formatDateLabel(deal.close_date)}
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
              <CardTitle className="text-base">Create deal</CardTitle>
              <CardDescription>Add a new live opportunity to the portal.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="account_name">Account</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealAccount}
                    label="Account"
                    value={draft.account_name}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, account_name: value }))
                    }
                    placeholder="Select or create account"
                    options={editOptions.accounts}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact_name">Contact</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealContact}
                    label="Contact"
                    value={draft.contact_name}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, contact_name: value }))
                    }
                    placeholder="Select or create contact"
                    options={editOptions.contacts}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="owner_name">Owner</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealOwner}
                    label="Owner"
                    value={draft.owner_name}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, owner_name: value }))
                    }
                    placeholder="Select or create owner"
                    options={editOptions.owners}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="region">Region</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealRegion}
                    label="Region"
                    value={draft.region}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, region: value }))
                    }
                    placeholder="Select or create region"
                    options={editOptions.regions}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="product">Product</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealProduct}
                    label="Product"
                    value={draft.product}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, product: value }))
                    }
                    placeholder="Select or create product"
                    options={editOptions.products}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    value={draft.amount}
                    onChange={(e) => setDraft((value) => ({ ...value, amount: e.target.value }))}
                    placeholder="$9,200"
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="stage">Stage</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealStage}
                    label="Stage"
                    value={draft.stage}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, stage: value as DealStage }))
                    }
                    placeholder="Select or create stage"
                    options={DEAL_STAGE_ORDER.map((stage) => stage)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealStatus}
                    label="Status"
                    value={draft.status}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, status: value }))
                    }
                    placeholder="Select or create status"
                    options={editOptions.statuses}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="probability">Probability</Label>
                  <Input
                    id="probability"
                    type="number"
                    min={0}
                    max={100}
                    value={draft.probability}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, probability: Number(e.target.value) || 0 }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="source">Source</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealSource}
                    label="Source"
                    value={draft.source}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, source: value }))
                    }
                    placeholder="Select or create source"
                    options={editOptions.sources}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="last_touch">Last touch</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealLastTouch}
                    label="Last touch"
                    value={draft.last_touch}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, last_touch: value }))
                    }
                    placeholder="Select or create last touch"
                    options={editOptions.touches}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="close_date">Close date</Label>
                  <Input
                    id="close_date"
                    type="date"
                    value={draft.close_date}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, close_date: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={draft.notes}
                  onChange={(e) => setDraft((value) => ({ ...value, notes: e.target.value }))}
                  placeholder="Why this deal matters..."
                />
              </div>
              <Button onClick={() => void createDeal()} disabled={creating}>
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Create deal
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Selected deal</CardTitle>
              <CardDescription>
                {selectedDeal
                  ? `Focused on ${selectedDeal.account_name}`
                  : "Choose a deal to inspect and advance it."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                    <Meta label="Region" value={selectedDeal.region} />
                    <Meta label="Close date" value={formatDateLabel(selectedDeal.close_date)} />
                    <Meta label="Source" value={selectedDeal.source} />
                    <Meta label="Probability" value={`${selectedDeal.probability}%`} />
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label htmlFor="deal_note">Quick note</Label>
                    <Textarea
                      id="deal_note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Capture the latest status"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void advance()} disabled={saving}>
                      {saving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRight className="mr-2 h-4 w-4" />
                      )}
                      Advance stage
                    </Button>
                    <Button variant="outline" onClick={() => void closeAs("won")} disabled={saving}>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Mark won
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void closeAs("lost")}
                      disabled={saving}
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Mark lost
                    </Button>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                    Viewing item {selectedIndex + 1} of {filteredDeals.length}
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No deal selected yet. Choose a row from the table to inspect the opportunity.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
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
