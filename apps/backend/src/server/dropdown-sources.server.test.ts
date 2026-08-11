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

// 9f/18c: the "Add line item" UI's product/price source. Prefers the
// governed product_skus/product_variants/products tables when they have any
// active rows, falling back to the legacy free-text portal_catalog_items
// duplicate when they don't.
test("listLineItemCatalogOptions prefers governed product_skus data when it has active rows", async () => {
  const { pool } = await import("@/server/postgres.server");
  const { listLineItemCatalogOptions } = await import("@/server/dropdown-sources.server");
  const originalQuery = pool.query.bind(pool);
  const queries: string[] = [];
  pool.query = (async (sql: string) => {
    const s = sql.trim();
    queries.push(s);
    if (s.startsWith("SELECT 1 FROM product_skus")) {
      return { rows: [{ "?column?": 1 }], rowCount: 1 };
    }
    if (s.includes("FROM product_skus ps")) {
      return {
        rows: [
          {
            id: "sku-1",
            sku_code: "WIDGET-PRO",
            msrp_amount: "199.0000",
            partner_transfer_amount: "179.0000",
            discounted_transfer_amount: "159.0000",
            product_name: "Widget",
            variant_name: "Pro",
          },
        ],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected query in governed-preferred test: ${s}`);
  }) as typeof pool.query;

  try {
    const options = await listLineItemCatalogOptions({});
    expect(options).toHaveLength(1);
    expect(options[0]).toEqual({
      id: "sku-1",
      label: "Widget — Pro",
      sku: "WIDGET-PRO",
      msrpUsd: 199,
      ptpUsd: 179,
      dtpUsd: 159,
      source: "governed",
    });
    // Never falls back to the legacy table once governed data exists.
    expect(queries.some((q) => q.includes("portal_catalog_items"))).toBe(false);
  } finally {
    pool.query = originalQuery;
  }
});

test("listLineItemCatalogOptions falls back to portal_catalog_items when the governed tables have no active rows", async () => {
  const { pool } = await import("@/server/postgres.server");
  const { listLineItemCatalogOptions } = await import("@/server/dropdown-sources.server");
  const originalQuery = pool.query.bind(pool);
  pool.query = (async (sql: string) => {
    const s = sql.trim();
    if (s.startsWith("SELECT 1 FROM product_skus")) {
      return { rows: [], rowCount: 0 };
    }
    if (s.includes("information_schema.columns")) {
      return { rows: [{ column_name: "list_price" }, { column_name: "sku" }], rowCount: 2 };
    }
    if (s.includes("FROM portal_catalog_items")) {
      return {
        rows: [
          { id: "cat-1", sku: "LEGACY-1", product_name: "Legacy Widget", list_price: "$99.50" },
        ],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected query in fallback test: ${s}`);
  }) as typeof pool.query;

  try {
    const options = await listLineItemCatalogOptions({});
    expect(options).toHaveLength(1);
    expect(options[0]).toEqual({
      id: "cat-1",
      label: "Legacy Widget",
      sku: "LEGACY-1",
      msrpUsd: 99.5,
      ptpUsd: null,
      dtpUsd: null,
      source: "catalog",
    });
  } finally {
    pool.query = originalQuery;
  }
});
