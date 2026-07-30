import { expect, test } from "bun:test";

test("generic table policy allows bootstrap-safe lookup reads and scopes partner reads", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  const lookupQuery = await applyTablePolicy(
    { table: "lookup_values", operation: "select", filters: [] },
    {
      userId: null,
      roles: [],
      partnerId: null,
      companyName: null,
      hasGovernedContext: false,
    },
  );
  expect(lookupQuery.table).toBe("lookup_values");
  expect(lookupQuery.filters).toEqual([]);

  const partnerQuery = await applyTablePolicy(
    { table: "portal_deals", operation: "select", filters: [] },
    {
      userId: "user-a",
      roles: ["partner_admin"],
      partnerId: "partner-a",
      companyName: "Acme Labs",
      hasGovernedContext: true,
      governedRoleKey: "partner_admin",
    },
  );
  expect(partnerQuery.filters).toEqual([
    { column: "partner_id", value: "partner-a", operator: "eq" },
  ]);
});

test("generic table policy denies anonymous business reads", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  await expect(
    applyTablePolicy(
      { table: "portal_deals", operation: "select", filters: [] },
      {
        userId: null,
        roles: [],
        partnerId: null,
        companyName: null,
        hasGovernedContext: false,
      },
    ),
  ).rejects.toThrow("Access denied");
});

test("queryTableWithAuthContext scopes partner reads and denies anonymous access", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";

  const { queryTableWithAuthContext } = await import("@/server/livey-service.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  const observed: Array<{ sql: string; params: unknown[] }> = [];

  pool.query = (async (sql: string, params: unknown[] = []) => {
    observed.push({ sql: String(sql), params });
    if (String(sql).includes('FROM "portal_deals"')) {
      return {
        rows: [
          {
            id: "deal-1",
            partner_id: "partner-a",
            account_name: "Acme Foods",
          },
        ],
        rowCount: 1,
      } as never;
    }
    if (String(sql).includes("FROM role_permissions")) {
      return {
        rows: [
          {
            feature_key: "deals",
            can_create: true,
            can_read: true,
            can_update: true,
            can_delete: false,
          },
        ],
        rowCount: 1,
      } as never;
    }

    return { rows: [], rowCount: 0 } as never;
  }) as typeof pool.query;

  try {
    const allowed = await queryTableWithAuthContext(
      { table: "portal_deals", operation: "select" },
      {
        userId: "user-a",
        roles: ["partner_admin"],
        partnerId: "partner-a",
        companyName: "Acme Labs",
        hasGovernedContext: true,
        governedRoleKey: "partner_admin",
      },
    );

    expect(allowed.error).toBeNull();
    expect(Array.isArray(allowed.data)).toBe(true);
    expect(allowed.data).toEqual([
      {
        id: "deal-1",
        partner_id: "partner-a",
        account_name: "Acme Foods",
      },
    ]);
    const dealsQueryLog = observed.find((entry) => entry.sql.includes('FROM "portal_deals"'));
    expect(dealsQueryLog?.sql).toContain('FROM "portal_deals" WHERE "partner_id" = $1');
    expect(dealsQueryLog?.params).toEqual(["partner-a"]);

    const denied = await queryTableWithAuthContext(
      { table: "portal_deals", operation: "select" },
      {
        userId: null,
        roles: [],
        partnerId: null,
        companyName: null,
        hasGovernedContext: false,
      },
    );

    expect(denied.error?.message).toBe("Access denied");
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

const SUPER_ADMIN_AUTH = {
  userId: "super-admin-user",
  roles: ["super_admin"],
  partnerId: null,
  companyName: null,
  hasGovernedContext: true,
};

test("super admin reads are not scoped to their own row on self-service tables", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  const profilesQuery = await applyTablePolicy(
    { table: "profiles", operation: "select", filters: [] },
    SUPER_ADMIN_AUTH,
  );
  expect(profilesQuery.filters).toEqual([]);

  const partnersQuery = await applyTablePolicy(
    { table: "partners", operation: "select", filters: [] },
    SUPER_ADMIN_AUTH,
  );
  expect(partnersQuery.filters).toEqual([]);
});

test("super admin can update another user's profile and partner without a scope conflict", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  const profileUpdate = await applyTablePolicy(
    {
      table: "profiles",
      operation: "update",
      filters: [{ column: "id", value: "some-other-user", operator: "eq" }],
      values: { partner_status: "approved" },
    },
    SUPER_ADMIN_AUTH,
  );
  expect(profileUpdate.filters).toEqual([
    { column: "id", value: "some-other-user", operator: "eq" },
  ]);

  const partnerUpdate = await applyTablePolicy(
    {
      table: "partners",
      operation: "update",
      filters: [{ column: "id", value: "some-other-partner", operator: "eq" }],
      values: { status: "approved" },
    },
    SUPER_ADMIN_AUTH,
  );
  expect(partnerUpdate.filters).toEqual([
    { column: "id", value: "some-other-partner", operator: "eq" },
  ]);
});

test("super admin reads are not scoped to their own row on bootstrap read-only tables", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  const rolesQuery = await applyTablePolicy(
    { table: "user_roles", operation: "select", filters: [] },
    SUPER_ADMIN_AUTH,
  );
  expect(rolesQuery.filters).toEqual([]);
});

test("super admin reads are not scoped to their own row on ownership-scoped business tables", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  const dealsQuery = await applyTablePolicy(
    { table: "portal_deals", operation: "select", filters: [] },
    SUPER_ADMIN_AUTH,
  );
  expect(dealsQuery.filters).toEqual([]);

  const customersQuery = await applyTablePolicy(
    { table: "portal_customers", operation: "count", filters: [] },
    SUPER_ADMIN_AUTH,
  );
  expect(customersQuery.filters).toEqual([]);
});

test("super admin listing deal collaborators without a deal_id filter is not scoped to their own deals", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  const collaboratorsQuery = await applyTablePolicy(
    { table: "portal_deal_collaborators", operation: "select", filters: [] },
    SUPER_ADMIN_AUTH,
  );
  expect(collaboratorsQuery.filters).toEqual([]);
});

test("non-super-admin reads remain scoped to their own profile row", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  const profilesQuery = await applyTablePolicy(
    { table: "profiles", operation: "select", filters: [] },
    {
      userId: "user-a",
      roles: ["partner_admin"],
      partnerId: "partner-a",
      companyName: "Acme Labs",
      hasGovernedContext: true,
    },
  );
  expect(profilesQuery.filters).toEqual([{ column: "id", value: "user-a", operator: "eq" }]);
});

test("customer_participants, deal_participants, and customer_merge_events are partner-scoped", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  for (const table of ["customer_participants", "deal_participants", "customer_merge_events"]) {
    const scoped = await applyTablePolicy(
      { table, operation: "select", filters: [] },
      {
        userId: "user-a",
        roles: ["partner_admin"],
        partnerId: "partner-a",
        companyName: "Acme Labs",
        hasGovernedContext: true,
        governedRoleKey: "partner_admin",
      },
    );
    expect(scoped.filters).toEqual([{ column: "partner_id", value: "partner-a", operator: "eq" }]);

    const unscopedForSuperAdmin = await applyTablePolicy(
      { table, operation: "select", filters: [] },
      SUPER_ADMIN_AUTH,
    );
    expect(unscopedForSuperAdmin.filters).toEqual([]);
  }
});
