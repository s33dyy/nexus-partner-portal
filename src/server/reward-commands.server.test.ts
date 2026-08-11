import { expect, mock, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import type { RewardCommandActor } from "@/server/reward-commands.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

// Captured before any test calls mock.module("@/integrations/gyftr", ...) so
// the GyFTR-failure test below can restore the real graceful-stub client
// afterward instead of leaking its mock into every later test in this file.
const realGyftrModule = await import("@/integrations/gyftr");

const ISSUED_AT = "2026-08-01T00:00:00.000Z";

function buildAssignment(overrides: Partial<AssignmentRecord> = {}): AssignmentRecord {
  return {
    assignmentId: "assignment-1",
    userId: "11111111-1111-1111-1111-111111111111",
    tenantId: "tenant-livey-org",
    organizationTenantId: "tenant-livey-org",
    roleKey: "partner_user",
    teamDomain: "partner_success",
    geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    partnerId: "partner-1",
    accountId: null,
    portfolioId: null,
    queueId: null,
    status: "active",
    validFrom: ISSUED_AT,
    validTo: null,
    managerAssignmentId: null,
    source: "test",
    approverUserId: null,
    predecessorAssignmentId: null,
    successorAssignmentId: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: ISSUED_AT,
    updatedAt: ISSUED_AT,
    version: 1,
    isSeed: true,
    ...overrides,
  };
}

function buildActiveContext(
  assignment: AssignmentRecord,
  overrides: Partial<ActiveContextRecord> = {},
): ActiveContextRecord {
  return {
    contextId: "context-1",
    userId: assignment.userId,
    assignmentId: assignment.assignmentId,
    assignmentStatus: assignment.status,
    tenantId: assignment.tenantId,
    organizationTenantId: assignment.organizationTenantId,
    workingScope: null,
    issuedAt: ISSUED_AT,
    expiresAt: "2026-08-01T08:00:00.000Z",
    version: 1,
    revocationLink: null,
    correlationId: "corr-1",
    assignmentVersion: assignment.version,
    workingScopeNodeId: null,
    revokedAt: null,
    revocationReason: null,
    isSeed: true,
    createdAt: ISSUED_AT,
    updatedAt: ISSUED_AT,
    ...overrides,
  };
}

function buildActor(overrides: Partial<AssignmentRecord> = {}): RewardCommandActor {
  const assignment = buildAssignment(overrides);
  return {
    userId: assignment.userId,
    assignment,
    activeContext: buildActiveContext(assignment),
  };
}

const PARTNER_USER_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN_USER_ID = "22222222-2222-2222-2222-222222222222";

function partnerActor(overrides: Partial<AssignmentRecord> = {}) {
  return buildActor({
    userId: PARTNER_USER_ID,
    roleKey: "partner_user",
    teamDomain: "partner_success",
    partnerId: "partner-1",
    ...overrides,
  });
}

function adminActor(overrides: Partial<AssignmentRecord> = {}) {
  return buildActor({
    userId: ADMIN_USER_ID,
    roleKey: "super_admin",
    teamDomain: "identity",
    partnerId: null,
    geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// In-memory transactional harness
//
// Real PostgreSQL SELECT ... FOR UPDATE blocks a second transaction until
// the first COMMITs/ROLLBACKs. That blocking behavior is exactly what the
// reservation/release commands rely on to stay race-safe, so the fake pool
// below reproduces it with a tiny per-key async mutex instead of just
// stubbing rows — otherwise the "two concurrent requests" tests could not
// actually exercise the locking they are meant to verify.
// ---------------------------------------------------------------------------

type CatalogRow = {
  id: string;
  title: string;
  points_cost: number;
  stock: number;
  availability: string;
  retired_at: string | null;
  retired_by: string | null;
};

type RedemptionRow = {
  id: string;
  reward_id: string;
  user_id: string | null;
  partner_id: string | null;
  points_cost: number;
  status: string;
  idempotency_key: string | null;
  version: number;
  approved_by: string | null;
  approved_at: string | null;
  fulfillment_provider: string | null;
  fulfillment_reference: string | null;
  fulfillment_voucher_code: string | null;
  fulfillment_expires_at: string | null;
  fulfilled_at: string | null;
  failure_reason: string | null;
};

type PointEventRow = {
  id: string;
  user_id: string | null;
  partner_id: string | null;
  source_type: string;
  source_id: string | null;
  points_delta: number;
  reason: string;
  idempotency_key: string | null;
  reversal_of: string | null;
};

type RewardHarnessState = {
  profiles: Array<{ id: string; partner_id: string | null }>;
  catalog: CatalogRow[];
  redemptions: RedemptionRow[];
  pointEvents: PointEventRow[];
  failNextActivityInsert: boolean;
};

function currentBalance(state: RewardHarnessState, userId: string): number {
  return state.pointEvents
    .filter((event) => event.user_id === userId)
    .reduce((sum, event) => sum + event.points_delta, 0);
}

function createRewardState(overrides: Partial<RewardHarnessState> = {}): RewardHarnessState {
  return {
    profiles: [
      { id: PARTNER_USER_ID, partner_id: "partner-1" },
      { id: ADMIN_USER_ID, partner_id: null },
    ],
    catalog: [
      {
        id: "reward-1",
        title: "LIVEY Hoodie",
        points_cost: 500,
        stock: 1,
        availability: "available",
        retired_at: null,
        retired_by: null,
      },
    ],
    redemptions: [],
    pointEvents: [
      {
        id: "seed-award-1",
        user_id: PARTNER_USER_ID,
        partner_id: "partner-1",
        source_type: "deal_win",
        source_id: "deal-1",
        points_delta: 500,
        reason: "Deal Award",
        idempotency_key: null,
        reversal_of: null,
      },
    ],
    failNextActivityInsert: false,
    ...overrides,
  };
}

function createLockManager() {
  const held = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();

  async function acquire(key: string): Promise<void> {
    if (!held.has(key)) {
      held.add(key);
      return;
    }
    await new Promise<void>((resolve) => {
      const queue = waiters.get(key) ?? [];
      queue.push(resolve);
      waiters.set(key, queue);
    });
  }

  function release(key: string) {
    const queue = waiters.get(key);
    const next = queue?.shift();
    if (next) {
      next();
      return;
    }
    held.delete(key);
  }

  return { acquire, release };
}

function installFakePool(state: RewardHarnessState) {
  const locks = createLockManager();

  function handleRead(sql: string, params: unknown[]) {
    if (sql.includes("FROM reward_redemptions") && sql.includes("idempotency_key = $1")) {
      const row = state.redemptions.find((r) => r.idempotency_key === params[0]);
      return { rows: row ? [{ id: row.id, user_id: row.user_id, version: row.version }] : [] };
    }
    if (sql.includes("FROM reward_point_events") && sql.includes("idempotency_key = $1")) {
      const row = state.pointEvents.find((r) => r.idempotency_key === params[0]);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    // --- attemptGyFTRFulfillment's pre-check read (outside any tx) -------
    if (sql.startsWith("SELECT id, reward_id, user_id, status, version FROM reward_redemptions")) {
      const row = state.redemptions.find((r) => r.id === params[0]);
      return {
        rows: row
          ? [
              {
                id: row.id,
                reward_id: row.reward_id,
                user_id: row.user_id,
                status: row.status,
                version: row.version,
              },
            ]
          : [],
      };
    }
    if (sql.startsWith("SELECT email, phone FROM profiles")) {
      const row = state.profiles.find((p) => p.id === params[0]);
      return { rows: row ? [{ email: `${row.id}@example.com`, phone: null }] : [] };
    }
    // --- attemptGyFTRFulfillment's catch-block fallback (outside any tx) -
    if (sql.startsWith("UPDATE reward_redemptions SET status = 'failed', failure_reason = $2")) {
      const [id, reason] = params as [string, string];
      const row = state.redemptions.find((r) => r.id === id && r.status === "processing");
      if (!row) return { rows: [], rowCount: 0 };
      row.status = "failed";
      row.failure_reason = reason;
      row.version += 1;
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unhandled read outside transaction: ${sql}`);
  }

  function createClient() {
    let heldKeys: string[] = [];
    let undoLog: Array<() => void> = [];

    async function lock(key: string) {
      await locks.acquire(key);
      heldKeys.push(key);
    }

    function releaseAll() {
      for (const key of heldKeys) locks.release(key);
      heldKeys = [];
    }

    async function handle(sql: string, params: unknown[]) {
      // --- profiles -----------------------------------------------------
      if (sql.startsWith("SELECT id, partner_id FROM profiles") && sql.includes("FOR UPDATE")) {
        await lock(`profile:${params[0]}`);
        const row = state.profiles.find((p) => p.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      if (sql.startsWith("SELECT id FROM profiles") && sql.includes("FOR UPDATE")) {
        await lock(`profile:${params[0]}`);
        const row = state.profiles.find((p) => p.id === params[0]);
        return { rows: row ? [{ id: row.id }] : [] };
      }

      // --- reward_redemptions idempotency lookup (request) --------------
      if (
        sql.startsWith("SELECT id, user_id, version FROM reward_redemptions") &&
        sql.includes("idempotency_key = $1")
      ) {
        const row = state.redemptions.find((r) => r.idempotency_key === params[0]);
        return { rows: row ? [{ id: row.id, user_id: row.user_id, version: row.version }] : [] };
      }

      // --- reward_catalog_items lock (request: full projection) ---------
      if (sql.startsWith("SELECT id, title, points_cost, stock, availability, retired_at")) {
        await lock(`catalog:${params[0]}`);
        const row = state.catalog.find((c) => c.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      // --- reward_catalog_items lock (reject: id only) -------------------
      if (sql.startsWith("SELECT id FROM reward_catalog_items") && sql.includes("FOR UPDATE")) {
        await lock(`catalog:${params[0]}`);
        const row = state.catalog.find((c) => c.id === params[0]);
        return { rows: row ? [{ id: row.id }] : [] };
      }
      // --- reward_catalog_items lock (retire) -----------------------------
      if (sql.startsWith("SELECT id, retired_at FROM reward_catalog_items")) {
        await lock(`catalog:${params[0]}`);
        const row = state.catalog.find((c) => c.id === params[0]);
        return { rows: row ? [{ id: row.id, retired_at: row.retired_at }] : [] };
      }

      // --- balance ---------------------------------------------------------
      if (sql.includes("AS balance") && sql.includes("FROM reward_point_events")) {
        return { rows: [{ balance: currentBalance(state, params[0] as string) }] };
      }

      // --- reward_redemptions lock by id (approve/reject) -----------------
      if (
        sql.startsWith("SELECT id, status, version, reward_id, user_id, partner_id, points_cost")
      ) {
        await lock(`redemption:${params[0]}`);
        const row = state.redemptions.find((r) => r.id === params[0]);
        return { rows: row ? [row] : [] };
      }
      // --- reward_redemptions lock by id (GyFTR fulfillment settle) -------
      if (
        sql.startsWith("SELECT id, status, version FROM reward_redemptions") &&
        sql.includes("FOR UPDATE")
      ) {
        await lock(`redemption:${params[0]}`);
        const row = state.redemptions.find((r) => r.id === params[0]);
        return { rows: row ? [{ id: row.id, status: row.status, version: row.version }] : [] };
      }

      // --- reservation / release lookups -----------------------------------
      if (
        sql.includes("FROM reward_point_events") &&
        sql.includes("source_type = 'redemption_reservation'")
      ) {
        const row = state.pointEvents.find(
          (e) => e.source_type === "redemption_reservation" && e.source_id === params[0],
        );
        return { rows: row ? [{ id: row.id }] : [] };
      }
      if (sql.includes("FROM reward_point_events") && sql.includes("reversal_of = $1")) {
        const row = state.pointEvents.find((e) => e.reversal_of === params[0]);
        return { rows: row ? [{ id: row.id }] : [] };
      }
      if (
        sql.startsWith("SELECT id FROM reward_point_events") &&
        sql.includes("idempotency_key = $1")
      ) {
        const row = state.pointEvents.find((e) => e.idempotency_key === params[0]);
        return { rows: row ? [{ id: row.id }] : [] };
      }

      // --- inserts -----------------------------------------------------
      if (sql.startsWith("INSERT INTO reward_redemptions")) {
        const [
          id,
          rewardId,
          userId,
          partnerId,
          pointsCost,
          shippingName,
          shippingAddress,
          notes,
          idempotencyKey,
        ] = params as [
          string,
          string,
          string,
          string,
          number,
          string,
          string,
          string | null,
          string,
        ];
        void shippingName;
        void shippingAddress;
        void notes;
        const row: RedemptionRow = {
          id,
          reward_id: rewardId,
          user_id: userId,
          partner_id: partnerId,
          points_cost: pointsCost,
          status: "points_reserved",
          idempotency_key: idempotencyKey,
          version: 1,
          approved_by: null,
          approved_at: null,
          fulfillment_provider: null,
          fulfillment_reference: null,
          fulfillment_voucher_code: null,
          fulfillment_expires_at: null,
          fulfilled_at: null,
          failure_reason: null,
        };
        if (state.redemptions.some((r) => r.idempotency_key === idempotencyKey)) {
          const conflict = new Error("duplicate key value violates unique constraint") as Error & {
            code: string;
          };
          conflict.code = "23505";
          throw conflict;
        }
        undoLog.push(() => {
          state.redemptions = state.redemptions.filter((r) => r.id !== id);
        });
        state.redemptions.push(row);
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("INSERT INTO reward_point_events")) {
        let sourceType: string;
        let rest: unknown[];
        if (sql.includes("'redemption_reservation'")) {
          sourceType = "redemption_reservation";
          rest = params;
        } else if (sql.includes("'reservation_release'")) {
          sourceType = "reservation_release";
          rest = params;
        } else {
          sourceType = params[3] as string;
          rest = params;
        }

        let row: PointEventRow;
        if (sourceType === "redemption_reservation") {
          const [id, userId, partnerId, sourceId, pointsDelta, reason, idempotencyKey] = rest as [
            string,
            string,
            string,
            string,
            number,
            string,
            string,
          ];
          row = {
            id,
            user_id: userId,
            partner_id: partnerId,
            source_type: sourceType,
            source_id: sourceId,
            points_delta: pointsDelta,
            reason,
            idempotency_key: idempotencyKey,
            reversal_of: null,
          };
        } else if (sourceType === "reservation_release") {
          const [id, userId, partnerId, sourceId, pointsDelta, reason, idempotencyKey, reversalOf] =
            rest as [string, string, string, string, number, string, string, string, string];
          row = {
            id,
            user_id: userId,
            partner_id: partnerId,
            source_type: sourceType,
            source_id: sourceId,
            points_delta: pointsDelta,
            reason,
            idempotency_key: idempotencyKey,
            reversal_of: reversalOf,
          };
        } else {
          const [id, userId, partnerId, , pointsDelta, reason, , idempotencyKey] = rest as [
            string,
            string,
            string,
            string,
            number,
            string,
            string,
            string,
          ];
          row = {
            id,
            user_id: userId,
            partner_id: partnerId,
            source_type: sourceType,
            source_id: null,
            points_delta: pointsDelta,
            reason,
            idempotency_key: idempotencyKey,
            reversal_of: null,
          };
        }

        if (
          row.idempotency_key &&
          state.pointEvents.some((e) => e.idempotency_key === row.idempotency_key)
        ) {
          const conflict = new Error("duplicate key value violates unique constraint") as Error & {
            code: string;
          };
          conflict.code = "23505";
          throw conflict;
        }
        undoLog.push(() => {
          state.pointEvents = state.pointEvents.filter((e) => e.id !== row.id);
        });
        state.pointEvents.push(row);
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("INSERT INTO domain_activity_events")) {
        if (state.failNextActivityInsert) {
          throw new Error("simulated activity insert failure");
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO command_outbox")) {
        return { rows: [], rowCount: 1 };
      }

      // --- updates -------------------------------------------------------
      if (sql.startsWith("UPDATE reward_catalog_items SET stock = stock - 1")) {
        const row = state.catalog.find((c) => c.id === params[0]);
        if (!row || !(row.stock > 0 && row.availability === "available" && !row.retired_at)) {
          return { rows: [], rowCount: 0 };
        }
        const before = row.stock;
        row.stock -= 1;
        undoLog.push(() => {
          row.stock = before;
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE reward_catalog_items SET stock = stock + 1")) {
        const row = state.catalog.find((c) => c.id === params[0]);
        if (!row) return { rows: [], rowCount: 0 };
        const before = row.stock;
        row.stock += 1;
        undoLog.push(() => {
          row.stock = before;
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE reward_catalog_items SET availability = 'retired'")) {
        const [id, retiredBy] = params as [string, string];
        const row = state.catalog.find((c) => c.id === id);
        if (!row) return { rows: [], rowCount: 0 };
        const before = { ...row };
        row.availability = "retired";
        row.stock = 0;
        row.retired_at = row.retired_at ?? new Date().toISOString();
        row.retired_by = row.retired_by ?? retiredBy;
        undoLog.push(() => Object.assign(row, before));
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE reward_redemptions SET status = 'processing'")) {
        const [id, approvedBy, newVersion, expectedVersion] = params as [
          string,
          string,
          number,
          number,
        ];
        const row = state.redemptions.find((r) => r.id === id);
        if (!row || row.version !== expectedVersion) return { rows: [], rowCount: 0 };
        const before = { ...row };
        row.status = "processing";
        row.approved_by = approvedBy;
        row.approved_at = new Date().toISOString();
        row.version = newVersion;
        undoLog.push(() => Object.assign(row, before));
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE reward_redemptions SET status = 'cancelled'")) {
        const [id, approvedBy, newVersion, expectedVersion] = params as [
          string,
          string,
          number,
          number,
        ];
        const row = state.redemptions.find((r) => r.id === id);
        if (!row || row.version !== expectedVersion) return { rows: [], rowCount: 0 };
        const before = { ...row };
        row.status = "cancelled";
        row.approved_by = approvedBy;
        row.approved_at = new Date().toISOString();
        row.version = newVersion;
        undoLog.push(() => Object.assign(row, before));
        return { rows: [], rowCount: 1 };
      }
      // --- GyFTR fulfillment settle (attemptGyFTRFulfillment) --------------
      if (sql.startsWith("UPDATE reward_redemptions SET status = 'fulfilled'")) {
        const [id, fulfillmentRef, voucherCode, expiresAt, newVersion, expectedVersion] =
          params as [string, string, string, string, number, number];
        const row = state.redemptions.find((r) => r.id === id);
        if (!row || row.version !== expectedVersion) return { rows: [], rowCount: 0 };
        const before = { ...row };
        row.status = "fulfilled";
        row.fulfillment_provider = "gyftr";
        row.fulfillment_reference = fulfillmentRef;
        row.fulfillment_voucher_code = voucherCode;
        row.fulfillment_expires_at = expiresAt;
        row.fulfilled_at = new Date().toISOString();
        row.failure_reason = null;
        row.version = newVersion;
        undoLog.push(() => Object.assign(row, before));
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("UPDATE reward_redemptions SET status = 'failed'")) {
        const [id, reason, newVersion, expectedVersion] = params as [
          string,
          string,
          number,
          number,
        ];
        const row = state.redemptions.find((r) => r.id === id);
        if (!row || row.version !== expectedVersion) return { rows: [], rowCount: 0 };
        const before = { ...row };
        row.status = "failed";
        row.failure_reason = reason;
        row.version = newVersion;
        undoLog.push(() => Object.assign(row, before));
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unhandled statement inside transaction: ${sql}`);
    }

    return {
      query: async (sql: string, params: unknown[] = []) => {
        const text = String(sql).trim();
        const upper = text.toUpperCase();
        if (upper === "BEGIN") {
          undoLog = [];
          heldKeys = [];
          return { rows: [], rowCount: 0 };
        }
        if (upper === "COMMIT") {
          releaseAll();
          undoLog = [];
          return { rows: [], rowCount: 0 };
        }
        if (upper === "ROLLBACK") {
          for (let i = undoLog.length - 1; i >= 0; i -= 1) undoLog[i]();
          undoLog = [];
          releaseAll();
          return { rows: [], rowCount: 0 };
        }
        return handle(text.replace(/\s+/g, " "), params);
      },
      release: () => undefined,
    };
  }

  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const originalConnect = pool.connect.bind(pool);
    const originalQuery = pool.query.bind(pool);

    pool.connect = (async () => createClient()) as typeof pool.connect;
    pool.query = (async (sql: string, params: unknown[] = []) =>
      handleRead(String(sql).trim().replace(/\s+/g, " "), params)) as typeof pool.query;

    return {
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
        pool.query = originalQuery as typeof pool.query;
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Request + reservation
// ---------------------------------------------------------------------------

test("requestRewardRedemption reserves points and stock atomically", async () => {
  const state = createRewardState();
  const harness = await installFakePool(state)();
  try {
    const { requestRewardRedemption } = await import("@/server/reward-commands.server");
    const result = await requestRewardRedemption({
      actor: partnerActor(),
      data: {
        rewardId: "reward-1",
        shippingName: "Asha Partner",
        shippingAddress: "Mumbai",
        notes: null,
        idempotencyKey: "request-1",
      },
    });

    expect(result.ok).toBe(true);
    expect(state.catalog[0]?.stock).toBe(0);
    expect(state.redemptions).toHaveLength(1);
    expect(state.redemptions[0]?.status).toBe("points_reserved");
    expect(state.pointEvents.map((event) => event.points_delta)).toContain(-500);
  } finally {
    harness.restore();
  }
});

test("request replay returns one logical reservation", async () => {
  const state = createRewardState();
  const harness = await installFakePool(state)();
  try {
    const { requestRewardRedemption } = await import("@/server/reward-commands.server");
    const requestInput = {
      actor: partnerActor(),
      data: {
        rewardId: "reward-1",
        shippingName: "Asha Partner",
        shippingAddress: "Mumbai",
        notes: null,
        idempotencyKey: "request-replay",
      },
    };
    const first = await requestRewardRedemption(requestInput);
    const replay = await requestRewardRedemption(requestInput);
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    expect(state.redemptions).toHaveLength(1);
    expect(
      state.pointEvents.filter((event) => event.source_type === "redemption_reservation"),
    ).toHaveLength(1);
    expect(state.catalog[0]?.stock).toBe(0);
  } finally {
    harness.restore();
  }
});

test("requestRewardRedemption rejects insufficient points without any side effect", async () => {
  const state = createRewardState({
    catalog: [
      {
        id: "reward-1",
        title: "Expensive item",
        points_cost: 5000,
        stock: 3,
        availability: "available",
        retired_at: null,
        retired_by: null,
      },
    ],
  });
  const harness = await installFakePool(state)();
  try {
    const { requestRewardRedemption } = await import("@/server/reward-commands.server");
    const result = await requestRewardRedemption({
      actor: partnerActor(),
      data: {
        rewardId: "reward-1",
        shippingName: "Asha Partner",
        shippingAddress: "Mumbai",
        notes: null,
        idempotencyKey: "insufficient-points",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("VALIDATION_FAILED");
    expect(state.redemptions).toHaveLength(0);
    expect(state.pointEvents).toHaveLength(1);
    expect(state.catalog[0]?.stock).toBe(3);
  } finally {
    harness.restore();
  }
});

test("requestRewardRedemption rejects out-of-stock, retired, and unavailable items", async () => {
  const state = createRewardState({
    catalog: [
      {
        id: "reward-oos",
        title: "Out of stock",
        points_cost: 100,
        stock: 0,
        availability: "available",
        retired_at: null,
        retired_by: null,
      },
      {
        id: "reward-retired",
        title: "Retired",
        points_cost: 100,
        stock: 5,
        availability: "retired",
        retired_at: "2026-07-01T00:00:00.000Z",
        retired_by: ADMIN_USER_ID,
      },
    ],
  });
  const harness = await installFakePool(state)();
  try {
    const { requestRewardRedemption } = await import("@/server/reward-commands.server");
    for (const rewardId of ["reward-oos", "reward-retired"]) {
      const result = await requestRewardRedemption({
        actor: partnerActor(),
        data: {
          rewardId,
          shippingName: "Asha Partner",
          shippingAddress: "Mumbai",
          notes: null,
          idempotencyKey: `key-${rewardId}`,
        },
      });
      expect(result.ok).toBe(false);
    }
    expect(state.redemptions).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("requestRewardRedemption denies a LIVEY-internal role and a restricted distributor", async () => {
  const state = createRewardState();
  const harness = await installFakePool(state)();
  try {
    const { requestRewardRedemption } = await import("@/server/reward-commands.server");
    for (const role of ["livey_support", "restricted_distributor"] as const) {
      const result = await requestRewardRedemption({
        actor: buildActor({
          userId: PARTNER_USER_ID,
          roleKey: role,
          teamDomain: role === "livey_support" ? "support" : "partner_success",
          partnerId: role === "restricted_distributor" ? "partner-1" : null,
        }),
        data: {
          rewardId: "reward-1",
          shippingName: "Asha Partner",
          shippingAddress: "Mumbai",
          notes: null,
          idempotencyKey: `key-${role}`,
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
    }
    expect(state.redemptions).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("requestRewardRedemption denies a partner actor with no partner assignment", async () => {
  const state = createRewardState();
  const harness = await installFakePool(state)();
  try {
    const { requestRewardRedemption } = await import("@/server/reward-commands.server");
    const result = await requestRewardRedemption({
      actor: partnerActor({ partnerId: null }),
      data: {
        rewardId: "reward-1",
        shippingName: "Asha Partner",
        shippingAddress: "Mumbai",
        notes: null,
        idempotencyKey: "no-partner",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});

test("requestRewardRedemption rolls back redemption, ledger, and stock when Activity insert fails", async () => {
  const state = createRewardState({ failNextActivityInsert: true });
  const harness = await installFakePool(state)();
  try {
    const { requestRewardRedemption } = await import("@/server/reward-commands.server");
    await expect(
      requestRewardRedemption({
        actor: partnerActor(),
        data: {
          rewardId: "reward-1",
          shippingName: "Asha Partner",
          shippingAddress: "Mumbai",
          notes: null,
          idempotencyKey: "rollback-key",
        },
      }),
    ).rejects.toThrow();

    expect(state.redemptions).toHaveLength(0);
    expect(state.pointEvents).toHaveLength(1);
    expect(state.catalog[0]?.stock).toBe(1);
  } finally {
    harness.restore();
  }
});

test("two concurrent requests against the last stock unit produce exactly one reservation", async () => {
  const state = createRewardState({
    profiles: [
      { id: PARTNER_USER_ID, partner_id: "partner-1" },
      { id: "33333333-3333-3333-3333-333333333333", partner_id: "partner-1" },
    ],
    pointEvents: [
      {
        id: "seed-award-1",
        user_id: PARTNER_USER_ID,
        partner_id: "partner-1",
        source_type: "deal_win",
        source_id: "deal-1",
        points_delta: 500,
        reason: "Deal Award",
        idempotency_key: null,
        reversal_of: null,
      },
      {
        id: "seed-award-2",
        user_id: "33333333-3333-3333-3333-333333333333",
        partner_id: "partner-1",
        source_type: "deal_win",
        source_id: "deal-2",
        points_delta: 500,
        reason: "Deal Award",
        idempotency_key: null,
        reversal_of: null,
      },
    ],
  });
  const harness = await installFakePool(state)();
  try {
    const { requestRewardRedemption } = await import("@/server/reward-commands.server");
    const secondActor = buildActor({
      userId: "33333333-3333-3333-3333-333333333333",
      roleKey: "partner_user",
      teamDomain: "partner_success",
      partnerId: "partner-1",
    });

    const [first, second] = await Promise.all([
      requestRewardRedemption({
        actor: partnerActor(),
        data: {
          rewardId: "reward-1",
          shippingName: "Racer A",
          shippingAddress: "Mumbai",
          notes: null,
          idempotencyKey: "race-a",
        },
      }),
      requestRewardRedemption({
        actor: secondActor,
        data: {
          rewardId: "reward-1",
          shippingName: "Racer B",
          shippingAddress: "Delhi",
          notes: null,
          idempotencyKey: "race-b",
        },
      }),
    ]);

    const results = [first, second];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(state.catalog[0]?.stock).toBe(0);
    expect(state.redemptions).toHaveLength(1);
  } finally {
    harness.restore();
  }
});

test("two concurrent requests whose combined cost exceeds balance produce at most one accepted reservation", async () => {
  const state = createRewardState({
    catalog: [
      {
        id: "reward-1",
        title: "LIVEY Hoodie",
        points_cost: 500,
        stock: 2,
        availability: "available",
        retired_at: null,
        retired_by: null,
      },
    ],
  });
  const harness = await installFakePool(state)();
  try {
    const { requestRewardRedemption } = await import("@/server/reward-commands.server");
    const actor = partnerActor();

    const [first, second] = await Promise.all([
      requestRewardRedemption({
        actor,
        data: {
          rewardId: "reward-1",
          shippingName: "Racer A",
          shippingAddress: "Mumbai",
          notes: null,
          idempotencyKey: "race-c",
        },
      }),
      requestRewardRedemption({
        actor,
        data: {
          rewardId: "reward-1",
          shippingName: "Racer A again",
          shippingAddress: "Mumbai",
          notes: null,
          idempotencyKey: "race-d",
        },
      }),
    ]);

    const results = [first, second];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(currentBalance(state, PARTNER_USER_ID)).toBeGreaterThanOrEqual(0);
    expect(state.redemptions).toHaveLength(1);
  } finally {
    harness.restore();
  }
});

// ---------------------------------------------------------------------------
// Review: approve / reject
// ---------------------------------------------------------------------------

function seedReservedRedemption(state: RewardHarnessState) {
  state.catalog[0]!.stock = 0;
  state.redemptions.push({
    id: "redemption-1",
    reward_id: "reward-1",
    user_id: PARTNER_USER_ID,
    partner_id: "partner-1",
    points_cost: 500,
    status: "points_reserved",
    idempotency_key: "seed-request",
    version: 1,
    approved_by: null,
    approved_at: null,
    fulfillment_provider: null,
    fulfillment_reference: null,
    fulfillment_voucher_code: null,
    fulfillment_expires_at: null,
    fulfilled_at: null,
    failure_reason: null,
  });
  state.pointEvents.push({
    id: "reservation-event-1",
    user_id: PARTNER_USER_ID,
    partner_id: "partner-1",
    source_type: "redemption_reservation",
    source_id: "redemption-1",
    points_delta: -500,
    reason: "Reserved for LIVEY Hoodie",
    idempotency_key: "seed-request:reservation",
    reversal_of: null,
  });
}

test("approveRewardRedemption advances to processing without a second debit, then auto-fulfills via the GyFTR stub when no credentials are configured", async () => {
  const state = createRewardState();
  seedReservedRedemption(state);
  const harness = await installFakePool(state)();
  try {
    const { approveRewardRedemption } = await import("@/server/reward-commands.server");
    const result = await approveRewardRedemption({
      actor: adminActor(),
      redemptionId: "redemption-1",
      expectedVersion: 1,
    });
    // The approval step itself: version bump 1 -> 2, exactly one debit.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newVersion).toBe(2);
    expect(state.pointEvents.filter((event) => event.points_delta < 0)).toHaveLength(1);

    // No GYFTR_* credentials are configured in this test environment, so
    // issueGyFTRVoucher's own graceful stub fallback engages (see
    // src/integrations/gyftr/gyftr-client.ts). attemptGyFTRFulfillment
    // follows that honest ok:true stub result to Fulfilled — it does not
    // leave the redemption stuck at Processing, and the STUB- prefix on
    // the recorded voucher code is itself the honest signal that no real
    // provider voucher was issued (never a fabricated success).
    const settled = state.redemptions[0];
    expect(settled?.status).toBe("fulfilled");
    expect(settled?.version).toBe(3);
    expect(settled?.fulfillment_provider).toBe("gyftr");
    expect(settled?.fulfillment_voucher_code?.startsWith("STUB-")).toBe(true);
    expect(settled?.fulfilled_at).not.toBeNull();
    expect(settled?.failure_reason).toBeNull();
  } finally {
    harness.restore();
  }
});

test("approveRewardRedemption records the provider's own voucher reference when GyFTR issuance succeeds", async () => {
  const state = createRewardState();
  seedReservedRedemption(state);
  const harness = await installFakePool(state)();
  mock.module("@/integrations/gyftr", () => ({
    issueGyFTRVoucher: async () => ({
      ok: true,
      voucherCode: "GYFTR-REAL-VOUCHER-123",
      expiryDate: "2027-01-01T00:00:00.000Z",
      fulfillmentRef: "gyftr-order-abc123",
    }),
  }));
  try {
    const { approveRewardRedemption } = await import("@/server/reward-commands.server");
    const result = await approveRewardRedemption({
      actor: adminActor(),
      redemptionId: "redemption-1",
      expectedVersion: 1,
    });
    expect(result.ok).toBe(true);

    const settled = state.redemptions[0];
    expect(settled?.status).toBe("fulfilled");
    expect(settled?.fulfillment_provider).toBe("gyftr");
    expect(settled?.fulfillment_reference).toBe("gyftr-order-abc123");
    expect(settled?.fulfillment_voucher_code).toBe("GYFTR-REAL-VOUCHER-123");
    expect(settled?.fulfillment_expires_at).toBe("2027-01-01T00:00:00.000Z");
    expect(settled?.fulfilled_at).not.toBeNull();
  } finally {
    mock.module("@/integrations/gyftr", () => realGyftrModule);
    harness.restore();
  }
});

test("approveRewardRedemption records a real failure reason and never fabricates success when GyFTR issuance fails", async () => {
  const state = createRewardState();
  seedReservedRedemption(state);
  const harness = await installFakePool(state)();
  mock.module("@/integrations/gyftr", () => ({
    issueGyFTRVoucher: async () => ({
      ok: false,
      errorCode: "PROVIDER_DOWN",
      errorMessage: "simulated GyFTR outage",
    }),
  }));
  try {
    const { approveRewardRedemption } = await import("@/server/reward-commands.server");
    const result = await approveRewardRedemption({
      actor: adminActor(),
      redemptionId: "redemption-1",
      expectedVersion: 1,
    });
    // The approval transaction itself still succeeded — points were
    // reserved and the redemption moved to Processing. Only the downstream
    // fulfillment attempt failed, so approveRewardRedemption's own result
    // is unaffected by the provider outage.
    expect(result.ok).toBe(true);

    const settled = state.redemptions[0];
    expect(settled?.status).toBe("failed");
    expect(settled?.failure_reason).toBe("PROVIDER_DOWN: simulated GyFTR outage");
    expect(settled?.fulfillment_voucher_code).toBeNull();
  } finally {
    mock.module("@/integrations/gyftr", () => realGyftrModule);
    harness.restore();
  }
});

test("approveRewardRedemption denies a non-super-admin actor and a stale version", async () => {
  const state = createRewardState();
  seedReservedRedemption(state);
  const harness = await installFakePool(state)();
  try {
    const { approveRewardRedemption } = await import("@/server/reward-commands.server");
    const partnerAttempt = await approveRewardRedemption({
      actor: partnerActor(),
      redemptionId: "redemption-1",
      expectedVersion: 1,
    });
    expect(partnerAttempt.ok).toBe(false);
    if (!partnerAttempt.ok) expect(partnerAttempt.failure.code).toBe("POLICY_DENIED");

    const staleAttempt = await approveRewardRedemption({
      actor: adminActor(),
      redemptionId: "redemption-1",
      expectedVersion: 99,
    });
    expect(staleAttempt.ok).toBe(false);
    if (!staleAttempt.ok) expect(staleAttempt.failure.code).toBe("OPTIMISTIC_CONFLICT");
  } finally {
    harness.restore();
  }
});

test("rejectRewardRedemption releases the reservation and restores stock exactly once", async () => {
  const state = createRewardState();
  seedReservedRedemption(state);
  const harness = await installFakePool(state)();
  try {
    const { rejectRewardRedemption } = await import("@/server/reward-commands.server");
    const result = await rejectRewardRedemption({
      actor: adminActor(),
      redemptionId: "redemption-1",
      expectedVersion: 1,
      reason: "Unavailable",
    });
    expect(result.ok).toBe(true);
    expect(state.redemptions[0]?.status).toBe("cancelled");
    expect(state.pointEvents.map((event) => event.source_type)).toContain("reservation_release");
    expect(state.catalog[0]?.stock).toBe(1);
    expect(currentBalance(state, PARTNER_USER_ID)).toBe(500);
  } finally {
    harness.restore();
  }
});

test("rejectRewardRedemption requires a reason and cannot release the same reservation twice", async () => {
  const state = createRewardState();
  seedReservedRedemption(state);
  const harness = await installFakePool(state)();
  try {
    const { rejectRewardRedemption } = await import("@/server/reward-commands.server");
    const missingReason = await rejectRewardRedemption({
      actor: adminActor(),
      redemptionId: "redemption-1",
      expectedVersion: 1,
      reason: "   ",
    });
    expect(missingReason.ok).toBe(false);
    if (!missingReason.ok) expect(missingReason.failure.code).toBe("VALIDATION_FAILED");

    const first = await rejectRewardRedemption({
      actor: adminActor(),
      redemptionId: "redemption-1",
      expectedVersion: 1,
      reason: "Unavailable",
    });
    expect(first.ok).toBe(true);

    const second = await rejectRewardRedemption({
      actor: adminActor(),
      redemptionId: "redemption-1",
      expectedVersion: 2,
      reason: "Unavailable",
    });
    expect(second.ok).toBe(false);

    expect(
      state.pointEvents.filter((event) => event.source_type === "reservation_release"),
    ).toHaveLength(1);
    expect(state.catalog[0]?.stock).toBe(1);
  } finally {
    harness.restore();
  }
});

test("approveRewardRedemption cannot be replayed to charge points a second time", async () => {
  const state = createRewardState();
  seedReservedRedemption(state);
  const harness = await installFakePool(state)();
  try {
    const { approveRewardRedemption } = await import("@/server/reward-commands.server");
    const first = await approveRewardRedemption({
      actor: adminActor(),
      redemptionId: "redemption-1",
      expectedVersion: 1,
    });
    expect(first.ok).toBe(true);

    const replay = await approveRewardRedemption({
      actor: adminActor(),
      redemptionId: "redemption-1",
      expectedVersion: 1,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.failure.code).toBe("OPTIMISTIC_CONFLICT");
    expect(state.pointEvents.filter((event) => event.points_delta < 0)).toHaveLength(1);
  } finally {
    harness.restore();
  }
});

// ---------------------------------------------------------------------------
// Catalogue retirement
// ---------------------------------------------------------------------------

test("retireRewardCatalogItem preserves existing redemptions and blocks new requests", async () => {
  const state = createRewardState();
  seedReservedRedemption(state);
  const harness = await installFakePool(state)();
  try {
    const { retireRewardCatalogItem, requestRewardRedemption } =
      await import("@/server/reward-commands.server");
    const result = await retireRewardCatalogItem({ actor: adminActor(), rewardId: "reward-1" });
    expect(result.ok).toBe(true);
    expect(state.catalog[0]?.availability).toBe("retired");
    expect(state.catalog[0]?.stock).toBe(0);
    expect(state.redemptions).toHaveLength(1);

    const denied = await requestRewardRedemption({
      actor: partnerActor(),
      data: {
        rewardId: "reward-1",
        shippingName: "Asha Partner",
        shippingAddress: "Mumbai",
        notes: null,
        idempotencyKey: "after-retire",
      },
    });
    expect(denied.ok).toBe(false);
  } finally {
    harness.restore();
  }
});

test("retireRewardCatalogItem is idempotent and requires super_admin", async () => {
  const state = createRewardState();
  const harness = await installFakePool(state)();
  try {
    const { retireRewardCatalogItem } = await import("@/server/reward-commands.server");
    const partnerAttempt = await retireRewardCatalogItem({
      actor: partnerActor(),
      rewardId: "reward-1",
    });
    expect(partnerAttempt.ok).toBe(false);

    const first = await retireRewardCatalogItem({ actor: adminActor(), rewardId: "reward-1" });
    expect(first.ok).toBe(true);
    const retiredAt = state.catalog[0]?.retired_at;

    const second = await retireRewardCatalogItem({ actor: adminActor(), rewardId: "reward-1" });
    expect(second.ok).toBe(true);
    expect(state.catalog[0]?.retired_at).toBe(retiredAt);
  } finally {
    harness.restore();
  }
});

// ---------------------------------------------------------------------------
// Manual adjustment
// ---------------------------------------------------------------------------

test("adjustRewardPoints requires super_admin, a non-zero delta, and a reason", async () => {
  const state = createRewardState();
  const harness = await installFakePool(state)();
  try {
    const { adjustRewardPoints } = await import("@/server/reward-commands.server");
    const partnerAttempt = await adjustRewardPoints({
      actor: partnerActor(),
      data: { userId: PARTNER_USER_ID, pointsDelta: 100, reason: "Bonus", idempotencyKey: "adj-1" },
    });
    expect(partnerAttempt.ok).toBe(false);

    const zeroDelta = await adjustRewardPoints({
      actor: adminActor(),
      data: { userId: PARTNER_USER_ID, pointsDelta: 0, reason: "Bonus", idempotencyKey: "adj-2" },
    });
    expect(zeroDelta.ok).toBe(false);

    const noReason = await adjustRewardPoints({
      actor: adminActor(),
      data: { userId: PARTNER_USER_ID, pointsDelta: 100, reason: "  ", idempotencyKey: "adj-3" },
    });
    expect(noReason.ok).toBe(false);
    expect(state.pointEvents).toHaveLength(1);
  } finally {
    harness.restore();
  }
});

test("adjustRewardPoints rejects a debit that would make the balance negative", async () => {
  const state = createRewardState();
  const harness = await installFakePool(state)();
  try {
    const { adjustRewardPoints } = await import("@/server/reward-commands.server");
    const result = await adjustRewardPoints({
      actor: adminActor(),
      data: {
        userId: PARTNER_USER_ID,
        pointsDelta: -1000,
        reason: "Correction",
        idempotencyKey: "adj-negative",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("VALIDATION_FAILED");
    expect(state.pointEvents).toHaveLength(1);
  } finally {
    harness.restore();
  }
});

test("adjustRewardPoints replay creates exactly one ledger entry", async () => {
  const state = createRewardState();
  const harness = await installFakePool(state)();
  try {
    const { adjustRewardPoints } = await import("@/server/reward-commands.server");
    const input = {
      actor: adminActor(),
      data: {
        userId: PARTNER_USER_ID,
        pointsDelta: 200,
        reason: "Bonus",
        idempotencyKey: "adj-replay",
      },
    };
    const first = await adjustRewardPoints(input);
    const replay = await adjustRewardPoints(input);
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    expect(
      state.pointEvents.filter((event) => event.idempotency_key === "adj-replay"),
    ).toHaveLength(1);
    expect(currentBalance(state, PARTNER_USER_ID)).toBe(700);
  } finally {
    harness.restore();
  }
});

// ---------------------------------------------------------------------------
// Generic reward ledger/lifecycle writes and catalogue deletes are denied
// (table-policy coverage lives in table-policy.server.test.ts; this suite
// only proves the command layer's own authority boundaries.)
// ---------------------------------------------------------------------------

test("review commands reject an unrecognised or already-terminal redemption state", async () => {
  const state = createRewardState();
  state.catalog[0]!.stock = 0;
  state.redemptions.push({
    id: "redemption-done",
    reward_id: "reward-1",
    user_id: PARTNER_USER_ID,
    partner_id: "partner-1",
    points_cost: 500,
    status: "processing",
    idempotency_key: "seed-done",
    version: 2,
    approved_by: ADMIN_USER_ID,
    approved_at: ISSUED_AT,
    fulfillment_provider: null,
    fulfillment_reference: null,
    fulfillment_voucher_code: null,
    fulfillment_expires_at: null,
    fulfilled_at: null,
    failure_reason: null,
  });
  const harness = await installFakePool(state)();
  try {
    const { approveRewardRedemption, rejectRewardRedemption } =
      await import("@/server/reward-commands.server");
    const approveAgain = await approveRewardRedemption({
      actor: adminActor(),
      redemptionId: "redemption-done",
      expectedVersion: 2,
    });
    expect(approveAgain.ok).toBe(false);

    const rejectAfterProcessing = await rejectRewardRedemption({
      actor: adminActor(),
      redemptionId: "redemption-done",
      expectedVersion: 2,
      reason: "Too late",
    });
    expect(rejectAfterProcessing.ok).toBe(false);
  } finally {
    harness.restore();
  }
});
