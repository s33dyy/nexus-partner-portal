import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://localhost/test";

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
