import { expect, test } from "bun:test";

import { supabase } from "@/integrations/local/client";
import { EXPORT_DATASETS, listVisibleExportDatasets, resolveScopeFilters } from "@/lib/export-registry";

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

test("dataset loadCount uses the dedicated count path", async () => {
  const client = supabase as typeof supabase & { from: any };
  const originalFrom = client.from;
  const calls: Array<{
    table: string;
    filters: Array<{ column: string; value: unknown }>;
  }> = [];

  client.from = ((table: string) => {
    const state = { table, filters: [] as Array<{ column: string; value: unknown }> };
    calls.push(state);

    const query: any = {
      count() {
        return query;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ column, value });
        return query;
      },
      then(onfulfilled: (value: { data: unknown; error: null }) => unknown, onrejected: (reason: unknown) => unknown) {
        return Promise.resolve({ data: "7", error: null }).then(onfulfilled, onrejected);
      },
    };

    return query;
  }) as any;

  try {
    const dataset = EXPORT_DATASETS.find((entry) => entry.id === "portal-deals");
    expect(dataset).toBeDefined();

    const count = await dataset!.loadCount({
      role: "partner_admin",
      isSuperAdmin: false,
      partnerId: "partner-123",
      userId: "user-456",
      companyName: "Techilla",
    });

    expect(count).toBe(7);
    expect(calls).toEqual([
      {
        table: "portal_deals",
        filters: [{ column: "partner_id", value: "partner-123" }],
      },
    ]);
  } finally {
    client.from = originalFrom;
  }
});
