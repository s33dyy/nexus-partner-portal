import { expect, test } from "bun:test";

import { supabase } from "@/integrations/local/client";
import {
  EXPORT_DATASETS,
  listVisibleExportDatasets,
  resolveScopeFilters,
} from "@/lib/export-registry";

type MockResult = { data: unknown; error: null };

type MockQuery = PromiseLike<MockResult> & {
  select(): MockQuery;
  count(): MockQuery;
  eq(column: string, value: unknown): MockQuery;
  maybeSingle(): Promise<MockResult>;
};

type MockFrom = (table: string) => MockQuery;

test("listVisibleExportDatasets hides admin-only exports from partner users", () => {
  const visible = listVisibleExportDatasets("partner_user").map((dataset) => dataset.id);

  expect(visible).not.toContain("portal-audit-events");
  expect(visible).not.toContain("admin-users");
  expect(visible).toContain("portal-deals");
});

test("listVisibleExportDatasets keeps team exports available to partner admins", () => {
  const visible = listVisibleExportDatasets("partner_admin").map((dataset) => dataset.id);

  expect(visible).toContain("portal-team-members");
  expect(visible).not.toContain("profiles");
});

test("no governance or configuration dataset is visible to a partner-facing role (product.md §16.4)", () => {
  for (const role of ["partner_admin", "partner_user"] as const) {
    const visibleGroups = new Set(listVisibleExportDatasets(role).map((dataset) => dataset.group));
    expect(visibleGroups.has("governance")).toBe(false);
    expect(visibleGroups.has("configuration")).toBe(false);
  }
});

test("team members export is categorised as operational, not governance", () => {
  const dataset = EXPORT_DATASETS.find((entry) => entry.id === "portal-team-members");
  expect(dataset?.group).toBe("operational");
});

test("product catalog export uses the new surface label", () => {
  const dataset = EXPORT_DATASETS.find((entry) => entry.id === "portal-catalog-items");

  expect(dataset?.label).toBe("Product Catalog");
  expect(dataset?.description).toContain("product and combo");
});

test("resolveScopeFilters keeps partner users scoped to their own records", () => {
  expect(
    resolveScopeFilters(
      {
        role: "partner_user",
        isSuperAdmin: false,
        partnerId: "partner-123",
        userId: "user-456",
        companyName: "Techilla",
      },
      "partner-or-user",
    ),
  ).toEqual([{ column: "user_id", value: "user-456" }]);
});

test("resolveScopeFilters keeps partner admins scoped to their partner records", () => {
  expect(
    resolveScopeFilters(
      {
        role: "partner_admin",
        isSuperAdmin: false,
        partnerId: "partner-123",
        userId: "user-456",
        companyName: "Techilla",
      },
      "partner-or-user",
    ),
  ).toEqual([{ column: "partner_id", value: "partner-123" }]);
});

test("resolveScopeFilters fails closed when a required scope value is missing", () => {
  expect(() =>
    resolveScopeFilters(
      {
        role: "partner_user",
        isSuperAdmin: false,
        partnerId: "partner-123",
        userId: null,
        companyName: "Techilla",
      },
      "partner-or-user",
    ),
  ).toThrow("Cannot export partner-user data without user scope.");

  expect(() =>
    resolveScopeFilters(
      {
        role: "partner_admin",
        isSuperAdmin: false,
        partnerId: null,
        userId: "user-456",
        companyName: "Techilla",
      },
      "partner",
    ),
  ).toThrow("Cannot export without partner scope.");
});

test("resolveScopeFilters scopes team exports by company name", () => {
  expect(
    resolveScopeFilters(
      {
        role: "partner_admin",
        isSuperAdmin: false,
        partnerId: "partner-123",
        userId: "user-456",
        companyName: "Techilla",
      },
      "company",
    ),
  ).toEqual([{ column: "company_name", value: "Techilla" }]);

  expect(() =>
    resolveScopeFilters(
      {
        role: "partner_admin",
        isSuperAdmin: false,
        partnerId: "partner-123",
        userId: "user-456",
        companyName: null,
      },
      "company",
    ),
  ).toThrow("Cannot export without company scope.");
});

test("portal deals exports hide hidden deals from partner users", async () => {
  const client = supabase as unknown as { from: MockFrom };
  const originalFrom: MockFrom = client.from;
  const calls: Array<{
    table: string;
    filters: Array<{ column: string; value: unknown }>;
    operation: string;
  }> = [];

  client.from = ((table: string) => {
    const state = {
      table,
      filters: [] as Array<{ column: string; value: unknown }>,
      operation: "select",
    };
    calls.push(state);

    const query: MockQuery = {
      select() {
        state.operation = "select";
        return query;
      },
      count() {
        state.operation = "count";
        return query;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ column, value });
        return query;
      },
      maybeSingle() {
        return Promise.resolve({ data: null, error: null });
      },
      then<TResult1 = MockResult, TResult2 = never>(
        onfulfilled?: ((value: MockResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        if (table === "portal_deals") {
          return Promise.resolve({
            data: [
              {
                id: "deal-visible",
                account_name: "Visible",
                contact_name: "Visible Client",
                product: "Camera",
                stage: "won",
                status: "won",
                quantity: 1,
                amount: "1000",
                customer_budget: null,
                country: "India",
                region: "West",
                is_hidden_to_team: false,
                reward_rate_percent: 5,
                possible_close_date: null,
                close_date: "2026-07-26",
                created_at: "2026-07-26T00:00:00Z",
                updated_at: "2026-07-26T00:00:00Z",
                partner_id: "partner-123",
                user_id: "user-456",
              },
              {
                id: "deal-hidden",
                account_name: "Hidden",
                contact_name: "Hidden Client",
                product: "Mic",
                stage: "won",
                status: "won",
                quantity: 1,
                amount: "1000",
                customer_budget: null,
                country: "India",
                region: "West",
                is_hidden_to_team: true,
                reward_rate_percent: 5,
                possible_close_date: null,
                close_date: "2026-07-26",
                created_at: "2026-07-26T00:00:00Z",
                updated_at: "2026-07-26T00:00:00Z",
                partner_id: "partner-123",
                user_id: "user-999",
              },
            ],
            error: null,
          }).then(onfulfilled, onrejected);
        }

        if (table === "portal_deal_collaborators") {
          return Promise.resolve({
            data: [
              { deal_id: "deal-hidden", user_id: "user-456" },
              { deal_id: "deal-visible", user_id: "user-456" },
            ],
            error: null,
          }).then(onfulfilled, onrejected);
        }

        return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
      },
    };

    return query;
  }) as MockFrom;

  try {
    const dataset = EXPORT_DATASETS.find((entry) => entry.id === "portal-deals");
    expect(dataset).toBeDefined();

    const rows = await dataset!.loadRows({
      role: "partner_user",
      isSuperAdmin: false,
      partnerId: "partner-123",
      userId: "user-456",
      companyName: "Techilla",
    });

    expect(rows.map((row) => row.id)).toEqual(["deal-visible", "deal-hidden"]);

    const count = await dataset!.loadCount({
      role: "partner_user",
      isSuperAdmin: false,
      partnerId: "partner-123",
      userId: "user-456",
      companyName: "Techilla",
    });

    expect(count).toBe(2);
    expect(calls).toEqual([
      {
        table: "portal_deals",
        filters: [{ column: "partner_id", value: "partner-123" }],
        operation: "select",
      },
      {
        table: "portal_deal_collaborators",
        filters: [],
        operation: "select",
      },
      {
        table: "portal_deals",
        filters: [{ column: "partner_id", value: "partner-123" }],
        operation: "select",
      },
      {
        table: "portal_deal_collaborators",
        filters: [],
        operation: "select",
      },
    ]);
  } finally {
    client.from = originalFrom;
  }
});

test("customer exports stay partner-scoped for partner users", async () => {
  const client = supabase as unknown as { from: MockFrom };
  const originalFrom: MockFrom = client.from;
  const calls: Array<{
    table: string;
    filters: Array<{ column: string; value: unknown }>;
    operation: string;
  }> = [];

  client.from = ((table: string) => {
    const state = {
      table,
      filters: [] as Array<{ column: string; value: unknown }>,
      operation: "select",
    };
    calls.push(state);

    const query: MockQuery = {
      select() {
        state.operation = "select";
        return query;
      },
      count() {
        state.operation = "count";
        return query;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ column, value });
        return query;
      },
      maybeSingle() {
        return Promise.resolve({ data: null, error: null });
      },
      then<TResult1 = MockResult, TResult2 = never>(
        onfulfilled?: ((value: MockResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        return Promise.resolve({ data: [], error: null }).then(onfulfilled, onrejected);
      },
    };

    return query;
  }) as MockFrom;

  try {
    const dataset = EXPORT_DATASETS.find((entry) => entry.id === "portal-customers");
    expect(dataset).toBeDefined();

    await dataset!.loadRows({
      role: "partner_user",
      isSuperAdmin: false,
      partnerId: "partner-123",
      userId: "user-456",
      companyName: "Techilla",
    });

    expect(calls).toContainEqual({
      table: "portal_customers",
      operation: "select",
      filters: [{ column: "partner_id", value: "partner-123" }],
    });
  } finally {
    client.from = originalFrom;
  }
});
