import { expect, test } from "bun:test";

import {
  assertSuperAdminCaller,
  resolveDropdownCustomerOwner,
  resolveDropdownScope,
} from "@/server/dropdown-sources.server";

function auth(overrides: {
  userId?: string;
  partnerId?: string | null;
  isSuperAdmin?: boolean;
  isDistributor?: boolean;
}) {
  return {
    userId: overrides.userId ?? "user-a",
    partnerId: overrides.partnerId ?? null,
    isSuperAdmin: overrides.isSuperAdmin ?? false,
    isDistributor: overrides.isDistributor ?? false,
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

// §2.4/§8.7a/§8.8: "Distributor cannot discover an untagged Customer" — the
// "client" dropdown source runs its own raw SQL (used by the manual
// account/customer pickers, the Assistant, and the WhatsApp wizard) rather
// than going through table-policy.server.ts's applyTablePolicy, so it needs
// its own tag-only narrowing for a Distributor caller, verified here at the
// SQL-text level the way the rest of this module's tests already do.
test("listDropdownSourceValues adds a customer_participants tag filter to the 'client' source for a Distributor caller, not for a Partner Admin", async () => {
  const { pool } = await import("@/server/postgres.server");
  const { listDropdownSourceValues } = await import("@/server/dropdown-sources.server");
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const originalQuery = pool.query.bind(pool);
  pool.query = (async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params: params ?? [] });
    return { rows: [], rowCount: 0 };
  }) as typeof pool.query;

  try {
    await listDropdownSourceValues({
      source: "client",
      callerAuth: auth({ partnerId: "partner-1", isDistributor: true, userId: "dist-1" }),
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toContain("customer_participants");
    expect(queries[0]?.sql).toContain("valid_to IS NULL");
    expect(queries[0]?.params).toContain("dist-1");

    queries.length = 0;
    await listDropdownSourceValues({
      source: "client",
      callerAuth: auth({ partnerId: "partner-1", isDistributor: false, userId: "admin-1" }),
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).not.toContain("customer_participants");
  } finally {
    pool.query = originalQuery;
  }
});
