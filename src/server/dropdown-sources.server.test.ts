import { expect, test } from "bun:test";

import {
  assertSuperAdminCaller,
  resolveDropdownCustomerOwner,
  resolveDropdownScope,
} from "@/server/dropdown-sources.server";

function auth(overrides: { userId?: string; partnerId?: string | null; isSuperAdmin?: boolean }) {
  return {
    userId: overrides.userId ?? "user-a",
    partnerId: overrides.partnerId ?? null,
    isSuperAdmin: overrides.isSuperAdmin ?? false,
  };
}

test("resolveDropdownScope forces a partner-side caller to their own partnerId regardless of client input", () => {
  const result = resolveDropdownScope(auth({ partnerId: "partner-1" }), {
    partnerId: "someone-elses-partner",
    userId: "someone-elses-user",
  });
  expect(result).toEqual({ scopedPartnerId: "partner-1", scopedUserId: null });
});

test("resolveDropdownScope forces a partner-side caller's own partnerId even when the client omits it entirely", () => {
  const result = resolveDropdownScope(auth({ partnerId: "partner-1" }), {});
  expect(result).toEqual({ scopedPartnerId: "partner-1", scopedUserId: null });
});

test("resolveDropdownScope falls back to the caller's own userId for a partner-less (LIVEY-internal) caller", () => {
  const result = resolveDropdownScope(auth({ partnerId: null, userId: "user-a" }), {
    partnerId: "any-partner",
    userId: "someone-elses-user",
  });
  expect(result).toEqual({ scopedPartnerId: null, scopedUserId: "user-a" });
});

test("resolveDropdownScope lets super_admin pass through any partnerId/userId, including none", () => {
  expect(
    resolveDropdownScope(auth({ isSuperAdmin: true }), {
      partnerId: "any-partner",
      userId: "any-user",
    }),
  ).toEqual({ scopedPartnerId: "any-partner", scopedUserId: "any-user" });

  expect(resolveDropdownScope(auth({ isSuperAdmin: true }), {})).toEqual({
    scopedPartnerId: null,
    scopedUserId: null,
  });
});

test("resolveDropdownCustomerOwner forces a non-super_admin caller's own identity onto a new customer", () => {
  const result = resolveDropdownCustomerOwner(auth({ partnerId: "partner-1", userId: "user-a" }), {
    partner_id: "someone-elses-partner",
    user_id: "someone-elses-user",
  });
  expect(result).toEqual({ ownerPartnerId: "partner-1", ownerUserId: "user-a" });
});

test("resolveDropdownCustomerOwner lets super_admin create a customer under any partner/user", () => {
  const result = resolveDropdownCustomerOwner(auth({ isSuperAdmin: true }), {
    partner_id: "any-partner",
    user_id: "any-user",
  });
  expect(result).toEqual({ ownerPartnerId: "any-partner", ownerUserId: "any-user" });
});

test("assertSuperAdminCaller denies a non-super_admin and allows a super_admin", () => {
  expect(() => assertSuperAdminCaller(auth({ isSuperAdmin: false }))).toThrow("Access denied");
  expect(() => assertSuperAdminCaller(auth({ isSuperAdmin: true }))).not.toThrow();
});
