import { expect, test } from "bun:test";

import { GOVERNED_REFERENCE_BUCKETS } from "@/domain/contracts/reference-data";
import { ROLE_KEYS } from "@/domain/contracts/taxonomy";
import { SALES_REGIONS, WORLD_COUNTRIES } from "@/domain/contracts/world-geography";

// LookupCombobox submits an option's `value` (not its `valueKey`) as the
// field's stored value. "users.role" feeds user_roles.role, a Postgres enum
// restricted to super_admin/partner_admin/partner_user, and
// identity.change_user_role validates against those exact strings.
// "team.portal_role" feeds partner.team.tsx's exact `=== "partner_admin"`
// checks. Both must stay machine keys (snake_case), not humanized labels —
// a prior regression seeded these as "partner admin" (with a space),
// which made every role assignment/edit through those flows silently fail.
test("users.role and team.portal_role reference data use exact role keys, not humanized labels", () => {
  for (const fieldName of ["users.role", "team.portal_role"]) {
    const bucket = GOVERNED_REFERENCE_BUCKETS.find((entry) => entry.fieldName === fieldName);
    expect(bucket).toBeDefined();
    const values = bucket!.items.map((item) => item.value);
    expect(values.sort()).toEqual([...ROLE_KEYS].sort());
    for (const value of values) {
      expect(value.includes(" ")).toBe(false);
    }
  }
});

test("governance.country_code covers every world country and stays in sync with world-geography.ts", () => {
  const bucket = GOVERNED_REFERENCE_BUCKETS.find(
    (entry) => entry.fieldName === "governance.country_code",
  );
  expect(bucket).toBeDefined();
  expect(bucket!.items).toHaveLength(WORLD_COUNTRIES.length);
  const byKey = new Map(bucket!.items.map((item) => [item.valueKey, item]));
  for (const country of WORLD_COUNTRIES) {
    const item = byKey.get(country.code);
    expect(item?.value).toBe(country.name);
    expect(item?.metadata).toEqual({
      region: country.regionKey,
      currencyCode: country.currencyCode,
    });
  }
});

test("geography.country_currency maps every country to its reference currency", () => {
  const bucket = GOVERNED_REFERENCE_BUCKETS.find(
    (entry) => entry.fieldName === "geography.country_currency",
  );
  expect(bucket).toBeDefined();
  expect(bucket!.items).toHaveLength(WORLD_COUNTRIES.length);
  for (const country of WORLD_COUNTRIES) {
    const item = bucket!.items.find((entry) => entry.valueKey === country.code);
    expect(item?.value).toBe(country.currencyCode);
  }
});

test("governance.sales_region partitions every world country exactly once", () => {
  const bucket = GOVERNED_REFERENCE_BUCKETS.find(
    (entry) => entry.fieldName === "governance.sales_region",
  );
  expect(bucket).toBeDefined();
  expect(bucket!.items).toHaveLength(SALES_REGIONS.length);

  const seen = new Set<string>();
  for (const item of bucket!.items) {
    const countries = (item.metadata as { countries: readonly string[] }).countries;
    for (const code of countries) {
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
  }
  expect(seen.size).toBe(WORLD_COUNTRIES.length);
});
