import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, MoveRight, Search, Target } from "lucide-react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/local/client";
import {
  DEAL_STAGE_ORDER,
  nextDealStage,
  nextDealStatus,
  type DealRecord,
} from "@/lib/portal-records";
import { awardDealWinPoints } from "@/lib/rewards";
import { useAuth } from "@/hooks/use-auth";
import { recordAuditEvent } from "@/lib/workflow-events";
import { applyPartnerScope } from "@/lib/partner-scope";

export const Route = createFileRoute("/_authenticated/pipeline")({
  component: PipelinePage,
});

function PipelinePage() {
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [query, setQuery] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteDeal, setNoteDeal] = useState<DealRecord | null>(null);
  const { profile, hasRole } = useAuth();

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
      });

      const { data, error } = await queryBuilder;
      if (error) throw error;
      const rows = (data as DealRecord[] | null) ?? [];
      setDeals(rows);
      setSource(rows.length > 0 ? "database" : "empty");
    } catch {
      setDeals([]);
      setSource("empty");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hasRole, profile?.id, profile?.partner_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const publishDealActivity = async (
    type: string,
    notificationTitle: string,
    notificationMessage: string,
    feedTitle: string,
    feedCaption: string,
  ) => {
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
        image_path: "",
        image_alt: "",
        posted_by_name: postedByName,
        posted_by_role: postedByRole,
        is_seed: false,
        created_at: now,
        updated_at: now,
      }),
    ]);
  };

  const visibleDeals = useMemo(() => {
    const term = query.trim().toLowerCase();
    return deals.filter((deal) =>
      !term
        ? true
        : [deal.account_name, deal.contact_name, deal.owner_name, deal.region, deal.product]
            .join(" ")
            .toLowerCase()
            .includes(term),
    );
  }, [deals, query]);

  const grouped = useMemo(
    () =>
      DEAL_STAGE_ORDER.map((stage) => ({
        stage,
        deals: visibleDeals.filter((deal) => deal.stage === stage),
      })),
    [visibleDeals],
  );

  const totals = useMemo(() => {
    const pipeline = deals.reduce((sum, deal) => {
      const numeric = Number.parseFloat(deal.amount.replace(/[^0-9.]/g, ""));
      return sum + (Number.isFinite(numeric) ? numeric : 0);
    }, 0);
    const weighted = deals.length
      ? Math.round(deals.reduce((sum, deal) => sum + deal.probability, 0) / deals.length)
      : 0;
    return { pipeline, weighted, count: deals.length };
  }, [deals]);

  const moveDeal = async (deal: DealRecord) => {
    const stage = nextDealStage(deal.stage);
    if (stage === "qualified" && !deal.customer_budget?.trim()) {
      toast.error("Add a customer budget before moving this deal to qualified");
      return;
    }
    try {
      const { error } = await supabase
        .from("portal_deals")
        .update({
          stage,
          status: nextDealStatus(deal.status, stage),
          last_touch: `Moved to ${stage}`,
          close_date:
            stage === "won" || stage === "lost"
              ? new Date().toISOString().slice(0, 10)
              : deal.close_date,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deal.id);
      if (error) throw error;
      toast.success(`${deal.account_name} moved to ${stage}`);
      await publishDealActivity(
        "deal_stage_change",
        `${deal.account_name} moved to ${stage}`,
        `${deal.account_name} advanced to ${stage}.`,
        `${deal.account_name} moved to ${stage}`,
        `The deal for ${deal.product} progressed to ${stage}.`,
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
      if (stage === "won") {
        try {
          await awardDealWinPoints(supabase, {
            dealId: deal.id,
            accountName: deal.account_name,
            product: deal.product,
            userId: deal.user_id,
            partnerId: deal.partner_id,
            actorId: null,
          });
        } catch (rewardError) {
          console.error("Failed to record reward points for deal win", rewardError);
        }
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move deal");
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
      await publishDealActivity(
        "deal_note",
        `Note updated for ${noteDeal.account_name}`,
        noteDraft.trim() || `A note was updated for ${noteDeal.account_name}.`,
        `${noteDeal.account_name} note updated`,
        noteDraft.trim() || `A new note was added for ${noteDeal.product}.`,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Target className="h-3.5 w-3.5" />
            Workspace
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Pipeline</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Visualize every deal by stage and push opportunities forward with a single action.
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

      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="Pipeline value"
          value={`$${totals.pipeline.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          hint="Current deal rows"
        />
        <MetricCard label="Deal count" value={String(totals.count)} hint="Visible opportunities" />
        <MetricCard
          label="Avg. probability"
          value={`${totals.weighted}%`}
          hint="Across the current set"
        />
      </div>

      <Card>
        <CardHeader className="space-y-4 border-b">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base">Stage board</CardTitle>
              <CardDescription>
                Move records across the pipeline using the live Postgres records.
              </CardDescription>
            </div>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search account or owner"
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading pipeline...
            </div>
          ) : (
            <div className="grid min-w-[920px] gap-4 xl:grid-cols-7">
              {grouped.map((column) => (
                <div key={column.stage} className="space-y-3 rounded-xl border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium capitalize">{column.stage}</div>
                    <Badge variant="outline">{column.deals.length}</Badge>
                  </div>
                  <div className="space-y-3">
                    {column.deals.length === 0 ? (
                      <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                        No deals in this stage.
                      </div>
                    ) : (
                      column.deals.map((deal) => (
                        <div
                          key={deal.id}
                          className="rounded-lg border bg-background p-3 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">
                                {deal.account_name}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {deal.owner_name}
                              </div>
                            </div>
                            <Badge>{deal.amount}</Badge>
                          </div>
                          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                            <div>{deal.region}</div>
                            <div>{deal.product}</div>
                            <div>{deal.probability}% probability</div>
                          </div>
                          <div className="mt-3 grid gap-2">
                            <Button
                              className="w-full"
                              size="sm"
                              variant="outline"
                              onClick={() => void moveDeal(deal)}
                            >
                              Move forward
                              <MoveRight className="ml-2 h-4 w-4" />
                            </Button>
                            <Button
                              className="w-full"
                              size="sm"
                              variant="ghost"
                              onClick={() => openNote(deal)}
                            >
                              Notes
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Deal notes</DialogTitle>
            <DialogDescription>
              Capture a stage update or next step without leaving the pipeline board.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-2 text-sm">
              <div className="font-medium">{noteDeal?.account_name ?? "Selected deal"}</div>
              <div className="text-muted-foreground">
                {noteDeal?.product ?? "Deal"} · {noteDeal?.stage ?? "stage"}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pipeline-note">Note</Label>
              <Textarea
                id="pipeline-note"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Add context, blockers, or next steps..."
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

function MetricCard({ label, value, hint }: { label: string; value: string; hint: string }) {
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
