import {
  DEAL_STAGE_ORDER,
  getDealUsdAmount,
  isTerminalDealStage,
  type DealRecord,
  type DealStage,
} from "@/lib/portal-records";
import { isOpenPipelineStage } from "@/lib/pipeline-metrics";

/**
 * Every number the Analytics dashboard shows, as pure functions over the deal
 * rows the route already loads.
 *
 * Kept out of the route so each definition is testable and stated once. The
 * page previously computed its handful of figures inline, which is why "win
 * rate" there and "win rate" in the digest were free to drift apart.
 *
 * Two rules hold throughout:
 *
 *  - Money is always USD. `amount_usd` is the converted figure; the free-text
 *    `amount` is only a fallback for rows that predate FX capture.
 *  - Every ratio returns null rather than 0 when its denominator is empty.
 *    Zero is a real answer ("we won nothing"); null is "not enough data to
 *    say", and a tile showing 0% when nothing has closed is a lie.
 */

/**
 * Re-exported rather than redefined.
 *
 * `getDealUsdAmount` is the amount ladder (converted USD, falling back to
 * parsing the free-text amount). Note the app has a SECOND ladder,
 * `resolvePipelineDtpUsd` in pipeline-metrics.ts, which prices from the
 * pricing_revisions DTP total instead and deliberately refuses the free text.
 * The Dashboard uses that one; Analytics cannot, because reaching
 * pricing_revisions needs a server-side join this client route does not have.
 * The two therefore report different pipeline totals for the same deals —
 * a real contradiction that needs its own fix, not a papered-over one here.
 * Until then every figure on this page is "deal amount", never "DTP".
 */
export const dealUsd = getDealUsdAmount;

export const isOpenDeal = (deal: Pick<DealRecord, "stage">) => isOpenPipelineStage(deal.stage);

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const days = (end - start) / DAY_MS;
  return days >= 0 ? days : null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type AnalyticsKpis = {
  totalSales: number;
  pipelineValue: number;
  weightedValue: number;
  openDeals: number;
  wonDeals: number;
  lostDeals: number;
  /** Won / (won + lost) — of the deals that reached a decision, how many landed. */
  winRate: number | null;
  /** Won / every deal ever created — what share of everything worked has closed won. */
  closeRate: number | null;
  avgDaysToClose: number | null;
  avgOpenDealAge: number | null;
  avgDealSize: number | null;
  /**
   * Won deals left out of avgDaysToClose because their close date precedes
   * their creation date.
   *
   * Reported rather than clamped. `max(0, close - created)` would invent a
   * same-day close and drag the mean toward zero, turning a visible data
   * defect into an invisible one. The seeded rows have exactly this problem,
   * so without the exclusion the tile reads "-1 days to close".
   */
  daysToCloseExcluded: number;
};

/**
 * Win rate and close rate are different questions and the reference dashboard
 * shows both, at different values (16.92% vs 14.47%):
 *
 *  - Win rate judges the closer. Its denominator is decided deals only, so
 *    deals still in flight can't drag it down.
 *  - Close rate judges the funnel. Its denominator is everything, so a large
 *    stalled pipeline pushes it below the win rate — which is the signal.
 */
export function computeKpis(deals: DealRecord[], now = new Date()): AnalyticsKpis {
  const won = deals.filter((deal) => deal.stage === "won");
  const lost = deals.filter((deal) => deal.stage === "lost");
  const open = deals.filter(isOpenDeal);
  const decided = won.length + lost.length;

  const closeDurations = won.map((deal) => daysBetween(deal.created_at, deal.close_date));
  const usableDurations = closeDurations.filter((value): value is number => value !== null);

  return {
    totalSales: won.reduce((sum, deal) => sum + dealUsd(deal), 0),
    // Open deals only. Including won would double-count revenue already
    // banked in Total sales, and including lost would inflate a number
    // whose whole job is "what is still winnable".
    pipelineValue: open.reduce((sum, deal) => sum + dealUsd(deal), 0),
    weightedValue: open.reduce((sum, deal) => sum + dealUsd(deal) * (deal.probability / 100), 0),
    openDeals: open.length,
    wonDeals: won.length,
    lostDeals: lost.length,
    winRate: decided > 0 ? (won.length / decided) * 100 : null,
    closeRate: deals.length > 0 ? (won.length / deals.length) * 100 : null,
    avgDaysToClose: mean(usableDurations),
    daysToCloseExcluded: closeDurations.length - usableDurations.length,
    avgOpenDealAge: mean(
      open
        .map((deal) => daysBetween(deal.created_at, now.toISOString()))
        .filter((value): value is number => value !== null),
    ),
    avgDealSize: won.length > 0 ? won.reduce((sum, d) => sum + dealUsd(d), 0) / won.length : null,
  };
}

/** Percentage change from `previous` to `current`, or null when undefined. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export type PeriodComparison = {
  current: AnalyticsKpis;
  previous: AnalyticsKpis;
  /** Days in each window, so the UI can say what it is comparing. */
  windowDays: number;
};

/**
 * The same KPIs over the last N days and the N days before that.
 *
 * What "in the period" means depends on the metric, which is why this splits
 * the book rather than filtering once: a CLOSED deal belongs to the window its
 * close date falls in, but an OPEN deal belongs to the window it was created
 * in — an open deal has no close date to be judged by, only an age. Filtering
 * everything by one column would either drop the whole pipeline from the
 * current period or count a deal created a year ago as this month's work.
 */
export function comparePeriods(
  deals: DealRecord[],
  now = new Date(),
  windowDays = 30,
): PeriodComparison {
  const windowMs = windowDays * DAY_MS;
  const currentStart = now.getTime() - windowMs;
  const previousStart = currentStart - windowMs;

  const inWindow = (deal: DealRecord, start: number, end: number) => {
    const anchor = isTerminalDealStage(deal.stage as DealStage)
      ? new Date(deal.close_date).getTime()
      : new Date(deal.created_at).getTime();
    return Number.isFinite(anchor) && anchor >= start && anchor < end;
  };

  return {
    current: computeKpis(
      deals.filter((deal) => inWindow(deal, currentStart, now.getTime())),
      now,
    ),
    previous: computeKpis(
      deals.filter((deal) => inWindow(deal, previousStart, currentStart)),
      new Date(currentStart),
    ),
    windowDays,
  };
}

/** Won value and count by product, largest first. */
export function productMix(deals: DealRecord[]): Slice[] {
  const byProduct = new Map<string, Slice>();
  for (const deal of deals.filter((deal) => deal.stage === "won")) {
    const label = deal.product?.trim() || "Unspecified";
    const existing = byProduct.get(label);
    if (existing) {
      existing.count += 1;
      existing.value += dealUsd(deal);
    } else {
      byProduct.set(label, { key: label, label, count: 1, value: dealUsd(deal) });
    }
  }
  return [...byProduct.values()].sort((a, b) => b.value - a.value);
}

/** Where open pipeline value sits by source, so channel mix is visible. */
export function sourceMix(deals: DealRecord[]): Slice[] {
  const bySource = new Map<string, Slice>();
  for (const deal of deals) {
    const label = deal.source?.trim() || "Unspecified";
    const existing = bySource.get(label);
    if (existing) {
      existing.count += 1;
      existing.value += dealUsd(deal);
    } else {
      bySource.set(label, { key: label, label, count: 1, value: dealUsd(deal) });
    }
  }
  return [...bySource.values()].sort((a, b) => b.count - a.count);
}

export type MonthBucket = {
  /** YYYY-MM, used as the stable key. */
  key: string;
  /** "May 2025" — what the axis renders. */
  label: string;
  value: number;
  count: number;
};

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * A contiguous run of months, so a chart's x-axis is a real timeline.
 *
 * Bucketing only the months that happen to contain a deal would draw a
 * straight line between March and September as though nothing happened in
 * between — the gap IS the information.
 */
export function buildMonthRange(anchor: Date, monthsBack: number, monthsForward: number) {
  const months: Array<{ key: string; label: string; start: Date; end: Date }> = [];
  for (let offset = -monthsBack; offset <= monthsForward; offset += 1) {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + offset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    months.push({ key: monthKey(start), label: monthLabel(start), start, end });
  }
  return months;
}

function bucketByMonth(
  deals: DealRecord[],
  dateOf: (deal: DealRecord) => string | null,
  valueOf: (deal: DealRecord) => number,
  months: ReturnType<typeof buildMonthRange>,
): MonthBucket[] {
  const buckets = new Map(months.map((m) => [m.key, { value: 0, count: 0 }]));
  for (const deal of deals) {
    const raw = dateOf(deal);
    if (!raw) continue;
    const when = new Date(raw);
    if (!Number.isFinite(when.getTime())) continue;
    const bucket = buckets.get(monthKey(when));
    if (!bucket) continue;
    bucket.value += valueOf(deal);
    bucket.count += 1;
  }
  return months.map((m) => ({
    key: m.key,
    label: m.label,
    value: buckets.get(m.key)?.value ?? 0,
    count: buckets.get(m.key)?.count ?? 0,
  }));
}

/** Closed-won value and count, by the month the deal actually closed. */
export function wonDealsByMonth(deals: DealRecord[], anchor: Date, monthsBack = 11): MonthBucket[] {
  return bucketByMonth(
    deals.filter((deal) => deal.stage === "won"),
    (deal) => deal.close_date,
    dealUsd,
    buildMonthRange(anchor, monthsBack, 0),
  );
}

/**
 * Forward projection for open deals, weighted by probability.
 *
 * Weighted rather than face value on purpose: an unweighted projection is a
 * wish list, and every deal in it is 100% certain right up until it isn't.
 * Bucketed by possible_close_date where the owner set one, falling back to the
 * committed close_date.
 */
export function projectedDealsByMonth(
  deals: DealRecord[],
  anchor: Date,
  monthsForward = 11,
): MonthBucket[] {
  return bucketByMonth(
    deals.filter(isOpenDeal),
    (deal) => deal.possible_close_date ?? deal.close_date,
    (deal) => dealUsd(deal) * (deal.probability / 100),
    buildMonthRange(anchor, 0, monthsForward),
  );
}

/** Monthly win rate over decided deals, for the trend bars. */
export function winRateByMonth(
  deals: DealRecord[],
  anchor: Date,
  monthsBack = 11,
): Array<{ key: string; label: string; winRate: number | null; decided: number }> {
  const months = buildMonthRange(anchor, monthsBack, 0);
  const decided = deals.filter((deal) => isTerminalDealStage(deal.stage as DealStage));
  return months.map((month) => {
    const inMonth = decided.filter((deal) => {
      const when = new Date(deal.close_date);
      return Number.isFinite(when.getTime()) && monthKey(when) === month.key;
    });
    const wins = inMonth.filter((deal) => deal.stage === "won").length;
    return {
      key: month.key,
      label: month.label,
      decided: inMonth.length,
      winRate: inMonth.length > 0 ? (wins / inMonth.length) * 100 : null,
    };
  });
}

export type Slice = { key: string; label: string; value: number; count: number };

/** Stage mix across every non-terminal stage plus won and lost, in pipeline order. */
export function stageMix(deals: DealRecord[]): Slice[] {
  return DEAL_STAGE_ORDER.map((stage) => {
    const inStage = deals.filter((deal) => deal.stage === stage);
    return {
      key: stage,
      label: stage.replace(/_/g, " "),
      count: inStage.length,
      value: inStage.reduce((sum, deal) => sum + dealUsd(deal), 0),
    };
  }).filter((slice) => slice.count > 0);
}

/**
 * Why deals were lost.
 *
 * Only lost deals with a category count. Rows closed before the category
 * existed are grouped as "Not recorded" rather than dropped — hiding them
 * would make the recorded reasons look like the whole picture.
 */
export function lossReasonMix(deals: DealRecord[]): Slice[] {
  const lost = deals.filter((deal) => deal.stage === "lost");
  const byReason = new Map<string, Slice>();
  for (const deal of lost) {
    const label = deal.loss_reason_category?.trim() || "Not recorded";
    const existing = byReason.get(label);
    if (existing) {
      existing.count += 1;
      existing.value += dealUsd(deal);
    } else {
      byReason.set(label, { key: label, label, count: 1, value: dealUsd(deal) });
    }
  }
  return [...byReason.values()].sort((a, b) => b.count - a.count);
}

/** Open pipeline value by sales region, largest first. */
export function regionMix(deals: DealRecord[]): Slice[] {
  const byRegion = new Map<string, Slice>();
  for (const deal of deals.filter(isOpenDeal)) {
    const label = deal.region?.trim() || "Unassigned";
    const existing = byRegion.get(label);
    if (existing) {
      existing.count += 1;
      existing.value += dealUsd(deal);
    } else {
      byRegion.set(label, { key: label, label, count: 1, value: dealUsd(deal) });
    }
  }
  return [...byRegion.values()].sort((a, b) => b.value - a.value);
}

/** Won value by deal owner, largest first — the leaderboard. */
export function ownerMix(deals: DealRecord[]): Slice[] {
  const byOwner = new Map<string, Slice>();
  for (const deal of deals.filter((deal) => deal.stage === "won")) {
    const label = deal.owner_name?.trim() || "Unassigned";
    const existing = byOwner.get(label);
    if (existing) {
      existing.count += 1;
      existing.value += dealUsd(deal);
    } else {
      byOwner.set(label, { key: label, label, count: 1, value: dealUsd(deal) });
    }
  }
  return [...byOwner.values()].sort((a, b) => b.value - a.value);
}

/**
 * New versus existing business by won value.
 *
 * "Existing" means the customer had an earlier won deal than this one, so the
 * split is derived from the deal history rather than a flag nobody maintains.
 * A deal with no customer_id counts as new — it cannot be shown to be a repeat.
 */
export function newVsExistingBusiness(deals: DealRecord[]): {
  newBusiness: number;
  existing: number;
} {
  const won = deals
    .filter((deal) => deal.stage === "won")
    .slice()
    .sort((a, b) => new Date(a.close_date).getTime() - new Date(b.close_date).getTime());

  const seenCustomers = new Set<string>();
  let newBusiness = 0;
  let existing = 0;

  for (const deal of won) {
    const customer = deal.customer_id;
    if (customer && seenCustomers.has(customer)) {
      existing += dealUsd(deal);
    } else {
      newBusiness += dealUsd(deal);
      if (customer) seenCustomers.add(customer);
    }
  }
  return { newBusiness, existing };
}
