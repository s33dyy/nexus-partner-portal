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
    expect(observed[0]?.sql).toContain('FROM "portal_deals" WHERE "partner_id" = $1');
    expect(observed[0]?.params).toEqual(["partner-a"]);

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
