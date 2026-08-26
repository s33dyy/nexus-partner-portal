import { describe, expect, test } from "bun:test";

import {
  buildMonthRange,
  comparePeriods,
  computeKpis,
  dealUsd,
  lossReasonMix,
  newVsExistingBusiness,
  ownerMix,
  percentChange,
  productMix,
  sliceShares,
  projectedDealsByMonth,
  sourceMix,
  stageMix,
  winRateByMonth,
  wonDealsByMonth,
  wonDealsInSlice,
} from "@/lib/analytics-metrics";
import type { DealRecord } from "@/lib/portal-records";

const ANCHOR = new Date("2026-08-15T00:00:00.000Z");

function deal(overrides: Partial<DealRecord>): DealRecord {
  return {
    id: "deal-1",
    account_name: "Acme",
    customer_id: null,
    contact_name: "Morgan",
    poc_profile_id: null,
    owner_name: "Priya",
    country: "India",
    region: "India West",
    product: "LIV-CLD-100",
    stage: "demo",
    status: "submitted",
    quantity: 1,
    amount: "$1,000",
    currency_code: "USD",
    amount_value: 1000,
    amount_usd: 1000,
    fx_rate: null,
    fx_provider: null,
    fx_rate_fetched_at: null,
    customer_budget: null,
    probability: 50,
    possible_close_date: null,
    proposed_completion_date: null,
    close_date: "2026-08-01",
    source: "partner",
    last_touch: "seed",
    notes: "",
    user_id: null,
    partner_id: null,
    is_hidden_to_team: false,
    reward_rate_percent: 5,
    commercial_approved: true,
    loss_reason_category: null,
    loss_reason_detail: null,
    version: 1,
    is_seed: false,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  } as DealRecord;
}

describe("dealUsd", () => {
  test("prefers the converted amount and falls back to parsing the free text", () => {
    expect(dealUsd({ amount: "$10", amount_usd: 834.5 })).toBe(834.5);
    expect(dealUsd({ amount: "₹9,20,000", amount_usd: null })).toBe(920000);
    // 0 and negatives are not a usable conversion — fall back rather than
    // silently reporting a deal as worthless.
    expect(dealUsd({ amount: "$250", amount_usd: 0 })).toBe(250);
  });
});

describe("computeKpis", () => {
  const deals = [
    deal({ id: "w1", stage: "won", amount_usd: 1000, close_date: "2026-08-01" }),
    deal({ id: "w2", stage: "won", amount_usd: 3000, close_date: "2026-08-05" }),
    deal({ id: "l1", stage: "lost", amount_usd: 5000 }),
    deal({ id: "o1", stage: "demo", amount_usd: 2000, probability: 25 }),
    deal({ id: "o2", stage: "negotiation", amount_usd: 4000, probability: 100 }),
  ];

  test("win rate counts only decided deals; close rate counts everything", () => {
    const kpis = computeKpis(deals, ANCHOR);
    // 2 won of 3 decided.
    expect(kpis.winRate).toBeCloseTo(66.667, 2);
    // 2 won of 5 total — lower, because open deals sit in the denominator.
    expect(kpis.closeRate).toBe(40);
    expect(kpis.winRate).toBeGreaterThan(kpis.closeRate as number);
  });

  test("pipeline value counts open deals only, so banked and dead revenue stay out", () => {
    const kpis = computeKpis(deals, ANCHOR);
    expect(kpis.pipelineValue).toBe(6000);
    expect(kpis.totalSales).toBe(4000);
    // 2000*0.25 + 4000*1.0
    expect(kpis.weightedValue).toBe(4500);
  });

  test("ratios are null rather than zero when nothing has been decided", () => {
    const open = [deal({ stage: "demo" })];
    const kpis = computeKpis(open, ANCHOR);
    // "We won 0% of our deals" is a very different claim from "nothing has
    // closed yet", and a tile that prints 0% makes the first one.
    expect(kpis.winRate).toBeNull();
    expect(kpis.avgDaysToClose).toBeNull();
    expect(kpis.avgDealSize).toBeNull();
  });

  test("an empty book produces no NaN anywhere", () => {
    const kpis = computeKpis([], ANCHOR);
    expect(kpis.totalSales).toBe(0);
    expect(kpis.closeRate).toBeNull();
    expect(Object.values(kpis).some((v) => typeof v === "number" && Number.isNaN(v))).toBe(false);
  });

  test("average days to close measures creation to close", () => {
    const kpis = computeKpis(
      [deal({ stage: "won", created_at: "2026-07-01T00:00:00.000Z", close_date: "2026-07-31" })],
      ANCHOR,
    );
    expect(kpis.avgDaysToClose).toBe(30);
  });
});

describe("percentChange", () => {
  test("returns null against a zero baseline instead of Infinity", () => {
    expect(percentChange(50, 0)).toBeNull();
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
  });
});

describe("buildMonthRange", () => {
  test("produces a contiguous timeline, not just the months that have data", () => {
    const months = buildMonthRange(ANCHOR, 11, 0);
    expect(months.length).toBe(12);
    expect(months[0].key).toBe("2025-09");
    expect(months[11].key).toBe("2026-08");
  });

  test("spans a year boundary without repeating or skipping a month", () => {
    const months = buildMonthRange(new Date("2026-01-15T00:00:00.000Z"), 3, 0);
    expect(months.map((m) => m.key)).toEqual(["2025-10", "2025-11", "2025-12", "2026-01"]);
  });
});

describe("wonDealsByMonth", () => {
  test("buckets by close date and keeps empty months as zeroes", () => {
    const series = wonDealsByMonth(
      [
        deal({ stage: "won", amount_usd: 1000, close_date: "2026-08-03" }),
        deal({ stage: "won", amount_usd: 500, close_date: "2026-08-20" }),
        deal({ stage: "won", amount_usd: 250, close_date: "2026-06-10" }),
      ],
      ANCHOR,
    );
    expect(series.length).toBe(12);
    const august = series.find((b) => b.key === "2026-08");
    expect(august?.value).toBe(1500);
    expect(august?.count).toBe(2);
    // The gap between June and August must stay visible as a real zero.
    expect(series.find((b) => b.key === "2026-07")?.value).toBe(0);
    expect(series.find((b) => b.key === "2026-06")?.count).toBe(1);
  });

  test("ignores deals that never closed won", () => {
    const series = wonDealsByMonth(
      [deal({ stage: "lost", close_date: "2026-08-03" }), deal({ stage: "demo" })],
      ANCHOR,
    );
    expect(series.every((bucket) => bucket.count === 0)).toBe(true);
  });
});

describe("projectedDealsByMonth", () => {
  test("weights by probability and prefers the possible close date", () => {
    const series = projectedDealsByMonth(
      [
        deal({
          stage: "demo",
          amount_usd: 4000,
          probability: 25,
          possible_close_date: "2026-09-10",
        }),
        deal({ stage: "proposal", amount_usd: 1000, probability: 100, close_date: "2026-09-20" }),
      ],
      ANCHOR,
    );
    const september = series.find((bucket) => bucket.key === "2026-09");
    // 4000*0.25 + 1000*1.0 — a projection at face value would say 5000.
    expect(september?.value).toBe(2000);
    expect(september?.count).toBe(2);
  });

  test("excludes closed deals — a projection is about what is still winnable", () => {
    const series = projectedDealsByMonth(
      [
        deal({ stage: "won", close_date: "2026-09-01" }),
        deal({ stage: "lost", close_date: "2026-09-01" }),
      ],
      ANCHOR,
    );
    expect(series.every((bucket) => bucket.count === 0)).toBe(true);
  });
});

describe("winRateByMonth", () => {
  test("a month with no decisions is null, not zero", () => {
    const series = winRateByMonth(
      [
        deal({ stage: "won", close_date: "2026-08-02" }),
        deal({ stage: "lost", close_date: "2026-08-09" }),
      ],
      ANCHOR,
    );
    expect(series.find((m) => m.key === "2026-08")?.winRate).toBe(50);
    expect(series.find((m) => m.key === "2026-07")?.winRate).toBeNull();
    expect(series.find((m) => m.key === "2026-07")?.decided).toBe(0);
  });
});

describe("stageMix", () => {
  test("returns stages in pipeline order and drops the empty ones", () => {
    const mix = stageMix([
      deal({ stage: "demo" }),
      deal({ stage: "demo" }),
      deal({ stage: "won", amount_usd: 900 }),
    ]);
    expect(mix.map((slice) => slice.key)).toEqual(["demo", "won"]);
    expect(mix[0].count).toBe(2);
    expect(mix[1].value).toBe(900);
  });
});

describe("lossReasonMix", () => {
  test("groups by category, largest first, and keeps uncategorised losses visible", () => {
    const mix = lossReasonMix([
      deal({ stage: "lost", loss_reason_category: "Price too high", amount_usd: 100 }),
      deal({ stage: "lost", loss_reason_category: "Price too high", amount_usd: 200 }),
      deal({ stage: "lost", loss_reason_category: "Chose a competitor" }),
      // Closed before categories existed — dropping it would make the
      // recorded reasons look like the complete picture.
      deal({ stage: "lost", loss_reason_category: null }),
      deal({ stage: "won" }),
    ]);
    expect(mix[0]).toMatchObject({ label: "Price too high", count: 2, value: 300 });
    expect(mix.map((s) => s.label)).toContain("Not recorded");
    expect(mix.reduce((sum, slice) => sum + slice.count, 0)).toBe(4);
  });
});

describe("newVsExistingBusiness", () => {
  test("a customer's first win is new business and later wins are existing", () => {
    const split = newVsExistingBusiness([
      deal({ stage: "won", customer_id: "c1", amount_usd: 1000, close_date: "2026-01-10" }),
      deal({ stage: "won", customer_id: "c1", amount_usd: 400, close_date: "2026-05-10" }),
      deal({ stage: "won", customer_id: "c2", amount_usd: 600, close_date: "2026-03-10" }),
    ]);
    expect(split.newBusiness).toBe(1600);
    expect(split.existing).toBe(400);
  });

  test("order of the input does not change the split", () => {
    const rows = [
      deal({ id: "b", stage: "won", customer_id: "c1", amount_usd: 400, close_date: "2026-05-10" }),
      deal({
        id: "a",
        stage: "won",
        customer_id: "c1",
        amount_usd: 1000,
        close_date: "2026-01-10",
      }),
    ];
    // Sorted by close date internally, so the January deal is the first win
    // regardless of which row the query happened to return first.
    expect(newVsExistingBusiness(rows)).toEqual({ newBusiness: 1000, existing: 400 });
  });

  test("a deal with no customer counts as new — it cannot be shown to repeat", () => {
    const split = newVsExistingBusiness([
      deal({ stage: "won", customer_id: null, amount_usd: 100 }),
      deal({ stage: "won", customer_id: null, amount_usd: 100 }),
    ]);
    expect(split).toEqual({ newBusiness: 200, existing: 0 });
  });
});

describe("avgDaysToClose exclusions", () => {
  // The seeded rows genuinely have close_date before created_at (one lost deal
  // by 20 days, one won by 2). Clamping each to zero would report a confident
  // "0 days to close"; including them raw reports "-1 days". Neither is true,
  // so they are excluded and counted.
  test("drops deals whose close date precedes creation, and says how many", () => {
    const kpis = computeKpis(
      [
        deal({ stage: "won", created_at: "2026-07-29T00:00:00.000Z", close_date: "2026-07-27" }),
        deal({ stage: "won", created_at: "2026-07-01T00:00:00.000Z", close_date: "2026-07-11" }),
      ],
      ANCHOR,
    );
    expect(kpis.avgDaysToClose).toBe(10);
    expect(kpis.daysToCloseExcluded).toBe(1);
  });

  test("all-negative durations report nothing rather than a fabricated zero", () => {
    const kpis = computeKpis(
      [deal({ stage: "won", created_at: "2026-07-29T00:00:00.000Z", close_date: "2026-07-09" })],
      ANCHOR,
    );
    expect(kpis.avgDaysToClose).toBeNull();
    expect(kpis.daysToCloseExcluded).toBe(1);
  });
});

describe("comparePeriods", () => {
  // Closed deals belong to the window their close date falls in; open deals
  // have no close date to be judged by, so they belong to the window they
  // were created in. Filtering everything by one column would either drop the
  // entire live pipeline from the current period or credit a year-old deal to
  // this month.
  const now = new Date("2026-08-15T00:00:00.000Z");
  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  test("splits closed deals by close date and open deals by creation date", () => {
    const { current, previous } = comparePeriods(
      [
        deal({ stage: "won", amount_usd: 1000, close_date: daysAgo(5) }),
        deal({ stage: "won", amount_usd: 400, close_date: daysAgo(45) }),
        deal({ stage: "demo", created_at: `${daysAgo(10)}T00:00:00.000Z` }),
        deal({ stage: "demo", created_at: `${daysAgo(50)}T00:00:00.000Z` }),
      ],
      now,
      30,
    );
    expect(current.totalSales).toBe(1000);
    expect(previous.totalSales).toBe(400);
    expect(current.openDeals).toBe(1);
    expect(previous.openDeals).toBe(1);
  });

  test("a deal older than both windows lands in neither", () => {
    const { current, previous } = comparePeriods(
      [deal({ stage: "won", amount_usd: 9999, close_date: daysAgo(200) })],
      now,
      30,
    );
    expect(current.totalSales).toBe(0);
    expect(previous.totalSales).toBe(0);
  });
});

describe("productMix and sourceMix", () => {
  test("product mix ranks won value and ignores open deals", () => {
    const mix = productMix([
      deal({ stage: "won", product: "Booking Platform", amount_usd: 500 }),
      deal({ stage: "won", product: "Booking Platform", amount_usd: 700 }),
      deal({ stage: "won", product: "Remote Monitoring", amount_usd: 900 }),
      deal({ stage: "demo", product: "Booking Platform", amount_usd: 10_000 }),
    ]);
    expect(mix[0]).toMatchObject({ label: "Booking Platform", count: 2, value: 1200 });
    expect(mix[1]).toMatchObject({ label: "Remote Monitoring", value: 900 });
  });

  test("source mix counts every deal, open or closed, since channel is about intake", () => {
    const mix = sourceMix([
      deal({ stage: "won", source: "Referral" }),
      deal({ stage: "demo", source: "Referral" }),
      deal({ stage: "lost", source: "Inbound" }),
    ]);
    expect(mix[0]).toMatchObject({ label: "Referral", count: 2 });
    expect(mix[1]).toMatchObject({ label: "Inbound", count: 1 });
  });
});

// ---------------------------------------------------------------------------
// Chart drill-down: the detail view must never disagree with the bar
// ---------------------------------------------------------------------------

function wonDeal(overrides: Partial<DealRecord> & { id: string }): DealRecord {
  return deal({ stage: "won", ...overrides });
}

test("a slice's deals sum to exactly the slice's value, for both dimensions", () => {
  const deals = [
    wonDeal({ id: "1", product: "Cloud Suite", owner_name: "Sneha Iyer", amount_usd: 100 }),
    wonDeal({ id: "2", product: "Cloud Suite", owner_name: "Asha Mehta", amount_usd: 250 }),
    wonDeal({ id: "3", product: "Commerce Suite", owner_name: "Sneha Iyer", amount_usd: 40 }),
    // Not won — must be excluded from both the bar and the drill-down.
    wonDeal({
      id: "4",
      product: "Cloud Suite",
      owner_name: "Sneha Iyer",
      amount_usd: 9999,
      stage: "lost",
    }),
  ];

  for (const dimension of ["product", "owner"] as const) {
    for (const slice of dimension === "product" ? productMix(deals) : ownerMix(deals)) {
      const members = wonDealsInSlice(deals, dimension, slice.key);
      const summed = members.reduce((total, deal) => total + dealUsd(deal), 0);
      expect(summed).toBe(slice.value);
      expect(members).toHaveLength(slice.count);
      expect(members.every((deal) => deal.stage === "won")).toBe(true);
    }
  }
});

test("blank and whitespace labels fall into the same bucket the bar used", () => {
  const deals = [
    wonDeal({ id: "1", product: "   ", owner_name: "", amount_usd: 10 }),
    wonDeal({ id: "2", product: "", owner_name: "   ", amount_usd: 20 }),
  ];
  // One "Unspecified" product bar and one "Unassigned" owner bar, each holding
  // both deals — and the drill-down finds both by that same label.
  const products = productMix(deals);
  expect(products).toHaveLength(1);
  expect(products[0]?.label).toBe("Unspecified");
  expect(wonDealsInSlice(deals, "product", "Unspecified")).toHaveLength(2);

  const owners = ownerMix(deals);
  expect(owners).toHaveLength(1);
  expect(owners[0]?.label).toBe("Unassigned");
  expect(wonDealsInSlice(deals, "owner", "Unassigned")).toHaveLength(2);
});

test("a slice's deals come back highest value first", () => {
  const deals = [
    wonDeal({ id: "small", product: "P", owner_name: "O", amount_usd: 5 }),
    wonDeal({ id: "big", product: "P", owner_name: "O", amount_usd: 500 }),
    wonDeal({ id: "mid", product: "P", owner_name: "O", amount_usd: 50 }),
  ];
  expect(wonDealsInSlice(deals, "product", "P").map((d) => d.id)).toEqual(["big", "mid", "small"]);
});

test("an unknown slice key yields nothing rather than everything", () => {
  const deals = [wonDeal({ id: "1", product: "P", owner_name: "O", amount_usd: 5 })];
  expect(wonDealsInSlice(deals, "product", "Nope")).toEqual([]);
});

test("shares sum to 100 and are null when nothing has closed", () => {
  const shares = sliceShares([
    { key: "a", label: "a", value: 750, count: 1 },
    { key: "b", label: "b", value: 250, count: 1 },
  ]);
  expect(shares.map((s) => s.share)).toEqual([75, 25]);

  // Zero total: null, not 0%. A table of 0% against nothing reads as measured.
  const empty = sliceShares([{ key: "a", label: "a", value: 0, count: 0 }]);
  expect(empty[0]?.share).toBeNull();
  expect(sliceShares([])).toEqual([]);
});
