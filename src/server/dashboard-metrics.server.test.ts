import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://localhost/test";

type FakeDealRow = {
  id: string;
  stage: string;
  user_id: string | null;
  partner_id: string | null;
  is_hidden_to_team: boolean;
  country: string | null;
  amount_usd: number | null;
  amount_value: number | null;
  currency_code: string | null;
};

type FakePricingRow = { deal_id: string; total_dtp_usd: number | null };

function installFakePool(input: {
  dealRows: FakeDealRow[];
  collaboratorRows?: Array<{ deal_id: string; user_id: string }>;
  pricingRows?: FakePricingRow[];
  rolePermissionRows?: Array<{
    feature_key: string;
    can_create: boolean;
    can_read: boolean;
    can_update: boolean;
    can_delete: boolean;
  }>;
}) {
  const observed: Array<{ sql: string; params: unknown[] }> = [];

  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const originalQuery = pool.query.bind(pool);

    pool.query = (async (sql: string, params: unknown[] = []) => {
      const text = String(sql);
      observed.push({ sql: text, params });

      if (text.includes('FROM "portal_deals"')) {
        return { rows: input.dealRows, rowCount: input.dealRows.length } as never;
      }
      if (text.includes("FROM role_permissions")) {
        return {
          rows: input.rolePermissionRows ?? [
            {
              feature_key: "deals",
              can_create: true,
              can_read: true,
              can_update: true,
              can_delete: true,
            },
          ],
          rowCount: 1,
        } as never;
      }
      if (text.includes("FROM portal_deal_collaborators")) {
        const rows = input.collaboratorRows ?? [];
        return { rows, rowCount: rows.length } as never;
      }
      if (text.includes("FROM pricing_revisions")) {
        const rows = input.pricingRows ?? [];
        return { rows, rowCount: rows.length } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    }) as typeof pool.query;

    return {
      observed,
      restore: () => {
        pool.query = originalQuery as typeof pool.query;
      },
    };
  };
}

function dealRow(overrides: Partial<FakeDealRow>): FakeDealRow {
  return {
    id: "deal-1",
    stage: "negotiation",
    user_id: "user-1",
    partner_id: null,
    is_hidden_to_team: false,
    country: "United States",
    amount_usd: null,
    amount_value: null,
    currency_code: "USD",
    ...overrides,
  };
}

const SUPER_ADMIN_AUTH = {
  userId: "admin-1",
  roles: ["super_admin"],
  partnerId: null,
  companyName: null,
  hasGovernedContext: true,
  governedRoleKey: "super_admin" as const,
  geographyCeilingNodeId: "geo-global",
};

test("loadDashboardPipelineMetrics sums effective DTP for visible open deals and queries the latest revision", async () => {
  const harness = await installFakePool({
    dealRows: [
      dealRow({ id: "deal-visible-1", stage: "negotiation" }),
      dealRow({ id: "deal-visible-2", stage: "proposal" }),
    ],
    pricingRows: [
      { deal_id: "deal-visible-1", total_dtp_usd: 1500 },
      { deal_id: "deal-visible-2", total_dtp_usd: 1000 },
    ],
  })();
  try {
    const { loadDashboardPipelineMetrics } = await import("@/server/dashboard-metrics.server");
    const result = await loadDashboardPipelineMetrics({
      auth: SUPER_ADMIN_AUTH,
      selectedRegion: "all",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metrics.pipelineValueUsd).toBe(2500);
      expect(result.metrics.openDealCount).toBe(2);
      expect(result.metrics.missingDtpCount).toBe(0);
    }

    const pricingCall = harness.observed.find((entry) =>
      entry.sql.includes("FROM pricing_revisions"),
    );
    expect(pricingCall?.sql).toContain("DISTINCT ON (deal_id)");
    expect(pricingCall?.sql).toContain("revision_number DESC");
    expect(pricingCall?.params).toEqual([["deal-visible-1", "deal-visible-2"]]);
  } finally {
    harness.restore();
  }
});

test("loadDashboardPipelineMetrics returns POLICY_DENIED for an unauthenticated actor", async () => {
  const harness = await installFakePool({ dealRows: [] })();
  try {
    const { loadDashboardPipelineMetrics } = await import("@/server/dashboard-metrics.server");
    const result = await loadDashboardPipelineMetrics({
      auth: {
        userId: null,
        roles: [],
        partnerId: null,
        companyName: null,
        hasGovernedContext: false,
      },
      selectedRegion: "all",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});

test("loadDashboardPipelineMetrics excludes deals hidden from the team when the viewer is not the owner or a collaborator", async () => {
  const harness = await installFakePool({
    dealRows: [
      dealRow({
        id: "deal-hidden",
        stage: "negotiation",
        user_id: "other-user",
        is_hidden_to_team: true,
      }),
      dealRow({ id: "deal-visible", stage: "negotiation", user_id: "admin-1" }),
    ],
    pricingRows: [{ deal_id: "deal-visible", total_dtp_usd: 400 }],
  })();
  try {
    const { loadDashboardPipelineMetrics } = await import("@/server/dashboard-metrics.server");
    const result = await loadDashboardPipelineMetrics({
      auth: {
        userId: "admin-1",
        roles: ["rm"],
        partnerId: null,
        companyName: null,
        hasGovernedContext: true,
        governedRoleKey: "rm",
        geographyCeilingNodeId: "geo-global",
      },
      selectedRegion: "all",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metrics.openDealCount).toBe(1);
      expect(result.metrics.pipelineValueUsd).toBe(400);
    }

    const pricingCall = harness.observed.find((entry) =>
      entry.sql.includes("FROM pricing_revisions"),
    );
    expect(pricingCall?.params).toEqual([["deal-visible"]]);
  } finally {
    harness.restore();
  }
});

test("loadDashboardPipelineMetrics applies the selected region before the pricing lookup", async () => {
  const harness = await installFakePool({
    dealRows: [
      dealRow({ id: "deal-us", stage: "negotiation", country: "United States" }),
      dealRow({ id: "deal-in", stage: "negotiation", country: "India" }),
    ],
    pricingRows: [{ deal_id: "deal-in", total_dtp_usd: 900 }],
  })();
  try {
    const { loadDashboardPipelineMetrics } = await import("@/server/dashboard-metrics.server");
    const result = await loadDashboardPipelineMetrics({
      auth: SUPER_ADMIN_AUTH,
      selectedRegion: "india",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metrics.openDealCount).toBe(1);
      expect(result.metrics.pipelineValueUsd).toBe(900);
    }

    const pricingCall = harness.observed.find((entry) =>
      entry.sql.includes("FROM pricing_revisions"),
    );
    expect(pricingCall?.params).toEqual([["deal-in"]]);
  } finally {
    harness.restore();
  }
});

test("loadDashboardPipelineMetrics never includes Won or Lost deal ids in the pricing lookup", async () => {
  const harness = await installFakePool({
    dealRows: [
      dealRow({ id: "deal-won", stage: "won" }),
      dealRow({ id: "deal-lost", stage: "lost" }),
      dealRow({ id: "deal-open", stage: "sourced" }),
    ],
    pricingRows: [{ deal_id: "deal-open", total_dtp_usd: 200 }],
  })();
  try {
    const { loadDashboardPipelineMetrics } = await import("@/server/dashboard-metrics.server");
    const result = await loadDashboardPipelineMetrics({
      auth: SUPER_ADMIN_AUTH,
      selectedRegion: "all",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metrics.openDealCount).toBe(1);
      expect(result.metrics.pipelineValueUsd).toBe(200);
    }

    const pricingCall = harness.observed.find((entry) =>
      entry.sql.includes("FROM pricing_revisions"),
    );
    expect(pricingCall?.params).toEqual([["deal-open"]]);
  } finally {
    harness.restore();
  }
});

test("loadDashboardPipelineMetrics reports missingDtpCount instead of masquerading as a query failure", async () => {
  const harness = await installFakePool({
    dealRows: [dealRow({ id: "deal-missing", stage: "qualified" })],
    pricingRows: [],
  })();
  try {
    const { loadDashboardPipelineMetrics } = await import("@/server/dashboard-metrics.server");
    const result = await loadDashboardPipelineMetrics({
      auth: SUPER_ADMIN_AUTH,
      selectedRegion: "all",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metrics.pipelineValueUsd).toBe(0);
      expect(result.metrics.openDealCount).toBe(1);
      expect(result.metrics.missingDtpCount).toBe(1);
    }
  } finally {
    harness.restore();
  }
});
