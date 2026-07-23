import { expect, test } from "bun:test";

import { listVisibleExportDatasets, resolveScopeFilters } from "@/lib/export-registry";

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
