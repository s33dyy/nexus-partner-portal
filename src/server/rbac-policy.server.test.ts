import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://localhost/test";

test("user override replaces the role decision", async () => {
  const { resolveEffectiveCapability } = await import("@/server/rbac-policy.server");

  expect(
    resolveEffectiveCapability({
      role: "rm",
      feature: "tasks",
      operation: "delete",
      roleAllowed: false,
      userOverride: true,
    }),
  ).toBe(true);
});

test("missing override inherits the role decision", async () => {
  const { resolveEffectiveCapability } = await import("@/server/rbac-policy.server");

  expect(
    resolveEffectiveCapability({
      role: "partner_admin",
      feature: "tasks",
      operation: "update",
      roleAllowed: true,
      userOverride: null,
    }),
  ).toBe(true);
});

test("super_admin keeps structural authority over user overrides", async () => {
  const { resolveEffectiveCapability } = await import("@/server/rbac-policy.server");

  expect(
    resolveEffectiveCapability({
      role: "super_admin",
      feature: "users",
      operation: "delete",
      roleAllowed: false,
      userOverride: false,
    }),
  ).toBe(true);
});

test("effective capabilities apply only explicit user overrides", async () => {
  const { pool } = await import("@/server/postgres.server");
  const { loadEffectiveCapabilities } = await import("@/server/rbac-policy.server");
  const originalQuery = pool.query.bind(pool);

  pool.query = (async (sql: string) => {
    if (String(sql).includes("FROM role_permissions")) {
      return {
        rows: [
          {
            feature_key: "tasks",
            can_create: false,
            can_read: true,
            can_update: true,
            can_delete: false,
          },
        ],
        rowCount: 1,
      } as never;
    }
    if (String(sql).includes("FROM user_access_overrides")) {
      return {
        rows: [{ feature_key: "tasks", operation: "delete", decision: "allow" }],
        rowCount: 1,
      } as never;
    }
    return { rows: [], rowCount: 0 } as never;
  }) as typeof pool.query;

  try {
    const capabilities = await loadEffectiveCapabilities("user-1", "rm");
    expect(capabilities.tasks).toEqual({ create: false, read: true, update: true, delete: true });
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("loadRoleCapabilities gives super_admin the explicit full capability matrix without a database lookup", async () => {
  const { pool } = await import("@/server/postgres.server");
  const { FEATURE_KEYS } = await import("@/domain/contracts/features");
  const { loadRoleCapabilities } = await import("@/server/rbac-policy.server");
  const originalQuery = pool.query.bind(pool);
  let rolePermissionQueryCount = 0;

  pool.query = (async (sql: string) => {
    if (String(sql).includes("FROM role_permissions")) {
      rolePermissionQueryCount += 1;
    }
    return { rows: [], rowCount: 0 } as never;
  }) as typeof pool.query;

  try {
    const capabilities = await loadRoleCapabilities("super_admin");

    for (const feature of FEATURE_KEYS) {
      expect(capabilities[feature].create).toBe(true);
      expect(capabilities[feature].read).toBe(true);
      expect(capabilities[feature].update).toBe(true);
      expect(capabilities[feature].delete).toBe(feature !== "distribution");
    }
    expect(rolePermissionQueryCount).toBe(0);
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});
