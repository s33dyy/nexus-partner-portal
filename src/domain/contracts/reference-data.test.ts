import { expect, test } from "bun:test";

import { GOVERNED_REFERENCE_BUCKETS } from "@/domain/contracts/reference-data";
import { ROLE_KEYS } from "@/domain/contracts/taxonomy";

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
