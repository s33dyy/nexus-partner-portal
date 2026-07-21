import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Loader2, RefreshCw, Sparkles, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/local/client";
import {
  type CatalogItemRecord,
  type CustomerRecord,
  type DealRecord,
} from "@/lib/portal-records";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [catalog, setCatalog] = useState<CatalogItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");

  const load = async () => {
    setLoading(true);
    try {
      const [dealRes, customerRes, catalogRes] = await Promise.all([
        supabase.from("portal_deals").select("*").order("updated_at", { ascending: false }),
        supabase.from("portal_customers").select("*").order("updated_at", { ascending: false }),
        supabase.from("portal_catalog_items").select("*").order("updated_at", { ascending: false }),
      ]);
      if (dealRes.error || customerRes.error || catalogRes.error) {
        throw dealRes.error ?? customerRes.error ?? catalogRes.error;
      }
      const dealRows = (dealRes.data as DealRecord[] | null) ?? [];
      const customerRows = (customerRes.data as CustomerRecord[] | null) ?? [];
      const catalogRows = (catalogRes.data as CatalogItemRecord[] | null) ?? [];
      setDeals(dealRows);
      setCustomers(customerRows);
      setCatalog(catalogRows);
      setSource(
        dealRows.length + customerRows.length + catalogRows.length > 0 ? "database" : "empty",
      );
    } catch {
      setDeals([]);
      setCustomers([]);
      setCatalog([]);
      setSource("empty");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const totals = useMemo(() => {
    const pipeline = deals.reduce((sum, deal) => {
      const value = Number.parseFloat(deal.amount.replace(/[^0-9.]/g, ""));
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    const won = deals.filter((deal) => deal.stage === "won").length;
    const open = deals.filter((deal) => !["won", "lost"].includes(deal.stage)).length;
    const avgHealth = customers.length
      ? Math.round(
          customers.reduce((sum, customer) => sum + customer.health_score, 0) / customers.length,
        )
      : 0;
    return { pipeline, won, open, avgHealth };
  }, [customers, deals]);

  const stageData = useMemo(() => {
    const stages = ["sourced", "qualified", "proposal", "negotiation", "approved", "won", "lost"];
    return stages.map((stage) => ({
      stage,
      count: deals.filter((deal) => deal.stage === stage).length,
    }));
  }, [deals]);

  const healthBands = useMemo(() => {
    const bands = [
      { label: "90-100", min: 90 },
      { label: "75-89", min: 75 },
      { label: "60-74", min: 60 },
      { label: "<60", min: 0 },
    ];
    return bands.map((band) => ({
      label: band.label,
      count: customers.filter((customer) => {
        if (band.label === "<60") return customer.health_score < 60;
        if (band.label === "90-100") return customer.health_score >= 90;
        return customer.health_score >= band.min && customer.health_score < band.min + 15;
      }).length,
    }));
  }, [customers]);

  const catalogByTier = useMemo(() => {
    const tiers = ["Registered", "Silver", "Gold", "Platinum"];
    return tiers.map((tier) => ({
      tier,
      count: catalog.filter((item) => item.partner_tier.toLowerCase() === tier.toLowerCase())
        .length,
    }));
  }, [catalog]);

  const maxStage = Math.max(1, ...stageData.map((item) => item.count));
  const maxHealth = Math.max(1, ...healthBands.map((item) => item.count));
  const maxTier = Math.max(1, ...catalogByTier.map((item) => item.count));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5" />
            Workspace
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Review revenue, health, and catalog trends using the live records that power the rest
            of the portal.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {source === "database" ? "Live Postgres data" : "Empty state"}
          </Badge>
          <button
            className="inline-flex items-center rounded-md border px-3 py-2 text-sm shadow-sm transition hover:bg-muted"
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
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Pipeline value"
          value={`$${totals.pipeline.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          hint="Current deal rows"
        />
        <Metric label="Won deals" value={String(totals.won)} hint="Closed opportunities" />
        <Metric label="Open deals" value={String(totals.open)} hint="Still moving" />
        <Metric label="Avg. health" value={`${totals.avgHealth}%`} hint="Across live customers" />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Deal stage mix</CardTitle>
            <CardDescription>Where opportunities sit in the pipeline right now.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading charts...
              </div>
            ) : deals.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No deal records yet. Add one to populate the chart.
              </div>
            ) : (
              stageData.map((item) => (
                <div key={item.stage} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="capitalize">{item.stage}</span>
                    <span className="font-medium">{item.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(item.count / maxStage) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Customer health bands</CardTitle>
            <CardDescription>How strong the live account base looks by score.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {customers.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No customer records yet. Add one to populate the health bands.
              </div>
            ) : (
              healthBands.map((band) => (
                <div key={band.label} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{band.label}</span>
                    <span className="font-medium">{band.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${(band.count / maxHealth) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Partner catalog mix</CardTitle>
            <CardDescription>Which tiers are backing the live product set.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {catalog.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No catalog items yet. Add one to populate this section.
              </div>
            ) : (
              catalogByTier.map((item) => (
                <div key={item.tier} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{item.tier}</span>
                    <span className="font-medium">{item.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-amber-500"
                      style={{ width: `${(item.count / maxTier) * 100}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Quick takeaways</CardTitle>
            <CardDescription>Live data can still support decision-making.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-6 text-sm">
            {deals.length === 0 && customers.length === 0 && catalog.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No analytics data is available yet.
              </div>
            ) : (
              <>
                <Insight
                  icon={TrendingUp}
                  title="Winning pace"
                  body={`${totals.won} opportunities have already closed won this cycle.`}
                />
                <Insight
                  icon={Sparkles}
                  title="Healthy accounts"
                  body={`${customers.filter((customer) => customer.health_score >= 90).length} customers are in top health.`}
                />
                <Insight
                  icon={BarChart3}
                  title="Catalog focus"
                  body={`${catalog.length} catalog items are available for partner motion.`}
                />
              </>
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

function Insight({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{body}</div>
    </div>
  );
}
