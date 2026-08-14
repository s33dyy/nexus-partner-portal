import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DollarSign,
  Loader2,
  MoveLeft,
  MoveRight,
  Percent,
  RefreshCw,
  Search,
  Target,
} from "lucide-react";
import { toast } from "sonner";

import { CsvExportButton } from "@/components/csv-export-button";
import { LookupCombobox } from "@/components/lookup-combobox";
import { EmptyState, PageHeader, StatTile, Toolbar } from "@/components/page-header";
import { BoardCard, BoardColumn } from "@/components/record-list";
import { DealOutcomeDialog, type DealOutcomeSubmission } from "@/components/deal-outcome-dialog";
import { DEAL_STAGE_TONE, type StatusTone } from "@/lib/status-tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/local/client";
import {
  markDealLost,
  markDealWon,
  moveDealStageBackward,
  moveDealStageForward,
} from "@/integrations/local/deal-commands";
import { loadDashboardPipeline } from "@/integrations/local/dashboard-metrics";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import {
  DEAL_STAGE_ORDER,
  getValidBackwardStages,
  isTerminalDealStage,
  nextDealStage,
  type DealRecord,
  type DealStage,
} from "@/lib/portal-records";
import { useAuth } from "@/hooks/use-auth";
import { useRequireAccess } from "@/hooks/use-partner-access";
import { recordAuditEvent } from "@/lib/workflow-events";
import { applyPartnerScope, hasDealsScopeBypass } from "@/lib/partner-scope";
import { filterVisibleDeals, groupCollaboratorIdsByDeal } from "@/lib/deal-visibility";
import { type CsvColumn } from "@/lib/csv-export";
import { formatDealProbability } from "@/lib/deal-probability";
import { matchesSelectedRegion, useRegionFilter } from "@/lib/region-filter";

export const Route = createFileRoute("/_authenticated/pipeline")({
  component: PipelinePage,
});

/** Terminal stages, in the order they stack inside the shared closed column. */
const CLOSED_STAGES: readonly DealStage[] = ["won", "lost"];

/** Every stage that still gets a lane of its own on the board. */
const OPEN_STAGE_ORDER = DEAL_STAGE_ORDER.filter((stage) => !CLOSED_STAGES.includes(stage));

type PipelineColumn = {
  key: string;
  label: string;
  tone: StatusTone;
  emptyLabel: string;
  deals: DealRecord[];
};

const PIPELINE_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "account_name", header: "Account" },
  { key: "contact_name", header: "Client" },
  { key: "owner_name", header: "Owner" },
  { key: "country", header: "Country" },
  { key: "region", header: "Region" },
  { key: "product", header: "Product" },
  { key: "stage", header: "Stage" },
  { key: "status", header: "Status" },
  { key: "quantity", header: "Quantity" },
  { key: "amount", header: "Amount" },
  { key: "currency_code", header: "Currency" },
  { key: "amount_usd", header: "USD Equivalent" },
  { key: "customer_budget", header: "Customer Budget" },
  { key: "probability", header: "Probability" },
  { key: "possible_close_date", header: "Possible Close Date" },
  { key: "close_date", header: "Close Date" },
  { key: "source", header: "Source" },
  { key: "last_touch", header: "Last Touch" },
];

function PipelinePage() {
  const { profile, hasRole, roleKey } = useAuth();
  const access = useRequireAccess("full");
  const { selectedRegion } = useRegionFilter();

  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<DealRecord["stage"] | "all">("all");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteDeal, setNoteDeal] = useState<DealRecord | null>(null);
  // 9e: backward movement had zero UI callers anywhere in the shipped
  // product — this board-card dialog mirrors deals.tsx's own "Move
  // backward" dialog (same fields, same required-reason behaviour the
  // server already enforces).
  const [backwardOpen, setBackwardOpen] = useState(false);
  const [backwardDeal, setBackwardDeal] = useState<DealRecord | null>(null);
  const [backwardTargetStage, setBackwardTargetStage] = useState<DealStage | "">("");
  const [backwardReason, setBackwardReason] = useState("");
  // Leaving Negotiation asks Won or Lost rather than assuming Won — see
  // DealOutcomeDialog for why that assumption was wrong under §9.15.
  const [outcomeDeal, setOutcomeDeal] = useState<DealRecord | null>(null);
  const [outcomeBusy, setOutcomeBusy] = useState(false);
  const [pipelineMetric, setPipelineMetric] = useState<{
    pipelineValueUsd: number;
    openDealCount: number;
    missingDtpCount: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let queryBuilder = supabase
        .from("portal_deals")
        .select("*")
        .order("updated_at", { ascending: false });

      queryBuilder = applyPartnerScope(queryBuilder, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
        bypassOwnershipFilter: hasDealsScopeBypass(roleKey),
      });

      const [dealRes, collaboratorRes, pipelineMetricRes] = await Promise.all([
        queryBuilder,
        supabase
          .from("portal_deal_collaborators")
          .select("*")
          .order("sort_order", { ascending: true }),
        // Reuses the exact same server-side canonical metric the dashboard
        // shows — open stages (Sourced..Negotiation) only, priced from
        // effective DTP, never the free-text amount — instead of
        // maintaining a third, divergent client-side sum here.
        loadDashboardPipeline(selectedRegion),
      ]);
      if (dealRes.error || collaboratorRes.error) throw dealRes.error ?? collaboratorRes.error;
      const collaboratorRows =
        (collaboratorRes.data as Array<{
          deal_id: string;
          user_id: string;
          split_percent: number;
          sort_order: number;
        }> | null) ?? [];
      const collaboratorIdsByDeal = groupCollaboratorIdsByDeal(collaboratorRows);
      const rows = filterVisibleDeals(
        ((dealRes.data as DealRecord[] | null) ?? []).map((deal) => ({
          ...deal,
          is_hidden_to_team: Boolean(deal.is_hidden_to_team),
        })),
        collaboratorIdsByDeal,
        {
          viewerUserId: profile?.id ?? null,
          viewerRole: hasRole("super_admin")
            ? "super_admin"
            : hasRole("partner_admin")
              ? "partner_admin"
              : "partner_user",
          isSuperAdmin: hasRole("super_admin"),
          isPartnerAdmin: hasRole("partner_admin"),
        },
      );
      setDeals(rows);
      setSource(rows.length > 0 ? "database" : "empty");
      setPipelineMetric(pipelineMetricRes.ok ? pipelineMetricRes.metrics : null);
    } catch {
      setDeals([]);
      setSource("empty");
      setPipelineMetric(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hasRole, profile?.id, profile?.partner_id, roleKey, selectedRegion]);

  useEffect(() => {
    void load();
  }, [load]);

  // §2.11/§11.5: target the deal's actual owner (portal_deals.user_id), not
  // the acting user — a notification about a deal must reach the person
  // responsible for it, even when someone else (their manager, an admin)
  // is the one who triggered the event. Falls back to the actor only when
  // the deal has no resolvable owner. Full participant fan-out to every
  // tagged deal_participants row is a further step, not attempted here —
  // see current gaps.md §2.11.
  const publishDealNotification = async (
    deal: Pick<DealRecord, "user_id">,
    type: string,
    notificationTitle: string,
    notificationMessage: string,
  ) => {
    const { error } = await supabase.from("notifications").insert({
      id: globalThis.crypto.randomUUID(),
      user_id: deal.user_id ?? profile?.id ?? null,
      partner_id: profile?.partner_id ?? null,
      title: notificationTitle,
      message: notificationMessage,
      type,
      read: false,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.error("Deal notification could not be recorded", error);
    }
  };

  const regionScopedDeals = useMemo(
    () => deals.filter((deal) => matchesSelectedRegion(deal.country, selectedRegion)),
    [deals, selectedRegion],
  );

  const visibleDeals = useMemo(() => {
    const term = query.trim().toLowerCase();
    return regionScopedDeals.filter((deal) => {
      const matchesStage = stageFilter === "all" || deal.stage === stageFilter;
      const matchesQuery =
        !term ||
        [deal.account_name, deal.contact_name, deal.owner_name, deal.region, deal.product]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesStage && matchesQuery;
    });
  }, [regionScopedDeals, query, stageFilter]);

  // Won and Lost share one terminal column.
  //
  // Neither can be moved on from, so as separate columns they were two mostly
  // empty lanes stranded at the end of the board, costing the horizontal room
  // the open stages actually need. Together they read as the outcome split for
  // the period. Nothing is lost by merging: each card keeps its own stage
  // tone, so won stays green and lost stays red, and the two are sorted so
  // every won sits above every lost.
  const grouped = useMemo<PipelineColumn[]>(() => {
    const columns: PipelineColumn[] = OPEN_STAGE_ORDER.map((stage) => ({
      key: stage,
      label: stage.replace(/_/g, " "),
      tone: DEAL_STAGE_TONE[stage],
      emptyLabel: "No deals in this stage.",
      deals: visibleDeals.filter((deal) => deal.stage === stage),
    }));

    const closed = visibleDeals
      .filter((deal) => CLOSED_STAGES.includes(deal.stage))
      .sort((a, b) => CLOSED_STAGES.indexOf(a.stage) - CLOSED_STAGES.indexOf(b.stage));

    columns.push({
      key: "closed",
      label: "Won / Lost",
      tone: "success",
      emptyLabel: "Nothing closed yet.",
      deals: closed,
    });

    return columns;
  }, [visibleDeals]);

  const totals = useMemo(() => {
    const weighted = regionScopedDeals.length
      ? Math.round(
          regionScopedDeals.reduce((sum, deal) => sum + deal.probability, 0) /
            regionScopedDeals.length,
        )
      : 0;
    return { weighted, count: regionScopedDeals.length };
  }, [regionScopedDeals]);

  const moveDeal = async (deal: DealRecord) => {
    const stage = nextDealStage(deal.stage);
    if (stage === "qualified" && !deal.customer_budget?.trim()) {
      toast.error("Add a customer budget before moving this deal to qualified");
      return;
    }
    // Negotiation is the last open stage, so "forward" from here is a closing
    // decision, not a step. Ask which outcome it reached — this used to call
    // markDealWon outright, which both assumed the answer and skipped the
    // outcome date and PO choice §9.15 requires.
    if (deal.stage === "negotiation") {
      setOutcomeDeal(deal);
      return;
    }
    try {
      const result = await moveDealStageForward({
        dealId: deal.id,
        expectedVersion: deal.version,
      });
      if (!result.ok) {
        toast.error(result.failure.message);
        return;
      }
      toast.success(`${deal.account_name} moved to ${stage}`);
      await publishDealNotification(
        deal,
        "deal_stage_change",
        `${deal.account_name} moved to ${stage}`,
        `${deal.account_name} advanced to ${stage}.`,
      );
      await recordAuditEvent(supabase, {
        actorName: "LIVEY",
        actorRole: hasRole("super_admin")
          ? "super_admin"
          : hasRole("partner_admin")
            ? "partner_admin"
            : "partner_user",
        action: "pipeline_stage_move",
        targetType: "deal",
        targetName: deal.account_name,
        outcome: stage,
        details: `${deal.product} moved to ${stage} in the pipeline`,
        severity: "low",
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move deal");
    }
  };

  /**
   * Commits the Won/Lost choice made in DealOutcomeDialog.
   *
   * Won and Lost are separate named commands rather than a stage move: Won is
   * reward-eligible and Lost demands a reason, and each carries its own audit
   * trail. Reward points are NOT awarded here — that happens only when the PO
   * outcome review reaches approved (outcome-review-commands.server.ts), per
   * product.md §15.11's "Points are not created when Deal is merely marked Won".
   */
  const confirmOutcome = async (submission: DealOutcomeSubmission) => {
    const deal = outcomeDeal;
    if (!deal) return;
    setOutcomeBusy(true);
    try {
      const result =
        submission.outcome === "won"
          ? await markDealWon({
              dealId: deal.id,
              expectedVersion: deal.version,
              outcomeDate: submission.outcomeDate || null,
              poChoice: submission.poChoice,
            })
          : await markDealLost({
              dealId: deal.id,
              expectedVersion: deal.version,
              reason: submission.reason,
              category: submission.category,
            });

      if (!result.ok) {
        toast.error(result.failure.message);
        return;
      }

      setOutcomeDeal(null);
      toast.success(
        submission.outcome === "won"
          ? `${deal.account_name} closed won`
          : `${deal.account_name} closed lost`,
      );

      await publishDealNotification(
        deal,
        `deal_${submission.outcome}`,
        submission.outcome === "won" ? "Deal won" : "Deal lost",
        submission.outcome === "won"
          ? `${deal.account_name} closed won (PO ${submission.poChoice === "now" ? "uploading now" : "to follow"}).`
          : `${deal.account_name} was closed as lost: ${submission.reason}`,
      );
      await recordAuditEvent(supabase, {
        actorName: profile?.full_name ?? "LIVEY",
        actorRole: hasRole("super_admin")
          ? "super_admin"
          : hasRole("partner_admin")
            ? "partner_admin"
            : "partner_user",
        action: `deal_${submission.outcome}`,
        targetType: "deal",
        targetName: deal.account_name,
        outcome: submission.outcome,
        details:
          submission.outcome === "won"
            ? `${deal.product} closed won from the pipeline (PO ${submission.poChoice})`
            : `${deal.product} closed lost from the pipeline: ${submission.reason}`,
        severity: submission.outcome === "won" ? "medium" : "low",
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to close deal");
    } finally {
      setOutcomeBusy(false);
    }
  };

  const openNote = (deal: DealRecord) => {
    setNoteDeal(deal);
    setNoteDraft(deal.notes);
    setNoteOpen(true);
  };

  const saveNote = async () => {
    if (!noteDeal) return;
    try {
      const { error } = await supabase
        .from("portal_deals")
        .update({
          notes: noteDraft.trim() || noteDeal.notes,
          last_touch: "Note updated",
          updated_at: new Date().toISOString(),
        })
        .eq("id", noteDeal.id);
      if (error) throw error;
      await publishDealNotification(
        noteDeal,
        "deal_note",
        `Note updated for ${noteDeal.account_name}`,
        noteDraft.trim() || `A note was updated for ${noteDeal.account_name}.`,
      );
      await recordAuditEvent(supabase, {
        actorName: "LIVEY",
        actorRole: hasRole("super_admin")
          ? "super_admin"
          : hasRole("partner_admin")
            ? "partner_admin"
            : "partner_user",
        action: "pipeline_note_update",
        targetType: "deal",
        targetName: noteDeal.account_name,
        outcome: "updated",
        details: `Updated notes for ${noteDeal.product}`,
        severity: "low",
      });
      toast.success("Note saved");
      setNoteOpen(false);
      setNoteDeal(null);
      setNoteDraft("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save note");
    }
  };

  // Reopening a closed deal and stepping an open one back are the same command
  // with the same required reason, so they share a dialog — only the wording
  // changes, because "move backward" badly undersells undoing a win.
  const reopeningBackwardDeal = backwardDeal ? isTerminalDealStage(backwardDeal.stage) : false;

  const openBackward = (deal: DealRecord) => {
    setBackwardDeal(deal);
    const options = getValidBackwardStages(deal.stage);
    setBackwardTargetStage(options[options.length - 1] ?? "");
    setBackwardReason("");
    setBackwardOpen(true);
  };

  const confirmBackward = async () => {
    if (!backwardDeal || !backwardTargetStage) return;
    if (!backwardReason.trim()) {
      toast.error("A reason is required to move this deal backward");
      return;
    }
    try {
      const result = await moveDealStageBackward({
        dealId: backwardDeal.id,
        expectedVersion: backwardDeal.version,
        toStage: backwardTargetStage,
        reason: backwardReason.trim(),
      });
      if (!result.ok) {
        toast.error(result.failure.message);
        return;
      }
      toast.success(`${backwardDeal.account_name} moved back to ${backwardTargetStage}`);
      await publishDealNotification(
        backwardDeal,
        "deal_stage_change",
        `${backwardDeal.account_name} moved back to ${backwardTargetStage}`,
        `${backwardDeal.account_name} moved back to ${backwardTargetStage}: ${backwardReason.trim()}`,
      );
      await recordAuditEvent(supabase, {
        actorName: "LIVEY",
        actorRole: hasRole("super_admin")
          ? "super_admin"
          : hasRole("partner_admin")
            ? "partner_admin"
            : "partner_user",
        action: "pipeline_stage_backward",
        targetType: "deal",
        targetName: backwardDeal.account_name,
        outcome: backwardTargetStage,
        details: `${backwardDeal.product} moved back to ${backwardTargetStage}: ${backwardReason.trim()}`,
        severity: "low",
      });
      setBackwardOpen(false);
      setBackwardDeal(null);
      setBackwardReason("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move deal backward");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workspace"
        icon={<Target className="h-3.5 w-3.5" />}
        title="Pipeline"
        description="Visualize every deal by stage and push opportunities forward with a single action."
        actions={
          <>
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
              label="Export visible queue"
              filenameStem="livey-pipeline"
              columns={PIPELINE_EXPORT_COLUMNS}
              loadRows={async () =>
                visibleDeals.map((deal) => ({
                  account_name: deal.account_name,
                  contact_name: deal.contact_name,
                  owner_name: deal.owner_name,
                  country: deal.country,
                  region: deal.region,
                  product: deal.product,
                  stage: deal.stage,
                  status: deal.status,
                  quantity: deal.quantity,
                  amount: deal.amount,
                  currency_code: deal.currency_code,
                  amount_usd: deal.amount_usd,
                  customer_budget: deal.customer_budget,
                  probability: deal.probability,
                  possible_close_date: deal.possible_close_date,
                  close_date: deal.close_date,
                  source: deal.source,
                  last_touch: deal.last_touch,
                }))
              }
              variant="outline"
            />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label="Pipeline value"
          value={
            pipelineMetric
              ? new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 2,
                }).format(pipelineMetric.pipelineValueUsd)
              : "Unavailable"
          }
          hint={
            pipelineMetric
              ? pipelineMetric.missingDtpCount > 0
                ? `Open (Sourced–Negotiation) at current DTP · ${pipelineMetric.missingDtpCount} missing DTP`
                : "Open (Sourced–Negotiation) at current DTP"
              : "Unable to load scoped pipeline"
          }
          icon={<DollarSign className="h-4 w-4" />}
          tone={pipelineMetric ? "brand" : "warning"}
        />
        <StatTile
          label="Deal count"
          value={String(totals.count)}
          hint="Visible opportunities"
          icon={<Target className="h-4 w-4" />}
        />
        <StatTile
          label="Avg. probability"
          value={`${totals.weighted}%`}
          hint="Across the visible queue"
          icon={<Percent className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader className="space-y-3 border-b">
          <div>
            <CardTitle>Stage board</CardTitle>
            <CardDescription>
              Move records across the pipeline using the live Postgres records.
            </CardDescription>
          </div>
          <Toolbar>
            <LookupCombobox
              fieldName={LOOKUP_FIELDS.dealStage}
              label="Stage"
              value={stageFilter === "all" ? "" : stageFilter}
              onValueChange={(value) => setStageFilter((value as DealRecord["stage"]) || "all")}
              placeholder="All stages"
              clearLabel="All stages"
              allowClear
              options={DEAL_STAGE_ORDER.map((stage) => stage)}
              triggerClassName="w-full sm:w-44"
            />
          </Toolbar>
        </CardHeader>
        <CardContent className="overflow-x-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading pipeline...
            </div>
          ) : visibleDeals.length === 0 ? (
            <EmptyState
              icon={<Target className="h-5 w-5" />}
              title="No deals on the board"
              description="No opportunities match the current stage filter and region scope."
            />
          ) : (
            <div className="flex gap-3 pb-1">
              {grouped.map((column) => (
                <BoardColumn
                  key={column.key}
                  label={column.label}
                  count={column.deals.length}
                  tone={column.tone}
                >
                  {column.deals.length === 0 ? (
                    <p className="rounded-md border border-dashed px-2.5 py-4 text-center text-xs text-muted-foreground">
                      {column.emptyLabel}
                    </p>
                  ) : (
                    column.deals.map((deal) => (
                      <BoardCard
                        key={deal.id}
                        tone={DEAL_STAGE_TONE[deal.stage]}
                        owner={deal.owner_name}
                        title={deal.account_name}
                        amount={deal.amount}
                        details={
                          <div className="space-y-1.5">
                            {/* The collapsed pill truncates, so the full name
                                is repeated here rather than only on hover. */}
                            <div className="text-xs font-medium leading-snug">
                              {deal.account_name}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {deal.owner_name}
                            </div>
                            <div className="flex flex-wrap items-center gap-1">
                              {/* Named explicitly because the closed column
                                  holds both won and lost. */}
                              <Badge tone={DEAL_STAGE_TONE[deal.stage]} className="capitalize">
                                {deal.stage}
                              </Badge>
                              <Badge tone="neutral">{deal.region}</Badge>
                              <Badge tone="neutral">{deal.product}</Badge>
                              <Badge tone="neutral">
                                {formatDealProbability(deal.probability)}
                              </Badge>
                            </div>
                          </div>
                        }
                        actions={
                          <>
                            {/* Won and Lost share a column now, so a "Move
                                forward" on a won card would sit one row above
                                the lost cards while being unable to do
                                anything — the server refuses forward moves out
                                of a terminal stage. */}
                            {isTerminalDealStage(deal.stage) ? null : (
                              <Button
                                className="h-7 gap-1 px-2 text-[11px] [&_svg]:size-3.5"
                                size="sm"
                                variant="outline"
                                onClick={() => void moveDeal(deal)}
                              >
                                {/* From Negotiation this opens the Won/Lost
                                    chooser, so calling it "Move forward" would
                                    misdescribe what the click does. */}
                                {deal.stage === "negotiation" ? "Close deal" : "Move forward"}
                                <MoveRight />
                              </Button>
                            )}
                            {getValidBackwardStages(deal.stage).length > 0 ? (
                              <Button
                                className="h-7 gap-1 px-2 text-[11px] [&_svg]:size-3.5"
                                size="sm"
                                variant="outline"
                                onClick={() => openBackward(deal)}
                              >
                                <MoveLeft />
                                {isTerminalDealStage(deal.stage) ? "Reopen" : "Move backward"}
                              </Button>
                            ) : null}
                            <Button
                              className="h-7 px-2 text-[11px]"
                              size="sm"
                              variant="ghost"
                              onClick={() => openNote(deal)}
                            >
                              Notes
                            </Button>
                          </>
                        }
                      />
                    ))
                  )}
                </BoardColumn>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <FormDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        title="Deal notes"
        description="Capture a stage update or next step without leaving the pipeline board."
        size="lg"
        submitLabel="Save note"
        onSubmit={() => void saveNote()}
      >
        <div className="space-y-0.5">
          <div className="text-sm font-medium">{noteDeal?.account_name ?? "Selected deal"}</div>
          <div className="text-[13px] text-muted-foreground">
            {noteDeal?.product ?? "Deal"} · {noteDeal?.stage ?? "stage"}
          </div>
        </div>
        <Field label="Note" htmlFor="pipeline-note">
          <Textarea
            id="pipeline-note"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Add context, blockers, or next steps..."
            rows={6}
          />
        </Field>
      </FormDialog>

      <FormDialog
        open={backwardOpen}
        onOpenChange={setBackwardOpen}
        title={reopeningBackwardDeal ? "Reopen this deal" : "Move deal backward"}
        description={
          reopeningBackwardDeal
            ? "A closed deal returns to Negotiation. A win whose reward points have already been released can't be reopened here — that needs a Super Admin correction (product.md §9.15)."
            : "Destination stage and a reason are both required (product.md §9.10/§9.19)."
        }
        size="lg"
        submitLabel={reopeningBackwardDeal ? "Reopen deal" : "Confirm move backward"}
        submitDisabled={!backwardTargetStage || !backwardReason.trim()}
        onSubmit={() => void confirmBackward()}
      >
        <div className="space-y-0.5">
          <div className="text-sm font-medium">{backwardDeal?.account_name ?? "Selected deal"}</div>
          <div className="text-[13px] text-muted-foreground">
            Currently at <span className="capitalize">{backwardDeal?.stage ?? "stage"}</span>
          </div>
        </div>
        <Field label="Destination stage" htmlFor="pipeline-backward-stage">
          <LookupCombobox
            fieldName={LOOKUP_FIELDS.dealStage}
            label="Destination stage"
            value={backwardTargetStage}
            onValueChange={(value) => setBackwardTargetStage(value as DealStage)}
            placeholder="Select a stage"
            options={backwardDeal ? getValidBackwardStages(backwardDeal.stage) : []}
            allowCreate={false}
            triggerClassName="w-full"
          />
        </Field>
        <Field label="Reason (required)" htmlFor="pipeline-backward-reason">
          <Textarea
            id="pipeline-backward-reason"
            value={backwardReason}
            onChange={(e) => setBackwardReason(e.target.value)}
            placeholder="e.g. Customer needs another demo before testing can start..."
            rows={4}
          />
        </Field>
      </FormDialog>

      <DealOutcomeDialog
        open={outcomeDeal !== null}
        onOpenChange={(open) => {
          if (!open) setOutcomeDeal(null);
        }}
        dealName={outcomeDeal?.account_name ?? "Selected deal"}
        dealSubtitle={outcomeDeal ? `${outcomeDeal.product} · ${outcomeDeal.amount}` : undefined}
        busy={outcomeBusy}
        onConfirm={confirmOutcome}
      />
    </div>
  );
}
