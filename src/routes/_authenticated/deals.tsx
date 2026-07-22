import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Target,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/local/client";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { formatDateLabel, toDateInputValue } from "@/lib/date-utils";
import { dealRegionLookupField } from "@/lib/deal-lookups";
import { awardDealWinPoints } from "@/lib/rewards";
import { useAuth } from "@/hooks/use-auth";
import { recordAuditEvent } from "@/lib/workflow-events";
import {
  DEAL_STAGE_ORDER,
  nextDealStage,
  nextDealStatus,
  parseDealAmount,
  requiresSuperAdminApproval,
  type DealRecord,
  type DealStage,
} from "@/lib/portal-records";

type DealForm = {
  account_name: string;
  contact_name: string;
  owner_name: string;
  country: string;
  region: string;
  product: string;
  stage: DealStage;
  quantity: number;
  amount: string;
  customer_budget: string;
  possible_close_date: string;
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
  country: "India",
  region: "India West",
  product: "LIVEY WC350 QHD Webcam",
  stage: "sourced",
  quantity: 1,
  amount: "",
  customer_budget: "",
  possible_close_date: "",
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
  const [noteOpen, setNoteOpen] = useState(false);
  const { profile, hasRole } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("portal_deals")
        .select("*")
        .order("updated_at", { ascending: false });

      if (!hasRole("super_admin")) {
        if (hasRole("partner_admin") && profile?.partner_id) {
          query = query.eq("partner_id", profile.partner_id);
        } else if (profile?.id) {
          query = query.eq("user_id", profile.id);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      const rows = ((data as DealRecord[] | null) ?? []).map((deal) => ({
        ...deal,
        possible_close_date: toDateInputValue(deal.possible_close_date),
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
  }, [hasRole, profile?.id, profile?.partner_id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!profile?.company_name) return;
    if (hasRole("super_admin") || hasRole("partner_admin")) return;
    setDraft((current) =>
      current.account_name.trim().length > 0
        ? current
        : { ...current, account_name: profile.company_name ?? current.account_name },
    );
  }, [hasRole, profile?.company_name]);

  useEffect(() => {
    if (!profile?.full_name) return;
    if (hasRole("super_admin")) return;
    setDraft((current) =>
      current.owner_name.trim().length > 0
        ? current
        : { ...current, owner_name: profile.full_name ?? current.owner_name },
    );
  }, [hasRole, profile?.full_name]);

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
        [
          deal.account_name,
          deal.contact_name,
          deal.owner_name,
          deal.product,
          deal.country,
          deal.region,
        ]
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
      countries: uniqueStrings(deals.map((deal) => deal.country)),
      accounts: uniqueStrings(deals.map((deal) => deal.account_name)),
      contacts: uniqueStrings(deals.map((deal) => deal.contact_name)),
      owners: uniqueStrings(deals.map((deal) => deal.owner_name)),
      regions: uniqueStrings(deals.map((deal) => deal.region)),
      products: uniqueStrings(deals.map((deal) => deal.product)),
      sources: uniqueStrings(deals.map((deal) => deal.source)),
      budgets: uniqueStrings(deals.map((deal) => deal.customer_budget ?? "")),
    };
  }, [deals]);
  const regionOptions = useMemo(
    () =>
      uniqueStrings(
        deals.filter((deal) => deal.country === draft.country).map((deal) => deal.region),
      ),
    [deals, draft.country],
  );

  const publishDealActivity = async ({
    notificationTitle,
    notificationMessage,
    feedTitle,
    feedCaption,
    type,
  }: {
    notificationTitle: string;
    notificationMessage: string;
    feedTitle: string;
    feedCaption: string;
    type: string;
  }) => {
    const now = new Date().toISOString();
    const postedByName = profile?.company_name || profile?.full_name || "LIVEY";
    const postedByRole = hasRole("super_admin")
      ? "super_admin"
      : hasRole("partner_admin")
        ? "partner_admin"
        : "partner_user";
    await Promise.allSettled([
      supabase.from("notifications").insert({
        id: globalThis.crypto.randomUUID(),
        user_id: profile?.id ?? null,
        partner_id: profile?.partner_id ?? null,
        title: notificationTitle,
        message: notificationMessage,
        type,
        read: false,
        created_at: now,
      }),
      supabase.from("portal_news_posts").insert({
        id: globalThis.crypto.randomUUID(),
        title: feedTitle,
        caption: feedCaption,
        image_path: "/news/livey-wc350-qhd.png",
        image_alt: "LIVEY deal update banner",
        posted_by_name: postedByName,
        posted_by_role: postedByRole,
        is_seed: false,
        created_at: now,
        updated_at: now,
      }),
    ]);
  };

  const createDeal = async () => {
    const isPartnerUser = !hasRole("super_admin") && !hasRole("partner_admin");
    const accountName = isPartnerUser
      ? profile?.company_name || "Partner Account"
      : draft.account_name;
    const amountValue = parseDealAmount(draft.amount);
    const autoApproved = !requiresSuperAdminApproval(amountValue);

    if (!accountName.trim() || !draft.contact_name.trim() || !draft.amount.trim()) {
      toast.error("Fill in the account, client, and amount");
      return;
    }
    setCreating(true);
    try {
      const now = new Date().toISOString();
      const payload = {
        id: globalThis.crypto.randomUUID(),
        ...draft,
        account_name: accountName,
        owner_name: draft.owner_name.trim() || profile?.full_name || "Unknown",
        country: draft.country || "India",
        quantity: Number(draft.quantity) > 0 ? Number(draft.quantity) : 1,
        customer_budget: draft.customer_budget.trim() || null,
        possible_close_date: draft.possible_close_date || null,
        close_date: draft.possible_close_date || draft.close_date || now.slice(0, 10),
        status: autoApproved ? "approved" : "submitted",
        probability: Number(draft.probability) || 0,
        user_id: profile?.id,
        partner_id: profile?.partner_id,
        is_seed: false,
        created_at: now,
        updated_at: now,
      };
      const { error } = await supabase.from("portal_deals").insert(payload);
      if (error) throw error;

      await publishDealActivity({
        notificationTitle: autoApproved ? "Deal auto-approved" : "Deal submitted for review",
        notificationMessage: autoApproved
          ? `${accountName} was auto-approved because the deal amount is under the threshold.`
          : `${accountName} is waiting for super admin approval.`,
        feedTitle: autoApproved
          ? `${accountName} was auto-approved`
          : `${accountName} submitted for review`,
        feedCaption: autoApproved
          ? `Deal value ${draft.amount} cleared the approval threshold and is now active.`
          : `Deal value ${draft.amount} needs super admin approval before it can move forward.`,
        type: "deal_created",
      });

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

  const saveNote = async () => {
    if (!selectedDeal) return;
    await updateDeal({
      notes: note.trim() || selectedDeal.notes,
      last_touch: "Note updated",
      updated_at: new Date().toISOString(),
    });
    setNoteOpen(false);
  };

  const advance = async () => {
    if (!selectedDeal) return;
    const stage = nextDealStage(selectedDeal.stage);
    if (stage === "qualified" && !selectedDeal.customer_budget?.trim()) {
      toast.error("Add a customer budget before moving this deal to qualified");
      return;
    }
    await updateDeal({
      stage,
      status: nextDealStatus(selectedDeal.status, stage),
      last_touch: "Advanced in pipeline",
      close_date: selectedDeal.close_date || new Date().toISOString().slice(0, 10),
      notes: note.trim() || selectedDeal.notes,
      updated_at: new Date().toISOString(),
    });

    await publishDealActivity({
      notificationTitle: `${selectedDeal.account_name} moved to ${stage}`,
      notificationMessage: `${selectedDeal.account_name} advanced to ${stage}.`,
      feedTitle: `${selectedDeal.account_name} moved to ${stage}`,
      feedCaption: `The deal for ${selectedDeal.product} progressed to ${stage}.`,
      type: "deal_stage_change",
    });
    await recordAuditEvent(supabase, {
      actorName: profile?.full_name ?? "LIVEY",
      actorRole: hasRole("super_admin")
        ? "super_admin"
        : hasRole("partner_admin")
          ? "partner_admin"
          : "partner_user",
      action: "deal_stage_advance",
      targetType: "deal",
      targetName: selectedDeal.account_name,
      outcome: stage,
      details: `${selectedDeal.product} moved to ${stage}`,
      severity: "low",
    });
    if (stage === "won") {
      try {
        await awardDealWinPoints(supabase, {
          dealId: selectedDeal.id,
          accountName: selectedDeal.account_name,
          product: selectedDeal.product,
          userId: selectedDeal.user_id,
          partnerId: selectedDeal.partner_id,
          actorId: profile?.id ?? null,
        });
      } catch (error) {
        console.error("Failed to record reward points for deal win", error);
      }
    }
  };

  const closeAs = async (status: "won" | "lost") => {
    if (!selectedDeal) return;
    await updateDeal({
      stage: status,
      status,
      probability: status === "won" ? 100 : Math.min(selectedDeal.probability, 10),
      last_touch: status === "won" ? "Closed won" : "Closed lost",
      close_date: new Date().toISOString().slice(0, 10),
      notes: note.trim() || selectedDeal.notes,
      updated_at: new Date().toISOString(),
    });

    await publishDealActivity({
      notificationTitle: status === "won" ? "Deal won" : "Deal lost",
      notificationMessage:
        status === "won"
          ? `${selectedDeal.account_name} closed won and is ready for PO submission.`
          : `${selectedDeal.account_name} was closed as lost.`,
      feedTitle:
        status === "won"
          ? `${selectedDeal.account_name} closed won`
          : `${selectedDeal.account_name} closed lost`,
      feedCaption:
        status === "won"
          ? `A deal for ${selectedDeal.product} was successfully closed won.`
          : `The opportunity for ${selectedDeal.product} was marked as lost.`,
      type: `deal_${status}`,
    });
    await recordAuditEvent(supabase, {
      actorName: profile?.full_name ?? "LIVEY",
      actorRole: hasRole("super_admin")
        ? "super_admin"
        : hasRole("partner_admin")
          ? "partner_admin"
          : "partner_user",
      action: `deal_${status}`,
      targetType: "deal",
      targetName: selectedDeal.account_name,
      outcome: status,
      details:
        status === "won"
          ? `${selectedDeal.product} closed won and prepared for PO submission`
          : `${selectedDeal.product} closed lost`,
      severity: status === "won" ? "medium" : "low",
    });
    if (status === "won") {
      try {
        await awardDealWinPoints(supabase, {
          dealId: selectedDeal.id,
          accountName: selectedDeal.account_name,
          product: selectedDeal.product,
          userId: selectedDeal.user_id,
          partnerId: selectedDeal.partner_id,
          actorId: profile?.id ?? null,
        });
      } catch (error) {
        console.error("Failed to record reward points for deal win", error);
      }
    }
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
                {(hasRole("super_admin") || hasRole("partner_admin")) && (
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
                )}
                <div className="space-y-2">
                  <Label htmlFor="contact_name">Client</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealContact}
                    label="Client"
                    value={draft.contact_name}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, contact_name: value }))
                    }
                    placeholder="Select or create client"
                    options={editOptions.contacts}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="owner_name">POC</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealOwner}
                    label="POC"
                    value={draft.owner_name}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, owner_name: value }))
                    }
                    placeholder="Select or create POC"
                    options={editOptions.owners}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="country">Country</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealCountry}
                    label="Country"
                    value={draft.country}
                    onValueChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        country: value,
                        region: current.country === value ? current.region : "",
                      }))
                    }
                    placeholder="Select or create country"
                    options={editOptions.countries}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="region">Region</Label>
                  <LookupCombobox
                    fieldName={dealRegionLookupField(draft.country)}
                    label="Region"
                    value={draft.region}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, region: value }))
                    }
                    placeholder={
                      draft.country === "India"
                        ? "Select an Indian region"
                        : "Select or create region"
                    }
                    options={regionOptions}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min={1}
                    value={draft.quantity}
                    onChange={(e) =>
                      setDraft((current) => ({
                        ...current,
                        quantity: Number(e.target.value) || 1,
                      }))
                    }
                    placeholder="1"
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
                    allowCreate={hasRole("super_admin")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="amount">Amount</Label>
                  <Input
                    id="amount"
                    value={draft.amount}
                    onChange={(e) => setDraft((value) => ({ ...value, amount: e.target.value }))}
                    placeholder={draft.country === "India" ? "₹9,20,000" : "$9,200"}
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
                    allowCreate={false}
                  />
                </div>
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
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="customer_budget">Customer budget</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.dealCustomerBudget}
                    label="Customer budget"
                    value={draft.customer_budget}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, customer_budget: value }))
                    }
                    placeholder="Select or create budget"
                    options={editOptions.budgets}
                    allowCreate={hasRole("super_admin")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="possible_close_date">Possible close date</Label>
                  <Input
                    id="possible_close_date"
                    type="date"
                    value={draft.possible_close_date}
                    onChange={(e) =>
                      setDraft((value) => ({ ...value, possible_close_date: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
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
                    allowCreate={hasRole("super_admin")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="close_date">Close date</Label>
                  <Input
                    id="close_date"
                    value={draft.close_date}
                    disabled
                    placeholder="Auto-set on closure"
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
                    <Badge variant="secondary">{selectedDeal.amount}</Badge>
                    {selectedDeal.customer_budget ? (
                      <Badge variant="outline">{selectedDeal.customer_budget}</Badge>
                    ) : null}
                  </div>
                  <div className="grid gap-3 text-sm md:grid-cols-2">
                    <Meta label="Country" value={selectedDeal.country} />
                    <Meta label="Region" value={selectedDeal.region} />
                    <Meta label="Contact" value={selectedDeal.contact_name} />
                    <Meta label="Owner" value={selectedDeal.owner_name} />
                    <Meta label="Quantity" value={String(selectedDeal.quantity ?? 1)} />
                    <Meta
                      label="Possible close date"
                      value={formatDateLabel(selectedDeal.possible_close_date)}
                    />
                    <Meta label="Close date" value={formatDateLabel(selectedDeal.close_date)} />
                    <Meta label="Source" value={selectedDeal.source} />
                    <Meta label="Probability" value={`${selectedDeal.probability}%`} />
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Quick note</Label>
                    <div className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">
                      {selectedDeal.notes || "Capture the latest status, blockers, or next steps."}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setNote(selectedDeal.notes);
                        setNoteOpen(true);
                      }}
                    >
                      Edit note
                    </Button>
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

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Deal note</DialogTitle>
            <DialogDescription>
              Keep the selected deal up to date without leaving the record view.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2 text-sm">
              <div className="font-medium">{selectedDeal?.account_name ?? "Selected deal"}</div>
              <div className="text-muted-foreground">
                {selectedDeal?.product ?? "Deal"} · {selectedDeal?.stage ?? "stage"}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="deal_note">Note</Label>
              <Textarea
                id="deal_note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Capture the latest status"
                rows={6}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNoteOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void saveNote()}>Save note</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
