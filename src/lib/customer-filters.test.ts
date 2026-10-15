import { describe, expect, test } from "bun:test";

import { filterCustomersByView, type CustomerFilterRecord } from "./customer-filters";

const customers: CustomerFilterRecord[] = [
  {
    id: "acme",
    company_name: "Acme Corporation",
    account_owner: "Asha",
    status: "active",
    country: "India",
    region: "India West",
    segment: "Enterprise",
    renewal_date: "LIVEYfy",
    health_score: 85,
    mrr: "11-25",
  },
  {
    id: "beta",
    company_name: "Beta Labs",
    account_owner: "Ben",
    status: "paused",
    country: "Singapore",
    region: "Singapore",
    segment: "Mid-market",
    renewal_date: "RC",
    health_score: 45,
    mrr: "26-50",
  },
];

describe("filterCustomersByView", () => {
  test("matches company or owner text and exact advanced options", () => {
    expect(
      filterCustomersByView(customers, {
        text: "asha",
        status: "active",
        country: "India",
        region: "India West",
        segment: "Enterprise",
        renewalType: "LIVEYfy",
      }).map((customer) => customer.id),
    ).toEqual(["acme"]);
  });

  test("applies inclusive credibility and employee-count ranges", () => {
    expect(
      filterCustomersByView(customers, {
        credibilityMin: 85,
        credibilityMax: 85,
        employeeCountMin: 20,
        employeeCountMax: 20,
      }).map((customer) => customer.id),
    ).toEqual(["acme"]);
  });

  test("keeps all accessible records when no advanced filter is active", () => {
    expect(filterCustomersByView(customers, {})).toEqual(customers);
  });
});
