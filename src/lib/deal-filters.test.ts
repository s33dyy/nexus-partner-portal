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
    loss_reason_category: null,
    loss_reason_detail: null,
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

test("filterDealsByView supports advanced KAM, PAM, Partner Admin, and Partner User owner filters", () => {
  const deals = [
    buildDeal({ id: "kam", owner_role: "kam" }),
    buildDeal({ id: "pam", owner_role: "pam" }),
    buildDeal({ id: "admin", owner_role: "partner_admin" }),
    buildDeal({ id: "user", owner_role: "partner_user" }),
  ];

  expect(
    filterDealsByView(deals, {
      query: "",
      stage: "all",
      status: "all",
      ownerRole: "pam",
    }).map((deal) => deal.id),
  ).toEqual(["pam"]);
});

test("filterDealsByView searches the canonical company name when a deal provides one", () => {
  const deals = [
    buildDeal({ id: "company", account_name: "Legacy Account", company_name: "Northwind Ltd" }),
  ];

  expect(
    filterDealsByView(deals, {
      query: "northwind",
      stage: "all",
      status: "all",
    }).map((deal) => deal.id),
  ).toEqual(["company"]);
});

test("filterDealsByView applies advanced deal filters with inclusive ranges", () => {
  const deals = [
    buildDeal({
      id: "match",
      country: "India",
      region: "India West",
      product: "LIVEY WC350 QHD Webcam",
      currency_code: "INR",
      amount_value: 1000,
      probability: 50,
      close_date: "2026-10-15",
    }),
    buildDeal({
      id: "wrong-country",
      country: "Germany",
      currency_code: "EUR",
      amount_value: 1000,
      probability: 50,
      close_date: "2026-10-15",
    }),
    buildDeal({
      id: "outside-range",
      amount_value: 1001,
      probability: 49,
      close_date: "2026-10-16",
    }),
  ];

  expect(
    filterDealsByView(deals, {
      query: "",
      stage: "all",
      status: "all",
      advanced: {
        country: "India",
        region: "India West",
        product: "LIVEY WC350 QHD Webcam",
        currency: "INR",
        amountMin: "1000",
        amountMax: "1000",
        probabilityMin: "50",
        probabilityMax: "50",
        closeDateFrom: "2026-10-15",
        closeDateTo: "2026-10-15",
      },
    }).map((deal) => deal.id),
  ).toEqual(["match"]);
});
