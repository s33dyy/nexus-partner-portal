import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { EmptyState } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CsvExportButton } from "@/components/csv-export-button";
import {
  dealUsd,
  sliceShares,
  wonDealsInSlice,
  type Slice,
  type WonMixDimension,
} from "@/lib/analytics-metrics";
import { formatDateLabel } from "@/lib/date-utils";
import type { DealRecord } from "@/lib/portal-records";

/**
 * The expanded view behind a won-value chart.
 *
 * The card versions of these charts show the top handful of bars, which is
 * right for a dashboard and wrong for answering "why". This shows every row,
 * its share of the total, and — when you open a row — the individual won deals
 * the bar was summed from.
 *
 * The member deals come from wonDealsInSlice(), the same label function the
 * bar itself was grouped by, so the footer total always reconciles with the
 * chart. A drill-down that quietly regrouped would be worse than none: it
 * would look authoritative and disagree.
 */
export function AnalyticsBreakdownDialog({
  open,
  onOpenChange,
  title,
  description,
  dimension,
  slices,
  deals,
  initialKey,
  valueLabel = "Won value",
  chartConfig,
  formatValue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  dimension: WonMixDimension;
  /** Every slice, not the truncated set the card chart draws. */
  slices: Slice[];
  deals: DealRecord[];
  /** Pre-opened row, set when the user arrives by clicking a specific bar. */
  initialKey?: string | null;
  valueLabel?: string;
  chartConfig: ChartConfig;
  formatValue: (value: number) => string;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(initialKey ?? null);

  // Re-seed the open row each time the dialog is opened from a different bar,
  // without fighting the user's clicks while it stays open.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (open && (initialKey ?? null) !== seededFor) {
    setSeededFor(initialKey ?? null);
    setExpandedKey(initialKey ?? null);
  }

  const rows = useMemo(() => sliceShares(slices), [slices]);
  const total = useMemo(() => slices.reduce((sum, slice) => sum + slice.value, 0), [slices]);
  const dealCount = useMemo(() => slices.reduce((sum, slice) => sum + slice.count, 0), [slices]);

  const memberDeals = useMemo(
    () => (expandedKey ? wonDealsInSlice(deals, dimension, expandedKey) : []),
    [deals, dimension, expandedKey],
  );

  // Every bar, so the tall chart matches the table beneath it row for row.
  const chartHeight = Math.max(220, Math.min(520, rows.length * 34 + 40));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description ? `${description} ` : null}
            {rows.length} {rows.length === 1 ? "row" : "rows"} · {dealCount}{" "}
            {dealCount === 1 ? "won deal" : "won deals"} · {formatValue(total)} total
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <EmptyState
            title="Nothing to break down"
            description="No won deals fall into this view yet."
          />
        ) : (
          <div className="space-y-5">
            <ChartContainer
              config={chartConfig}
              className="aspect-auto w-full [&_.recharts-cartesian-axis-tick_text]:text-[11px]"
              style={{ height: chartHeight }}
            >
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ left: 4, right: 16, top: 4, bottom: 4 }}
              >
                <CartesianGrid horizontal={false} />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => formatValue(value)}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  width={140}
                />
                <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                <Bar
                  dataKey="value"
                  fill="var(--color-value)"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={22}
                  isAnimationActive={false}
                  className="cursor-pointer"
                  onClick={(entry: { payload?: Slice }) => {
                    const key = entry?.payload?.key;
                    if (key) setExpandedKey((current) => (current === key ? null : key));
                  }}
                />
              </BarChart>
            </ChartContainer>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>{dimension === "product" ? "Product" : "Deal owner"}</TableHead>
                    <TableHead className="text-right">{valueLabel}</TableHead>
                    <TableHead className="text-right">Deals</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                    <TableHead className="text-right">Avg deal</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => {
                    const isOpen = expandedKey === row.key;
                    return (
                      <TableRow
                        key={row.key}
                        data-state={isOpen ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => setExpandedKey(isOpen ? null : row.key)}
                      >
                        <TableCell className="text-[12px] text-muted-foreground">
                          {index + 1}
                        </TableCell>
                        <TableCell className="text-[13px] font-medium">{row.label}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatValue(row.value)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {/* null share means the total was zero — say so rather
                              than printing a measured-looking 0%. */}
                          {row.share === null ? "—" : `${row.share.toFixed(1)}%`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.count > 0 ? formatValue(row.value / row.count) : "—"}
                        </TableCell>
                        <TableCell>
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {expandedKey ? (
              <div className="rounded-md border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">{expandedKey}</Badge>
                    <span className="text-[13px] text-muted-foreground">
                      {memberDeals.length} won {memberDeals.length === 1 ? "deal" : "deals"} ·{" "}
                      {formatValue(memberDeals.reduce((sum, deal) => sum + dealUsd(deal), 0))}
                    </span>
                  </div>
                  <CsvExportButton
                    label="Export these deals"
                    variant="ghost"
                    filenameStem={`won-deals-${dimension}-${expandedKey}`
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")}
                    columns={[
                      { key: "account_name", header: "Account" },
                      { key: "owner_name", header: "Owner" },
                      { key: "product", header: "Product" },
                      { key: "region", header: "Region" },
                      { key: "country", header: "Country" },
                      { key: "close_date", header: "Close date" },
                      { key: "amount_usd", header: "Amount (USD)" },
                    ]}
                    loadRows={async () =>
                      memberDeals.map((deal) => ({
                        account_name: deal.account_name,
                        owner_name: deal.owner_name,
                        product: deal.product,
                        region: deal.region,
                        country: deal.country,
                        close_date: deal.close_date,
                        amount_usd: dealUsd(deal),
                      }))
                    }
                  />
                </div>
                {memberDeals.length === 0 ? (
                  <EmptyState
                    title="No deals behind this row"
                    description="The bar totals zero, so there is nothing to list."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          {/* The dimension you drilled in on is constant down
                              the column, so show the OTHER one — it is the
                              information this table actually adds. */}
                          <TableHead>{dimension === "product" ? "Owner" : "Product"}</TableHead>
                          <TableHead>Region</TableHead>
                          <TableHead>Closed</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {memberDeals.map((deal) => (
                          <TableRow key={deal.id}>
                            <TableCell className="text-[13px] font-medium">
                              {deal.account_name}
                            </TableCell>
                            <TableCell className="text-[13px]">
                              {dimension === "product"
                                ? deal.owner_name || "Unassigned"
                                : deal.product || "Unspecified"}
                            </TableCell>
                            <TableCell className="text-[13px]">
                              {deal.region || "—"}
                              {deal.country ? (
                                <span className="ml-1 text-muted-foreground">({deal.country})</span>
                              ) : null}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-[13px] text-muted-foreground">
                              {formatDateLabel(deal.close_date)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatValue(dealUsd(deal))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Select a row or a bar to see the individual deals behind it.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
