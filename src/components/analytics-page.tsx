import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Download, Loader2, Printer, RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/page-header";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { ChartFrame, DonutLegend, KpiTile } from "@/components/analytics-primitives";
import { formatCount, formatDays, formatPercent, formatUsd } from "@/lib/analytics-format";
import { supabase } from "@/integrations/local/client";
import { buildExportFilename } from "@/lib/export-files";
import { applyPartnerScope } from "@/lib/partner-scope";
import { filterVisibleDeals, groupCollaboratorIdsByDeal } from "@/lib/deal-visibility";
import {
  comparePeriods,
  computeKpis,
  lossReasonMix,
  newVsExistingBusiness,
  ownerMix,
  percentChange,
  productMix,
  projectedDealsByMonth,
  regionMix,
  sourceMix,
  stageMix,
  winRateByMonth,
  wonDealsByMonth,
} from "@/lib/analytics-metrics";
import { type CatalogItemRecord, type CustomerRecord, type DealRecord } from "@/lib/portal-records";
import { useAuth } from "@/hooks/use-auth";
import { useRequireAccess } from "@/hooks/use-partner-access";
import { matchesSelectedRegion, useRegionFilter } from "@/lib/region-filter";
import { SALES_REGIONS } from "@/domain/contracts/world-geography";

export function AnalyticsPage() {
  const { profile, hasRole } = useAuth();
  useRequireAccess("full");
  const { selectedRegion } = useRegionFilter();

  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [catalog, setCatalog] = useState<CatalogItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let dealQuery = supabase
        .from("portal_deals")
        .select("*")
        .order("updated_at", { ascending: false });
      let customerQuery = supabase
        .from("portal_customers")
        .select("*")
        .order("updated_at", { ascending: false });

      dealQuery = applyPartnerScope(dealQuery, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
      });
      customerQuery = applyPartnerScope(customerQuery, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
      });

      const [dealRes, customerRes, catalogRes] = await Promise.all([
        dealQuery,
        customerQuery,
        supabase.from("portal_catalog_items").select("*").order("updated_at", { ascending: false }),
      ]);
      const collaboratorRes = await supabase
        .from("portal_deal_collaborators")
        .select("deal_id, user_id");

      if (dealRes.error || customerRes.error || catalogRes.error || collaboratorRes.error) {
        throw dealRes.error ?? customerRes.error ?? catalogRes.error ?? collaboratorRes.error;
      }
      const collaboratorIdsByDeal = groupCollaboratorIdsByDeal(
        (collaboratorRes.data as Array<{ deal_id: string; user_id: string }> | null) ?? [],
      );
      const dealRows = filterVisibleDeals(
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
      const customerRows = (customerRes.data as CustomerRecord[] | null) ?? [];
      const catalogRows = (catalogRes.data as CatalogItemRecord[] | null) ?? [];
      const regionFilteredDealRows = dealRows.filter((deal) =>
        matchesSelectedRegion(deal.country, selectedRegion),
      );
      const regionFilteredCustomerRows = customerRows.filter((customer) =>
        matchesSelectedRegion(customer.country, selectedRegion),
      );
      setDeals(regionFilteredDealRows);
      setCustomers(regionFilteredCustomerRows);
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
  }, [hasRole, profile?.id, profile?.partner_id, selectedRegion]);

  useEffect(() => {
    void load();
  }, [load]);

  // One clock for the whole page, so the 12-month window, the projection
  // window and "age of open deals" can never disagree by a render.
  const now = useMemo(() => new Date(), []);

  const kpis = useMemo(() => computeKpis(deals, now), [deals, now]);
  const wonSeries = useMemo(() => wonDealsByMonth(deals, now), [deals, now]);
  const projectionSeries = useMemo(() => projectedDealsByMonth(deals, now), [deals, now]);
  const winRateSeries = useMemo(() => winRateByMonth(deals, now), [deals, now]);
  const stages = useMemo(() => stageMix(deals), [deals]);
  const losses = useMemo(() => lossReasonMix(deals), [deals]);
  const regions = useMemo(() => regionMix(deals), [deals]);
  const owners = useMemo(() => ownerMix(deals), [deals]);
  const products = useMemo(() => productMix(deals), [deals]);
  const sources = useMemo(() => sourceMix(deals), [deals]);
  const comparison = useMemo(() => comparePeriods(deals, now, 30), [deals, now]);
  const businessSplit = useMemo(() => newVsExistingBusiness(deals), [deals]);
  const deltaLabel = `vs prior ${comparison.windowDays} days`;

  // Repeat business is only a meaningful split once some customer has bought
  // twice. Below that the gauge is pinned at 100% and is decoration.
  const businessSplitTotal = businessSplit.newBusiness + businessSplit.existing;
  const businessSplitData = useMemo(
    () => [
      { key: "new", label: "New business", value: businessSplit.newBusiness },
      { key: "existing", label: "Existing business", value: businessSplit.existing },
    ],
    [businessSplit],
  );

  // Sample counts drive ChartFrame's empty/thin states. They count SOURCE
  // ROWS, not chart points: a 12-month series always has 12 points even when
  // every one of them is zero, and drawing that would assert a year of
  // measured inactivity rather than admitting there is nothing to show.
  const wonSample = kpis.wonDeals;
  const projectionSample = kpis.openDeals;
  const decidedSample = kpis.wonDeals + kpis.lostDeals;

  // xlsx is ~412KB minified and is only needed when this button is pressed.
  // Statically imported it landed in the route chunk, so every visit to
  // Analytics paid for a spreadsheet writer most visits never use.
  const exportExcel = async () => {
    const [{ buildAnalyticsWorkbook }, XLSX] = await Promise.all([
      import("@/lib/analytics-export"),
      import("xlsx"),
    ]);
    const workbook = buildAnalyticsWorkbook({
      generatedAt: new Date().toISOString(),
      metrics: {
        pipelineValue: formatUsd(kpis.pipelineValue, false),
        wonDeals: kpis.wonDeals,
        openDeals: kpis.openDeals,
        avgHealth: `${
          customers.length
            ? Math.round(
                customers.reduce((sum, customer) => sum + customer.health_score, 0) /
                  customers.length,
              )
            : 0
        }%`,
      },
      deals,
      customers,
      catalog,
    });

    XLSX.writeFile(workbook, buildExportFilename("livey-analytics", "xlsx"));
  };

  const stageChartConfig = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        stages.map((slice, index) => [
          slice.key,
          { label: slice.label, color: STAGE_COLORS[slice.key] ?? paletteColor(index) },
        ]),
      ),
    [stages],
  );

  const lossChartConfig = useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        losses.map((slice, index) => [
          slice.key,
          { label: slice.label, color: lossColor(slice.key, index) },
        ]),
      ),
    [losses],
  );

  const hasAnyDeal = deals.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workspace"
        icon={<BarChart3 className="h-3.5 w-3.5" />}
        title="Analytics"
        description="Revenue, pipeline and win/loss trends from the live records that power the rest of the portal."
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {/* Driven by the filtered rows, not the raw fetch — the old badge
                read "Live Postgres data" while every chart below it was empty
                because the region filter had excluded everything. */}
            <Badge tone={hasAnyDeal ? "success" : "neutral"}>
              {hasAnyDeal ? "Live Postgres data" : "Nothing in scope"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportExcel()}
              disabled={loading}
            >
              <Download className="mr-2 h-4 w-4" />
              Export Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={loading}>
              <Printer className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
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
        }
      />

      {!loading && !hasAnyDeal ? (
        <EmptyState
          icon={<BarChart3 className="h-5 w-5" />}
          title="No deals in the current scope"
          description={
            selectedRegion === "all"
              ? "Once deals are registered, every chart on this page fills in automatically."
              : `No deals match the ${
                  SALES_REGIONS.find((region) => region.key === selectedRegion)?.name ??
                  selectedRegion
                } region filter. Switch the region selector back to All regions to see the full book.`
          }
        />
      ) : null}

      {/* Every tile drills through to the rows behind it — a KPI is a question
          and the filtered list is the answer. Deltas compare the last 30 days
          with the 30 before, anchored on close date for decided deals and
          creation date for open ones. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          tone="violet"
          label="Total sales"
          value={formatUsd(kpis.totalSales)}
          hint={`${formatCount(kpis.wonDeals)} closed won`}
          delta={percentChange(comparison.current.totalSales, comparison.previous.totalSales)}
          deltaLabel={deltaLabel}
          to="/deals"
          search={{ stage: "won" }}
        />
        <KpiTile
          tone="indigo"
          label="Win rate"
          value={formatPercent(kpis.winRate, 2)}
          hint="Won vs decided deals"
          delta={
            comparison.current.winRate !== null && comparison.previous.winRate !== null
              ? percentChange(comparison.current.winRate, comparison.previous.winRate)
              : null
          }
          deltaLabel={deltaLabel}
          to="/deals"
          search={{ status: "won" }}
        />
        <KpiTile
          tone="sky"
          label="Close rate"
          value={formatPercent(kpis.closeRate, 2)}
          hint="Won vs every deal"
          to="/deals"
        />
        <KpiTile
          tone="teal"
          label="Avg days to close"
          value={formatDays(kpis.avgDaysToClose)}
          hint={
            kpis.daysToCloseExcluded > 0
              ? `${kpis.daysToCloseExcluded} excluded — close date precedes creation`
              : "Creation to close, won deals"
          }
          to="/deals"
          search={{ stage: "won" }}
        />
        <KpiTile
          tone="violet"
          label="Pipeline value"
          value={formatUsd(kpis.pipelineValue)}
          hint="Open deals at face value"
          to="/deals"
          search={{ status: "open" }}
        />
        <KpiTile
          tone="indigo"
          label="Open deals"
          value={formatCount(kpis.openDeals)}
          hint="Still in play"
          delta={percentChange(comparison.current.openDeals, comparison.previous.openDeals)}
          deltaLabel={`${deltaLabel} (newly created)`}
          to="/deals"
          search={{ status: "open" }}
        />
        <KpiTile
          tone="sky"
          label="Weighted value"
          value={formatUsd(kpis.weightedValue)}
          hint="Open value x probability"
          to="/pipeline"
        />
        <KpiTile
          tone="teal"
          label="Avg deal size"
          value={kpis.avgDealSize === null ? "—" : formatUsd(kpis.avgDealSize)}
          hint={`Across ${formatCount(kpis.wonDeals)} won deals`}
          delta={
            comparison.current.avgDealSize !== null && comparison.previous.avgDealSize !== null
              ? percentChange(comparison.current.avgDealSize, comparison.previous.avgDealSize)
              : null
          }
          deltaLabel={deltaLabel}
          to="/deals"
          search={{ stage: "won" }}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <ChartFrame
          className="xl:col-span-2"
          title="Won deals (last 12 months)"
          description="Closed value and deal count by committed close date."
          sample={wonSample}
          loading={loading}
          emptyLabel="No deals have closed won yet."
          thinLabel={`Only ${wonSample} won ${wonSample === 1 ? "deal" : "deals"} so far — not yet a trend.`}
        >
          <ChartContainer
            config={WON_CHART_CONFIG}
            className="aspect-auto h-[260px] w-full [&_.recharts-cartesian-axis-tick_text]:text-[11px]"
          >
            <ComposedChart data={wonSeries} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="value"
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(value: number) => formatUsd(value)}
                domain={[0, (max: number) => Math.max(Math.ceil(max * 1.2), 1)]}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                tickLine={false}
                axisLine={false}
                width={28}
                allowDecimals={false}
                domain={[0, (max: number) => Math.max(Math.ceil(max * 1.4), 1)]}
              />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <Bar
                yAxisId="value"
                dataKey="value"
                fill="var(--color-value)"
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
                isAnimationActive={false}
              />
              {/* dot is explicit: a month-count series with a single non-zero
                  point draws no line segment at all, so without a dot the
                  chart renders as an empty box. */}
              <Line
                yAxisId="count"
                dataKey="count"
                stroke="var(--color-count)"
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ChartContainer>
        </ChartFrame>

        <ChartFrame
          title="Sales pipeline"
          description="Share of deals sitting in each stage."
          sample={deals.length}
          loading={loading}
          emptyLabel="No deals to break down."
          thinThreshold={0}
        >
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <ChartContainer
              config={stageChartConfig}
              className="aspect-square h-[180px] w-[180px] shrink-0"
            >
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
                <Pie
                  data={stages}
                  dataKey="count"
                  nameKey="key"
                  innerRadius={52}
                  outerRadius={78}
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {stages.map((slice, index) => (
                    <Cell key={slice.key} fill={STAGE_COLORS[slice.key] ?? paletteColor(index)} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <DonutLegend
              total={stages.reduce((sum, slice) => sum + slice.count, 0)}
              items={stages.map((slice, index) => ({
                key: slice.key,
                label: slice.label,
                count: slice.count,
                color: STAGE_COLORS[slice.key] ?? paletteColor(index),
              }))}
            />
          </div>
        </ChartFrame>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <ChartFrame
          className="xl:col-span-2"
          title="Deals projection (next 12 months)"
          description="Open pipeline weighted by probability, by expected close month."
          sample={projectionSample}
          loading={loading}
          emptyLabel="No open deals to project."
          thinLabel={`Only ${projectionSample} open ${projectionSample === 1 ? "deal" : "deals"} — the projection will firm up as the pipeline grows.`}
        >
          <ChartContainer
            config={PROJECTION_CHART_CONFIG}
            className="aspect-auto h-[260px] w-full [&_.recharts-cartesian-axis-tick_text]:text-[11px]"
          >
            <ComposedChart
              data={projectionSeries}
              margin={{ left: 4, right: 4, top: 8, bottom: 0 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="value"
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(value: number) => formatUsd(value)}
                domain={[0, (max: number) => Math.max(Math.ceil(max * 1.2), 1)]}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                tickLine={false}
                axisLine={false}
                width={28}
                allowDecimals={false}
                domain={[0, (max: number) => Math.max(Math.ceil(max * 1.4), 1)]}
              />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              {/* Dashed, because every point here is a forecast rather than a
                  measurement — the solid/dashed distinction is the only thing
                  separating this chart from the one above it. */}
              <Line
                yAxisId="value"
                dataKey="value"
                stroke="var(--color-value)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
              <Line
                yAxisId="count"
                dataKey="count"
                stroke="var(--color-count)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ChartContainer>
        </ChartFrame>

        <ChartFrame
          title="Deal loss reasons"
          description="Why closed-lost deals were lost."
          sample={kpis.lostDeals}
          loading={loading}
          emptyLabel="Nothing has been lost yet."
          thinThreshold={0}
        >
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <ChartContainer
              config={lossChartConfig}
              className="aspect-square h-[180px] w-[180px] shrink-0"
            >
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
                <Pie
                  data={losses}
                  dataKey="count"
                  nameKey="key"
                  innerRadius={52}
                  outerRadius={78}
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {losses.map((slice, index) => (
                    <Cell key={slice.key} fill={lossColor(slice.key, index)} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <DonutLegend
              total={losses.reduce((sum, slice) => sum + slice.count, 0)}
              items={losses.map((slice, index) => ({
                key: slice.key,
                label: slice.label,
                count: slice.count,
                color: lossColor(slice.key, index),
              }))}
            />
          </div>
        </ChartFrame>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <ChartFrame
          title="Win rate trend"
          description="Share of each month's decided deals that were won."
          sample={decidedSample}
          loading={loading}
          emptyLabel="No deals have been decided yet."
          thinLabel={`Only ${decidedSample} decided ${decidedSample === 1 ? "deal" : "deals"} — a single result moves this chart a long way.`}
        >
          <ChartContainer
            config={WIN_RATE_CHART_CONFIG}
            className="aspect-auto h-[220px] w-full [&_.recharts-cartesian-axis-tick_text]:text-[11px]"
          >
            <BarChart data={winRateSeries} margin={{ left: 4, right: 4, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval="preserveStartEnd"
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={40}
                domain={[0, 100]}
                tickFormatter={(value: number) => `${value}%`}
              />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              {/* Months with no decisions carry winRate null, so recharts skips
                  the bar entirely rather than drawing a 0% column that would
                  read as "we lost everything that month". */}
              <Bar
                dataKey="winRate"
                fill="var(--color-winRate)"
                radius={[4, 4, 0, 0]}
                maxBarSize={26}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </ChartFrame>

        <ChartFrame
          title="Open pipeline by region"
          description="Where the winnable value sits."
          sample={regions.length}
          loading={loading}
          emptyLabel="No open deals to place."
          thinThreshold={0}
        >
          <ChartContainer
            config={REGION_CHART_CONFIG}
            className="aspect-auto h-[220px] w-full [&_.recharts-cartesian-axis-tick_text]:text-[11px]"
          >
            <BarChart
              data={regions}
              layout="vertical"
              margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => formatUsd(v)}
              />
              <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={72} />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <Bar
                dataKey="value"
                fill="var(--color-value)"
                radius={[0, 4, 4, 0]}
                maxBarSize={24}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </ChartFrame>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <ChartFrame
          title="Won value by product"
          description="Which products actually close."
          sample={products.length}
          loading={loading}
          emptyLabel="No won deals to attribute to a product."
          thinThreshold={0}
        >
          <ChartContainer
            config={PRODUCT_CHART_CONFIG}
            className="aspect-auto h-[240px] w-full [&_.recharts-cartesian-axis-tick_text]:text-[11px]"
          >
            <BarChart
              data={products.slice(0, 7)}
              layout="vertical"
              margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => formatUsd(v)}
              />
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={false}
                width={104}
              />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <Bar
                dataKey="value"
                fill="var(--color-value)"
                radius={[0, 4, 4, 0]}
                maxBarSize={22}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </ChartFrame>

        <ChartFrame
          title="New vs existing business"
          description="Won value from first-time customers against repeat buyers."
          sample={businessSplitTotal > 0 ? kpis.wonDeals : 0}
          loading={loading}
          emptyLabel="No won deals to split yet."
          thinThreshold={0}
        >
          {businessSplit.existing === 0 ? (
            // A half-donut pinned at 100% is decoration, not a metric. Until
            // some customer has bought twice, say so in words.
            <div className="flex h-[240px] flex-col items-center justify-center gap-1 text-center">
              <span className="text-2xl font-semibold" data-numeric>
                {formatUsd(businessSplit.newBusiness)}
              </span>
              <span className="text-sm text-muted-foreground">all from first-time customers</span>
              <span className="mt-1 text-xs text-muted-foreground">
                No customer has closed a second deal yet, so there is no split to show.
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <ChartContainer
                config={BUSINESS_CHART_CONFIG}
                className="aspect-auto h-[170px] w-full"
              >
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
                  {/* Half donut: the reference renders this split as a gauge
                      rather than a full circle, which reads as a ratio. */}
                  <Pie
                    data={businessSplitData}
                    dataKey="value"
                    nameKey="key"
                    startAngle={180}
                    endAngle={0}
                    cy="90%"
                    innerRadius={62}
                    outerRadius={96}
                    strokeWidth={2}
                    isAnimationActive={false}
                  >
                    <Cell fill="var(--chart-2)" />
                    <Cell fill="var(--chart-1)" />
                  </Pie>
                </PieChart>
              </ChartContainer>
              <DonutLegend
                total={businessSplitTotal}
                items={[
                  {
                    key: "new",
                    label: `New business · ${formatUsd(businessSplit.newBusiness)}`,
                    count: businessSplit.newBusiness,
                    color: "var(--chart-2)",
                  },
                  {
                    key: "existing",
                    label: `Existing business · ${formatUsd(businessSplit.existing)}`,
                    count: businessSplit.existing,
                    color: "var(--chart-1)",
                  },
                ]}
              />
            </div>
          )}
        </ChartFrame>

        <ChartFrame
          title="Deals by source"
          description="Where the book comes from, by deal count."
          sample={sources.length}
          loading={loading}
          emptyLabel="No deals to attribute to a source."
          thinThreshold={0}
        >
          <ChartContainer
            config={SOURCE_CHART_CONFIG}
            className="aspect-auto h-[240px] w-full [&_.recharts-cartesian-axis-tick_text]:text-[11px]"
          >
            <BarChart
              data={sources.slice(0, 7)}
              layout="vertical"
              margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="label"
                tickLine={false}
                axisLine={false}
                width={104}
              />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <Bar
                dataKey="count"
                fill="var(--color-count)"
                radius={[0, 4, 4, 0]}
                maxBarSize={22}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </ChartFrame>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <ChartFrame
          title="Top closers"
          description="Won value by deal owner."
          sample={owners.length}
          loading={loading}
          emptyLabel="No won deals to attribute yet."
          thinThreshold={0}
        >
          <ChartContainer
            config={OWNER_CHART_CONFIG}
            className="aspect-auto h-[220px] w-full [&_.recharts-cartesian-axis-tick_text]:text-[11px]"
          >
            <BarChart
              data={owners.slice(0, 6)}
              layout="vertical"
              margin={{ left: 4, right: 12, top: 4, bottom: 4 }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => formatUsd(v)}
              />
              <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={92} />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <Bar
                dataKey="value"
                fill="var(--color-value)"
                radius={[0, 4, 4, 0]}
                maxBarSize={24}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        </ChartFrame>
      </div>
    </div>
  );
}

/**
 * Stage colours.
 *
 * Deliberately NOT DEAL_STAGE_TONE: that map collapses eight stages into five
 * semantic tones, so demo and testing are both "info" and qualified and
 * proposal are both "brand" — two identical adjacent slices in a donut, which
 * reads as one category. Badges encode escalation; chart slices encode
 * identity, and those are different jobs.
 */
const STAGE_COLORS: Record<string, string> = {
  sourced: "var(--chart-1)",
  demo: "var(--chart-2)",
  testing: "var(--chart-7)",
  qualified: "var(--chart-3)",
  proposal: "var(--chart-8)",
  negotiation: "var(--chart-4)",
  won: "var(--success)",
  lost: "var(--destructive)",
};

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];

function paletteColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

/** Uncategorised losses stay grey so they read as absence, not as a reason. */
function lossColor(key: string, index: number): string {
  return key === "Not recorded" ? "var(--muted-foreground)" : paletteColor(index);
}

const WON_CHART_CONFIG = {
  value: { label: "Closed value", color: "var(--chart-1)" },
  count: { label: "Won deals", color: "var(--chart-2)" },
} satisfies ChartConfig;

const PROJECTION_CHART_CONFIG = {
  value: { label: "Projected value", color: "var(--chart-1)" },
  count: { label: "Deals due", color: "var(--chart-2)" },
} satisfies ChartConfig;

const WIN_RATE_CHART_CONFIG = {
  winRate: { label: "Win rate", color: "var(--chart-3)" },
} satisfies ChartConfig;

const REGION_CHART_CONFIG = {
  value: { label: "Open value", color: "var(--chart-7)" },
} satisfies ChartConfig;

const OWNER_CHART_CONFIG = {
  value: { label: "Won value", color: "var(--success)" },
} satisfies ChartConfig;

const PRODUCT_CHART_CONFIG = {
  value: { label: "Won value", color: "var(--chart-6)" },
} satisfies ChartConfig;

const SOURCE_CHART_CONFIG = {
  count: { label: "Deals", color: "var(--chart-5)" },
} satisfies ChartConfig;

const BUSINESS_CHART_CONFIG = {
  new: { label: "New business", color: "var(--chart-2)" },
  existing: { label: "Existing business", color: "var(--chart-1)" },
} satisfies ChartConfig;
