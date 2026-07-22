import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, MoveRight, Search, Target } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/local/client";
import {
  DEAL_STAGE_ORDER,
  nextDealStage,
  nextDealStatus,
  type DealRecord,
} from "@/lib/portal-records";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/pipeline")({
  component: PipelinePage,
});

function PipelinePage() {
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [query, setQuery] = useState("");
  const { profile, hasRole } = useAuth();

  const load = async () => {
    setLoading(true);
    try {
      let queryBuilder = supabase.from("portal_deals").select("*").order("updated_at", { ascending: false });

      if (!hasRole("super_admin")) {
        if (hasRole("partner_admin") && profile?.partner_id) {
          queryBuilder = queryBuilder.eq("partner_id", profile.partner_id);
        } else if (profile?.id) {
          queryBuilder = queryBuilder.eq("user_id", profile.id);
        }
      }

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
  };

  useEffect(() => {
    void load();
  }, []);

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
    try {
      const { error } = await supabase
        .from("portal_deals")
        .update({
          stage,
          status: nextDealStatus(deal.status, stage),
          last_touch: `Moved to ${stage}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deal.id);
      if (error) throw error;
      toast.success(`${deal.account_name} moved to ${stage}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to move deal");
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
                          <Button
                            className="mt-3 w-full"
                            size="sm"
                            variant="outline"
                            onClick={() => void moveDeal(deal)}
                          >
                            Move forward
                            <MoveRight className="ml-2 h-4 w-4" />
                          </Button>
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
