import { expect, test } from "bun:test";

import { filterDealsByView, type DealListFilters } from "@/lib/deal-filters";
import type { DealRecord } from "@/lib/portal-records";

function buildDeal(overrides: Partial<DealRecord>): DealRecord {
  return {
    id: "deal-1",
    account_name: "Acme Systems",
    customer_id: null,
    contact_name: "Morgan Lee",
    poc_profile_id: null,
    owner_name: "Priya Rao",
    country: "India",
    region: "India West",
    product: "LIVEY WC350 QHD Webcam",
    stage: "sourced",
    status: "submitted",
    quantity: 1,
    amount: "$5,000",
    currency_code: "USD",
    amount_value: 5000,
    amount_usd: 5000,
    fx_rate: 1,
    fx_provider: "internal",
    fx_rate_fetched_at: "2026-07-27T00:00:00.000Z",
    customer_budget: null,
    probability: 50,
    possible_close_date: "2026-08-01",
    proposed_completion_date: null,
    close_date: "2026-08-01",
    source: "Partner referral",
    last_touch: "New",
    notes: "",
    user_id: null,
    partner_id: null,
    is_hidden_to_team: false,
    reward_rate_percent: 5,
    version: 1,
    is_seed: false,
    commercial_approved: false,
    created_at: "2026-07-27T00:00:00.000Z",
    updated_at: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

test("filterDealsByView applies stage, status, and free-text filters together", () => {
  const deals = [
    buildDeal({ id: "open-1", account_name: "Acme Systems", stage: "demo", status: "approved" }),
    buildDeal({ id: "won-1", account_name: "Bravo Labs", stage: "won", status: "won" }),
    buildDeal({ id: "lost-1", account_name: "Cinder Tech", stage: "lost", status: "lost" }),
  ];

  const filters: DealListFilters = {
    query: "acme",
    stage: "demo",
    status: "open",
  };

  expect(filterDealsByView(deals, filters).map((deal) => deal.id)).toEqual(["open-1"]);
});

test("filterDealsByView treats the open status as any deal not yet won or lost", () => {
  const deals = [
    buildDeal({ id: "open-1", stage: "proposal", status: "approved" }),
    buildDeal({ id: "won-1", stage: "won", status: "won" }),
    buildDeal({ id: "lost-1", stage: "lost", status: "lost" }),
  ];

  expect(
    filterDealsByView(deals, {
      query: "",
      stage: "all",
      status: "open",
    }).map((deal) => deal.id),
  ).toEqual(["open-1"]);
});
