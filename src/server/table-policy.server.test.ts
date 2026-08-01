import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";

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

test("queryTableWithAuthContext honors an explicit select() column list instead of always running SELECT *", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";

  const { queryTableWithAuthContext } = await import("@/server/livey-service.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  const observed: Array<{ sql: string; params: unknown[] }> = [];

  pool.query = (async (sql: string, params: unknown[] = []) => {
    observed.push({ sql: String(sql), params });
    if (String(sql).includes('FROM "profiles"')) {
      return {
        rows: [{ id: "user-1", email: "user@example.com", full_name: "User One" }],
        rowCount: 1,
      } as never;
    }
    return { rows: [], rowCount: 0 } as never;
  }) as typeof pool.query;

  try {
    // A caller that deliberately narrows its select — e.g. admin.users.tsx
    // omitting password_hash — must actually get only those columns back,
    // not every column the table has regardless of what was asked for.
    const scoped = await queryTableWithAuthContext(
      {
        table: "profiles",
        operation: "select",
        select: "id, email, full_name",
      },
      {
        userId: "super-admin-user",
        roles: ["super_admin"],
        partnerId: null,
        companyName: null,
        hasGovernedContext: true,
        governedRoleKey: "super_admin",
      },
    );
    expect(scoped.error).toBeNull();
    const scopedSql = observed.find((entry) => entry.sql.includes('FROM "profiles"'))?.sql;
    expect(scopedSql).toContain('SELECT "id", "email", "full_name" FROM "profiles"');
    expect(scopedSql).not.toContain("password_hash");

    observed.length = 0;

    // The default (no select(), or select("*")) is unchanged: SELECT *.
    const unscoped = await queryTableWithAuthContext(
      { table: "profiles", operation: "select" },
      {
        userId: "super-admin-user",
        roles: ["super_admin"],
        partnerId: null,
        companyName: null,
        hasGovernedContext: true,
        governedRoleKey: "super_admin",
      },
    );
    expect(unscoped.error).toBeNull();
    const unscopedSql = observed.find((entry) => entry.sql.includes('FROM "profiles"'))?.sql;
    expect(unscopedSql).toContain('SELECT * FROM "profiles"');
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("queryTableWithAuthContext rejects a select() column that isn't in the table's allowlist", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";

  const { queryTableWithAuthContext } = await import("@/server/livey-service.server");

  await expect(
    queryTableWithAuthContext(
      { table: "profiles", operation: "select", select: "id, not_a_real_column" },
      {
        userId: "super-admin-user",
        roles: ["super_admin"],
        partnerId: null,
        companyName: null,
        hasGovernedContext: true,
        governedRoleKey: "super_admin",
      },
    ),
  ).rejects.toThrow("Unsupported select column: not_a_real_column");
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

test("super admin listing deal line items without a deal_id filter is not scoped to their own deals", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  const lineItemsQuery = await applyTablePolicy(
    { table: "deal_line_items", operation: "select", filters: [] },
    SUPER_ADMIN_AUTH,
  );
  expect(lineItemsQuery.filters).toEqual([]);
});

test("Insight Hub content tables are public-read for any authenticated user and write-locked to super admin", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");
  const partnerAuth = {
    userId: "user-a",
    roles: ["partner_admin"],
    partnerId: "partner-a",
    companyName: "Acme Labs",
    hasGovernedContext: true,
    governedRoleKey: "partner_admin" as const,
  };

  for (const table of [
    "learning_tracks",
    "learning_subjects",
    "learning_lessons",
    "learning_assessments",
  ]) {
    const read = await applyTablePolicy({ table, operation: "select", filters: [] }, partnerAuth);
    expect(read.filters).toEqual([]);

    await expect(
      applyTablePolicy({ table, operation: "insert", values: {} }, partnerAuth),
    ).rejects.toThrow("Access denied");

    const adminWrite = await applyTablePolicy(
      { table, operation: "insert", values: {} },
      SUPER_ADMIN_AUTH,
    );
    expect(adminWrite.table).toBe(table);
  }
});

test("learning_enrollments and learning_assessment_attempts are scoped to the caller's own user_id", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  for (const table of ["learning_enrollments", "learning_assessment_attempts"]) {
    const scoped = await applyTablePolicy(
      { table, operation: "select", filters: [] },
      {
        userId: "user-a",
        roles: ["partner_user"],
        partnerId: "partner-a",
        companyName: "Acme Labs",
        hasGovernedContext: true,
        governedRoleKey: "partner_user",
      },
    );
    expect(scoped.filters).toEqual([{ column: "user_id", value: "user-a", operator: "eq" }]);

    const unscopedForSuperAdmin = await applyTablePolicy(
      { table, operation: "select", filters: [] },
      SUPER_ADMIN_AUTH,
    );
    expect(unscopedForSuperAdmin.filters).toEqual([]);
  }
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

test("domain_activity_events reads are super-admin only, matching portal_audit_events", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  const superAdminRead = await applyTablePolicy(
    { table: "domain_activity_events", operation: "select", filters: [] },
    SUPER_ADMIN_AUTH,
  );
  expect(superAdminRead.filters).toEqual([]);

  await expect(
    applyTablePolicy(
      { table: "domain_activity_events", operation: "select", filters: [] },
      {
        userId: "user-a",
        roles: ["partner_admin"],
        partnerId: "partner-a",
        companyName: "Acme Labs",
        hasGovernedContext: true,
        governedRoleKey: "partner_admin",
      },
    ),
  ).rejects.toThrow("Access denied");

  await expect(
    applyTablePolicy(
      { table: "domain_activity_events", operation: "insert", values: {} },
      SUPER_ADMIN_AUTH,
    ),
  ).rejects.toThrow("Access denied");
});

test("support_ticket_comments' is_internal filter actually reaches SQL execution — TABLE_COLUMNS must list it", async () => {
  // applyTablePolicy alone (the other test below) only proves the filter
  // *object* gets appended — it never runs the SQL-building layer that
  // validates each filter's column against TABLE_COLUMNS. is_internal was
  // added to table-policy's filtering logic without being added to that
  // allowlist in livey-service.server.ts, so every non-support/non-admin
  // viewer's ticket-thread load threw "Unsupported filter column:
  // is_internal" in production — this is the integration test that catches
  // that class of gap.
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  const { queryTableWithAuthContext } = await import("@/server/livey-service.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  pool.query = (async (sql: string) => {
    if (String(sql).includes("FROM role_permissions")) {
      return {
        rows: [
          {
            feature_key: "tickets",
            can_create: true,
            can_read: true,
            can_update: true,
            can_delete: false,
          },
        ],
        rowCount: 1,
      } as never;
    }
    if (String(sql).includes("FROM support_tickets")) {
      return {
        rows: [{ id: "ticket-1", partner_id: "partner-a", created_by: "user-a" }],
        rowCount: 1,
      } as never;
    }
    return { rows: [], rowCount: 0 } as never;
  }) as typeof pool.query;

  try {
    const result = await queryTableWithAuthContext(
      {
        table: "support_ticket_comments",
        operation: "select",
        filters: [{ column: "ticket_id", value: "ticket-1", operator: "eq" }],
      },
      {
        userId: "user-a",
        roles: ["partner_admin"],
        partnerId: "partner-a",
        companyName: "Acme Labs",
        hasGovernedContext: true,
        governedRoleKey: "partner_admin",
      },
    );
    expect(result.error).toBeNull();
    expect(Array.isArray(result.data)).toBe(true);
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("support_ticket_comments hides internal notes from partner roles but not Support/Super Admin", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  pool.query = (async (sql: string) => {
    if (String(sql).includes("FROM role_permissions")) {
      return {
        rows: [
          {
            feature_key: "tickets",
            can_create: true,
            can_read: true,
            can_update: true,
            can_delete: false,
          },
        ],
        rowCount: 1,
      };
    }
    return {
      rows: [{ id: "ticket-1", partner_id: "partner-a", created_by: "user-a" }],
      rowCount: 1,
    };
  }) as never;

  try {
    const partnerRead = await applyTablePolicy(
      {
        table: "support_ticket_comments",
        operation: "select",
        filters: [{ column: "ticket_id", value: "ticket-1", operator: "eq" }],
      },
      {
        userId: "user-a",
        roles: ["partner_admin"],
        partnerId: "partner-a",
        companyName: "Acme Labs",
        hasGovernedContext: true,
        governedRoleKey: "partner_admin",
      },
    );
    expect(partnerRead.filters).toEqual([
      { column: "ticket_id", value: "ticket-1", operator: "eq" },
      { column: "is_internal", value: false, operator: "eq" },
    ]);

    const supportRead = await applyTablePolicy(
      {
        table: "support_ticket_comments",
        operation: "select",
        filters: [{ column: "ticket_id", value: "ticket-1", operator: "eq" }],
      },
      {
        userId: "support-user",
        roles: ["livey_support"],
        partnerId: null,
        companyName: null,
        hasGovernedContext: true,
        governedRoleKey: "livey_support",
        geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
      },
    );
    expect(supportRead.filters).toEqual([
      { column: "ticket_id", value: "ticket-1", operator: "eq" },
    ]);

    await expect(
      applyTablePolicy(
        {
          table: "support_ticket_comments",
          operation: "insert",
          values: { ticket_id: "ticket-1", is_internal: true },
        },
        {
          userId: "user-a",
          roles: ["partner_admin"],
          partnerId: "partner-a",
          companyName: "Acme Labs",
          hasGovernedContext: true,
          governedRoleKey: "partner_admin",
        },
      ),
    ).rejects.toThrow("Access denied");
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("support_tickets reads are unscoped for a globally-ceilinged LIVEY-internal role, not just super_admin", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  pool.query = (async (sql: string) => {
    if (String(sql).includes("FROM role_permissions")) {
      return {
        rows: [
          {
            feature_key: "tickets",
            can_create: true,
            can_read: true,
            can_update: true,
            can_delete: false,
          },
        ],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  }) as never;

  try {
    const supportRead = await applyTablePolicy(
      { table: "support_tickets", operation: "select", filters: [] },
      {
        userId: "support-user",
        roles: ["livey_support"],
        partnerId: null,
        companyName: null,
        hasGovernedContext: true,
        governedRoleKey: "livey_support",
        geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
      },
    );
    expect(supportRead.filters).toEqual([]);

    // A narrower-than-Global ceiling still falls back to the old
    // created_by-only scope (fails closed on breadth, not access), matching
    // the same documented risk as deal-commands.server.ts's LIVEY-role
    // geography check.
    const narrowCeilingRead = await applyTablePolicy(
      { table: "support_tickets", operation: "select", filters: [] },
      {
        userId: "support-user",
        roles: ["livey_support"],
        partnerId: null,
        companyName: null,
        hasGovernedContext: true,
        governedRoleKey: "livey_support",
        geographyCeilingNodeId: "geo-country-in",
      },
    );
    expect(narrowCeilingRead.filters).toEqual([
      { column: "created_by", value: "support-user", operator: "eq" },
    ]);
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("portal_team_members reads for a caller with no company_name (any LIVEY-internal role) return an empty scope, not Access denied", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  // Before this fix, this threw — which took down deals.tsx's entire
  // Promise.all load for every RM/PAM/KAM/ISR/Support user, since that
  // page unconditionally queries portal_team_members alongside deals.
  const read = await applyTablePolicy(
    { table: "portal_team_members", operation: "select", filters: [] },
    {
      userId: "rm-user-1",
      roles: ["rm"],
      partnerId: null,
      companyName: null,
      hasGovernedContext: true,
      governedRoleKey: "rm",
    },
  );
  expect(read.filters).toEqual([
    { column: "company_name", value: "__no_company_scope__", operator: "eq" },
  ]);
});

test("portal_deals reads are unscoped by ownership for RM/PAM/KAM/ISR/Support — geography, not self-created-only", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  for (const role of ["rm", "pam", "kam", "isr", "livey_support"] as const) {
    const read = await applyTablePolicy(
      { table: "portal_deals", operation: "select", filters: [] },
      {
        userId: "internal-user",
        roles: [role],
        partnerId: null,
        companyName: null,
        hasGovernedContext: true,
        governedRoleKey: role,
        geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
      },
    );
    // No user_id/partner_id ownership filter — appendGeographyFilter (run
    // separately, after applyTablePolicyInner) is what narrows this by
    // region, not this function.
    expect(read.filters).toEqual([]);
  }
});

test("portal_deals reads stay partner-scoped for partner_admin/partner_user, and self-scoped for restricted_distributor via their partnerId", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  const partnerRead = await applyTablePolicy(
    { table: "portal_deals", operation: "select", filters: [] },
    {
      userId: "partner-user-1",
      roles: ["partner_admin"],
      partnerId: "partner-a",
      companyName: "Acme",
      hasGovernedContext: true,
      governedRoleKey: "partner_admin",
    },
  );
  expect(partnerRead.filters).toEqual([
    { column: "partner_id", value: "partner-a", operator: "eq" },
  ]);

  // restricted_distributor always has a real partnerId (they're tenant-
  // scoped, not internal), so they never reach the LIVEY-internal branch —
  // still whole-tenant, not tag-scoped (§2.4/8.7a — a separate, still-open
  // finding about the write/command layer, not this read-scope fix).
  const distributorRead = await applyTablePolicy(
    { table: "portal_deals", operation: "select", filters: [] },
    {
      userId: "distributor-1",
      roles: ["restricted_distributor"],
      partnerId: "partner-a",
      companyName: null,
      hasGovernedContext: true,
      governedRoleKey: "restricted_distributor",
    },
  );
  expect(distributorRead.filters).toEqual([
    { column: "partner_id", value: "partner-a", operator: "eq" },
  ]);
});

test("tasks reads are scoped to creator OR assignee for LIVEY-internal roles, not creator-only", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  const read = await applyTablePolicy(
    { table: "tasks", operation: "select", filters: [] },
    {
      userId: "rm-user-1",
      roles: ["rm"],
      partnerId: null,
      companyName: null,
      hasGovernedContext: true,
      governedRoleKey: "rm",
      geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    },
  );
  expect(read.filters).toEqual([]);
  expect(read.scopeAnyColumnEquals).toEqual({
    columns: ["creator_id", "assignee_id"],
    value: "rm-user-1",
  });
});

test("tasks reads for queryTableWithAuthContext generate a real (creator_id = $1 OR assignee_id = $1) SQL clause", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  const { queryTableWithAuthContext } = await import("@/server/livey-service.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  const observed: Array<{ sql: string; params: unknown[] }> = [];
  pool.query = (async (sql: string, params: unknown[] = []) => {
    observed.push({ sql: String(sql), params });
    if (String(sql).includes("FROM role_permissions")) {
      return {
        rows: [
          {
            feature_key: "tasks",
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
    const result = await queryTableWithAuthContext(
      { table: "tasks", operation: "select" },
      {
        userId: "rm-user-1",
        roles: ["rm"],
        partnerId: null,
        companyName: null,
        hasGovernedContext: true,
        governedRoleKey: "rm",
        geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
      },
    );
    expect(result.error).toBeNull();
    const tasksQuery = observed.find((entry) => entry.sql.includes('FROM "tasks"'));
    expect(tasksQuery?.sql).toContain('WHERE ("creator_id" = $1 OR "assignee_id" = $1)');
    expect(tasksQuery?.params).toEqual(["rm-user-1"]);
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("domain_activity_events allows a non-super-admin to read events for a specific deal they can already see", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  pool.query = (async (sql: string) => {
    if (String(sql).includes("FROM portal_deals")) {
      return {
        rows: [{ id: "deal-1", partner_id: "partner-a", user_id: null }],
        rowCount: 1,
      } as never;
    }
    if (String(sql).includes("FROM role_permissions")) {
      return {
        rows: [
          {
            feature_key: "audit",
            can_create: false,
            can_read: true,
            can_update: false,
            can_delete: false,
          },
        ],
        rowCount: 1,
      } as never;
    }
    return { rows: [], rowCount: 0 } as never;
  }) as typeof pool.query;

  try {
    const auth = {
      userId: "partner-user-1",
      roles: ["partner_admin"],
      partnerId: "partner-a",
      companyName: "Acme",
      hasGovernedContext: true,
      governedRoleKey: "partner_admin" as const,
    };

    const allowed = await applyTablePolicy(
      {
        table: "domain_activity_events",
        operation: "select",
        filters: [
          { column: "subject_type", value: "deal", operator: "eq" },
          { column: "subject_id", value: "deal-1", operator: "eq" },
        ],
      },
      auth,
    );
    expect(allowed.filters).toEqual([
      { column: "subject_type", value: "deal", operator: "eq" },
      { column: "subject_id", value: "deal-1", operator: "eq" },
    ]);

    // A different partner's deal: assertLinkedDealAccess denies.
    await expect(
      applyTablePolicy(
        {
          table: "domain_activity_events",
          operation: "select",
          filters: [
            { column: "subject_type", value: "deal", operator: "eq" },
            { column: "subject_id", value: "deal-1", operator: "eq" },
          ],
        },
        { ...auth, partnerId: "partner-b" },
      ),
    ).rejects.toThrow("Access denied");

    // No subject_id filter at all (e.g. the dashboard's broad recent-
    // activity feed) still denies for non-super-admin — that broader case
    // remains unscoped/unbuilt, not silently widened by this fix.
    await expect(
      applyTablePolicy({ table: "domain_activity_events", operation: "select", filters: [] }, auth),
    ).rejects.toThrow("Access denied");
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("portal_audit_events insert overrides client-supplied actor identity with the server-verified session (product.md §19.8)", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  pool.query = (async (sql: string) => {
    if (String(sql).includes("FROM profiles WHERE id")) {
      return { rows: [{ full_name: "Real Logged-In User" }], rowCount: 1 };
    }
    if (String(sql).includes("FROM role_permissions")) {
      return {
        rows: [
          {
            feature_key: "audit",
            can_create: true,
            can_read: false,
            can_update: false,
            can_delete: false,
          },
        ],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  }) as never;

  try {
    const scoped = await applyTablePolicy(
      {
        table: "portal_audit_events",
        operation: "insert",
        values: {
          id: "event-1",
          actor_name: "Forged Name",
          actor_role: "super_admin",
          action: "deal_won",
          target_type: "deal",
          target_name: "Acme Co",
          outcome: "won",
          details: "test",
          severity: "low",
        },
      },
      {
        userId: "user-a",
        roles: ["partner_user"],
        partnerId: "partner-a",
        companyName: "Acme Labs",
        hasGovernedContext: true,
        governedRoleKey: "partner_user",
      },
    );

    expect(scoped.values).toMatchObject({
      actor_id: "user-a",
      actor_name: "Real Logged-In User",
      actor_role: "partner_user",
    });
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("portal_audit_events insert denies an anonymous caller", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  await expect(
    applyTablePolicy(
      { table: "portal_audit_events", operation: "insert", values: { id: "event-1" } },
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

test("document_blobs and password_reset_tokens are unreachable through the generic table path for every role", async () => {
  const { applyTablePolicy } = await import("@/server/table-policy.server");

  const PARTNER_USER_AUTH = {
    userId: "user-a",
    roles: ["partner_user"],
    partnerId: "partner-a",
    companyName: "Acme Labs",
    hasGovernedContext: true,
    governedRoleKey: "partner_user" as const,
  };

  for (const table of ["document_blobs", "password_reset_tokens"]) {
    for (const operation of ["select", "count", "insert", "update", "delete"] as const) {
      // A plain partner_user previously fell through to the unscoped
      // catch-all here: select leaked every tenant's raw document bytes,
      // and insert into password_reset_tokens allowed forging a reset
      // token for any account, including super_admin.
      await expect(
        applyTablePolicy({ table, operation, filters: [], values: {} }, PARTNER_USER_AUTH),
      ).rejects.toThrow("Access denied");

      // Denied for super_admin too — every legitimate access to these
      // tables uses a dedicated server function with raw pool.query.
      await expect(
        applyTablePolicy({ table, operation, filters: [], values: {} }, SUPER_ADMIN_AUTH),
      ).rejects.toThrow("Access denied");
    }
  }
});
