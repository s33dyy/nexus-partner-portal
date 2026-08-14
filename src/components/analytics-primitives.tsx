import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The vocabulary the Analytics dashboard is built from.
 *
 * Two ideas do most of the work here, and both come from the same problem:
 * this app's real dataset is small, and a chart library will happily draw a
 * confident-looking lie over almost no data.
 *
 *  - `formatMetric` renders null as an em-dash, never as 0. "We won 0% of our
 *    deals" and "nothing has been decided yet" are different claims, and only
 *    one of them is usually true.
 *  - `ChartFrame` gives every chart three states rather than two: loading,
 *    genuinely empty, and drawable-but-thin. The third is where this data
 *    actually lives, and it is the one a plain chart component gets wrong —
 *    recharts renders an all-zero series as a tidy axis with a flat line,
 *    which asserts a year of zero activity instead of admitting it has
 *    nothing to show.
 */

/**
 * The gradient KPI tile from the reference dashboards.
 *
 * `tone` picks one of the ramp positions rather than a literal colour, so the
 * grid reads as one designed set instead of eight independent decisions.
 */
export type KpiTone = "violet" | "indigo" | "sky" | "teal";

const TONE_GRADIENT: Record<KpiTone, string> = {
  violet: "from-[oklch(0.52_0.20_300)] to-[oklch(0.46_0.19_285)]",
  indigo: "from-[oklch(0.50_0.18_265)] to-[oklch(0.42_0.16_262)]",
  sky: "from-[oklch(0.58_0.15_235)] to-[oklch(0.52_0.14_215)]",
  teal: "from-[oklch(0.60_0.14_190)] to-[oklch(0.58_0.14_165)]",
};

export function KpiTile({
  label,
  value,
  hint,
  tone = "indigo",
  delta,
  deltaLabel,
  to,
  search,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: KpiTone;
  /** Percentage change vs the prior period; null when there is no baseline. */
  delta?: number | null;
  /** What the delta is measured against, e.g. "vs prior 30 days". */
  deltaLabel?: string;
  /**
   * Where the tile drills through to. A KPI is a question ("how much is open?")
   * and the rows behind it are the answer, so every tile that summarises a
   * subset of deals links to that subset pre-filtered.
   */
  to?: string;
  search?: Record<string, string>;
  className?: string;
}) {
  const rising = delta !== null && delta !== undefined && delta >= 0;

  const body = (
    <>
      {to ? (
        <ArrowUpRight
          className="absolute right-3 top-3 h-4 w-4 text-white/0 transition-colors group-hover:text-white/70"
          aria-hidden="true"
        />
      ) : null}
      <div className="text-[13px] font-medium text-white/80">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight" data-numeric>
          {value}
        </span>
        {delta !== null && delta !== undefined ? (
          <span
            className={cn(
              "flex items-center gap-0.5 text-xs font-medium",
              rising ? "text-white" : "text-white/90",
            )}
          >
            {rising ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            {Math.abs(delta).toFixed(1)}%
          </span>
        ) : null}
      </div>
      {hint ? <div className="mt-1 text-[11px] leading-tight text-white/70">{hint}</div> : null}
      {delta !== null && delta !== undefined && deltaLabel ? (
        <div className="mt-0.5 text-[11px] leading-tight text-white/60">{deltaLabel}</div>
      ) : null}
    </>
  );

  const surface = cn(
    "group relative block overflow-hidden rounded-xl bg-linear-to-br p-4 text-left text-white shadow-card",
    TONE_GRADIENT[tone],
    to &&
      "transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    className,
  );

  if (!to) return <div className={surface}>{body}</div>;

  return (
    <Link to={to} search={search} className={surface}>
      {body}
    </Link>
  );
}

/**
 * Wraps a chart with its three states.
 *
 * `sample` is the number of rows actually behind the chart. When it is zero
 * the chart never mounts — a recharts Pie whose values sum to zero renders
 * literally nothing, which looks like a broken card rather than an empty one.
 * When it is small the chart draws but carries a caption saying so, because a
 * trend line through two points is a drawing, not a trend.
 */
export function ChartFrame({
  title,
  description,
  sample,
  loading = false,
  emptyLabel = "No data in the current scope.",
  thinThreshold = 3,
  thinLabel,
  action,
  height = 260,
  children,
  className,
}: {
  title: string;
  description?: string;
  sample: number;
  loading?: boolean;
  emptyLabel?: string;
  /** At or below this many rows the chart is captioned as provisional. */
  thinThreshold?: number;
  thinLabel?: string;
  action?: React.ReactNode;
  height?: number;
  children: React.ReactNode;
  className?: string;
}) {
  const isEmpty = sample === 0;
  const isThin = !isEmpty && sample <= thinThreshold;

  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {loading ? (
          <Skeleton className="w-full rounded-lg" style={{ height }} />
        ) : isEmpty ? (
          <div
            className="flex items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground"
            style={{ height }}
          >
            {emptyLabel}
          </div>
        ) : (
          <div className="min-w-0">
            {children}
            {isThin ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {thinLabel ??
                  `Based on ${sample} ${sample === 1 ? "record" : "records"} — too few to read as a trend yet.`}
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** A labelled swatch list, used as the legend beside every donut. */
export function DonutLegend({
  items,
  total,
}: {
  items: Array<{ key: string; label: string; count: number; color: string }>;
  total: number;
}) {
  return (
    <ul className="min-w-0 flex-1 space-y-1.5">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-2 text-[13px]">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate capitalize">{item.label}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground" data-numeric>
            {total > 0 ? `${((item.count / total) * 100).toFixed(1)}%` : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}
