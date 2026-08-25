import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import { FEATURE_KEYS, type FeatureKey } from "@/domain/contracts/features";
import type { DistributionActor } from "@/server/distribution-policy.server";
import type { FeatureCapabilities } from "@/server/rbac-policy.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

const ISSUED_AT = "2026-08-25T00:00:00.000Z";
const ADMIN_USER = "66666666-6666-6666-6666-666666666666";
const WAREHOUSE = "10000000-0000-0000-0000-000000000001";
const STORE = "20000000-0000-0000-0000-000000000002";
const SKU = "30000000-0000-0000-0000-000000000003";

function buildActor(overrides: Partial<AssignmentRecord> = {}): DistributionActor {
  const assignment: AssignmentRecord = {
    assignmentId: "assignment-admin",
    userId: ADMIN_USER,
    tenantId: "tenant-livey-org",
    organizationTenantId: "tenant-livey-org",
    roleKey: "super_admin",
    teamDomain: "identity",
    geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    partnerId: null,
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
  const activeContext: ActiveContextRecord = {
    contextId: "context-1",
    userId: assignment.userId,
    assignmentId: assignment.assignmentId,
    assignmentStatus: assignment.status,
    tenantId: assignment.tenantId,
    organizationTenantId: assignment.organizationTenantId,
    workingScope: null,
    issuedAt: ISSUED_AT,
    expiresAt: "2026-08-25T08:00:00.000Z",
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
  };
  return { userId: assignment.userId, assignment, activeContext };
}

const admin = () => buildActor();
const distributor = () =>
  buildActor({
    assignmentId: "assignment-distributor",
    userId: "11111111-1111-1111-1111-111111111111",
    roleKey: "restricted_distributor",
    teamDomain: "logistics",
    partnerId: "partner-1",
  });

function fullCapabilities(): FeatureCapabilities {
  const capabilities = {} as FeatureCapabilities;
  for (const feature of FEATURE_KEYS) {
    capabilities[feature as FeatureKey] = {
      create: true,
      read: true,
      update: true,
      delete: false,
    };
  }
  return capabilities;
}

const DEPS = {
  resolveSurface: async () => true,
  loadCapabilities: async () => fullCapabilities(),
};

// ---------------------------------------------------------------------------
// In-memory transactional harness with real FOR UPDATE blocking, so the
// concurrency tests below actually exercise the locking they claim to.
// ---------------------------------------------------------------------------

type BalanceRow = {
  id: string;
  product_sku_id: string;
  location_id: string;
  on_hand_quantity: number;
  reserved_quantity: number;
  damaged_quantity: number;
  in_transit_quantity: number;
  version: number;
};

type MovementRow = Record<string, unknown>;

type LocationRow = {
  id: string;
  location_code: string;
  location_name: string;
  location_type: string;
  distributor_assignment_id: string | null;
  custodian_assignment_id: string | null;
  active: boolean;
  version: number;
};

type HarnessState = {
  skus: Array<{ id: string; active: boolean }>;
  locations: LocationRow[];
  balances: BalanceRow[];
  movements: MovementRow[];
  activity: number;
  outbox: number;
};

function createState(overrides: Partial<HarnessState> = {}): HarnessState {
  return {
    skus: [{ id: SKU, active: true }],
    locations: [
      {
        id: WAREHOUSE,
        location_code: "WH-MUM",
        location_name: "Mumbai Warehouse",
        location_type: "livey_warehouse",
        distributor_assignment_id: null,
        custodian_assignment_id: "assignment-custodian",
        active: true,
        version: 1,
      },
      {
        id: STORE,
        location_code: "DS-PUN",
        location_name: "Pune Distributor Store",
        location_type: "distributor",
        distributor_assignment_id: "assignment-distributor",
        custodian_assignment_id: null,
        active: true,
        version: 1,
      },
    ],
    balances: [],
    movements: [],
    activity: 0,
    outbox: 0,
    ...overrides,
  };
}

function createLockManager() {
  const held = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();
  return {
    async acquire(key: string) {
      if (!held.has(key)) {
        held.add(key);
        return;
      }
      await new Promise<void>((resolve) => {
        const queue = waiters.get(key) ?? [];
        queue.push(resolve);
        waiters.set(key, queue);
      });
    },
    release(key: string) {
      const next = waiters.get(key)?.shift();
      if (next) {
        next();
        return;
      }
      held.delete(key);
    },
  };
}

function installFakePool(state: HarnessState) {
  const locks = createLockManager();

  function createClient() {
    let heldKeys: string[] = [];
    let undo: Array<() => void> = [];

    async function lock(key: string) {
      // Postgres re-entrant locking: a transaction that already holds a row
      // lock can SELECT ... FOR UPDATE the same row again without blocking.
      // Without this the fake deadlocks against itself the moment a command
      // reads a balance and then moves it.
      if (heldKeys.includes(key)) return;
      await locks.acquire(key);
      heldKeys.push(key);
    }
    function releaseAll() {
      for (const key of heldKeys) locks.release(key);
      heldKeys = [];
    }

    async function handle(sql: string, params: unknown[]) {
      if (sql.startsWith("SELECT sku.id FROM product_skus sku")) {
        const sku = state.skus.find((row) => row.id === params[0] && row.active);
        return { rows: sku ? [{ id: sku.id }] : [], rowCount: sku ? 1 : 0 };
      }
      if (sql.startsWith("SELECT id FROM stock_locations WHERE id = $1 AND active = TRUE")) {
        const loc = state.locations.find((row) => row.id === params[0] && row.active);
        return { rows: loc ? [{ id: loc.id }] : [], rowCount: loc ? 1 : 0 };
      }
      if (sql.startsWith("INSERT INTO inventory_balances (product_sku_id, location_id)")) {
        const [skuId, locationId] = params as [string, string];
        const exists = state.balances.some(
          (row) => row.product_sku_id === skuId && row.location_id === locationId,
        );
        if (!exists) {
          const row: BalanceRow = {
            id: `bal-${skuId}-${locationId}`,
            product_sku_id: skuId,
            location_id: locationId,
            on_hand_quantity: 0,
            reserved_quantity: 0,
            damaged_quantity: 0,
            in_transit_quantity: 0,
            version: 1,
          };
          state.balances.push(row);
          undo.push(() => {
            state.balances = state.balances.filter((candidate) => candidate !== row);
          });
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("SELECT id, product_sku_id, location_id, on_hand_quantity")) {
        const [skuId, locationId] = params as [string, string];
        await lock(`balance:${skuId}:${locationId}`);
        const row = state.balances.find(
          (candidate) => candidate.product_sku_id === skuId && candidate.location_id === locationId,
        );
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.startsWith("SELECT id FROM inventory_movements WHERE idempotency_key")) {
        const row = state.movements.find((m) => m.idempotency_key === params[0]);
        return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.startsWith("UPDATE inventory_balances")) {
        const [id, onHand, reserved, damaged, inTransit, newVersion, expectedVersion] = params as [
          string,
          number,
          number,
          number,
          number,
          number,
          number,
        ];
        const row = state.balances.find((candidate) => candidate.id === id);
        if (!row || row.version !== expectedVersion) return { rows: [], rowCount: 0 };
        const before = { ...row };
        Object.assign(row, {
          on_hand_quantity: onHand,
          reserved_quantity: reserved,
          damaged_quantity: damaged,
          in_transit_quantity: inTransit,
          version: newVersion,
        });
        undo.push(() => Object.assign(row, before));
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO inventory_movements")) {
        const key = params[12] as string;
        if (state.movements.some((m) => m.idempotency_key === key)) {
          const error = new Error("duplicate key") as Error & { code: string };
          error.code = "23505";
          throw error;
        }
        const row: MovementRow = {
          id: params[0],
          movement_type: params[1],
          product_sku_id: params[2],
          source_location_id: params[3],
          destination_location_id: params[4],
          quantity: params[5],
          request_id: params[6],
          request_line_id: params[7],
          actor_user_id: params[8],
          assignment_id: params[9],
          reason: params[10],
          correlation_id: params[11],
          idempotency_key: key,
          source_on_hand_before: params[13],
          source_on_hand_after: params[14],
          source_reserved_before: params[15],
          source_reserved_after: params[16],
          source_damaged_before: params[17],
          source_damaged_after: params[18],
          destination_on_hand_before: params[19],
          destination_on_hand_after: params[20],
          destination_in_transit_before: params[21],
          destination_in_transit_after: params[22],
        };
        state.movements.push(row);
        undo.push(() => {
          state.movements = state.movements.filter((candidate) => candidate !== row);
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO stock_locations")) {
        const code = params[1] as string;
        if (state.locations.some((row) => row.location_code === code)) {
          const error = new Error("duplicate key") as Error & { code: string };
          error.code = "23505";
          throw error;
        }
        const row: LocationRow = {
          id: params[0] as string,
          location_code: code,
          location_name: params[2] as string,
          location_type: params[3] as string,
          distributor_assignment_id: (params[7] as string | null) ?? null,
          custodian_assignment_id: (params[8] as string | null) ?? null,
          active: true,
          version: 1,
        };
        state.locations.push(row);
        undo.push(() => {
          state.locations = state.locations.filter((candidate) => candidate !== row);
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("SELECT id, version, active FROM stock_locations")) {
        await lock(`location:${params[0]}`);
        const row = state.locations.find((candidate) => candidate.id === params[0]);
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.startsWith("UPDATE stock_locations SET active = FALSE")) {
        const [id, newVersion, expectedVersion] = params as [string, number, number];
        const row = state.locations.find((candidate) => candidate.id === id);
        if (!row || row.version !== expectedVersion) return { rows: [], rowCount: 0 };
        const before = { ...row };
        row.active = false;
        row.version = newVersion;
        undo.push(() => Object.assign(row, before));
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO domain_activity_events")) {
        state.activity += 1;
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO command_outbox")) {
        state.outbox += 1;
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unhandled statement: ${sql}`);
    }

    return {
      query: async (sql: string, params: unknown[] = []) => {
        const text = String(sql).trim().replace(/\s+/g, " ");
        const upper = text.toUpperCase();
        if (upper === "BEGIN") {
          undo = [];
          heldKeys = [];
          return { rows: [], rowCount: 0 };
        }
        if (upper === "COMMIT") {
          releaseAll();
          undo = [];
          return { rows: [], rowCount: 0 };
        }
        if (upper === "ROLLBACK") {
          for (let i = undo.length - 1; i >= 0; i -= 1) undo[i]!();
          undo = [];
          releaseAll();
          return { rows: [], rowCount: 0 };
        }
        return handle(text, params);
      },
      release: () => undefined,
    };
  }

  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const originalConnect = pool.connect.bind(pool);
    pool.connect = (async () => createClient()) as unknown as typeof pool.connect;
    return {
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

function balanceAt(state: HarnessState, locationId: string) {
  return state.balances.find((row) => row.location_id === locationId && row.product_sku_id === SKU);
}

async function post(state: HarnessState, data: Record<string, unknown>, actor = admin()) {
  const { postManualStockMovement } = await import("@/server/distribution-commands.server");
  return postManualStockMovement({
    actor,
    data: {
      movementType: "opening_balance",
      productSkuId: SKU,
      destinationLocationId: WAREHOUSE,
      quantity: 10,
      reason: "Opening count",
      idempotencyKey: `key-${Math.round(Number(data.quantity ?? 0))}-${String(data.movementType ?? "opening_balance")}`,
      ...data,
    } as never,
    deps: DEPS,
  });
}

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

test("only Super Admin can create a location or post a manual movement", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    const { createStockLocation } = await import("@/server/distribution-commands.server");
    const created = await createStockLocation({
      actor: distributor(),
      data: {
        locationCode: "DS-NEW",
        locationName: "New Store",
        locationType: "distributor",
        geographyNodeId: "geo-in",
        distributorAssignmentId: "assignment-distributor",
      },
      deps: DEPS,
    });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.failure.code).toBe("POLICY_DENIED");

    const posted = await post(state, {}, distributor());
    expect(posted.ok).toBe(false);
    if (!posted.ok) expect(posted.failure.code).toBe("POLICY_DENIED");
    expect(state.movements).toHaveLength(0);
    expect(state.locations).toHaveLength(2);
  } finally {
    harness.restore();
  }
});

test("a disabled distribution surface denies Super Admin too", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    const { postManualStockMovement } = await import("@/server/distribution-commands.server");
    const result = await postManualStockMovement({
      actor: admin(),
      data: {
        movementType: "opening_balance",
        productSkuId: SKU,
        destinationLocationId: WAREHOUSE,
        quantity: 5,
        reason: "Opening count",
        idempotencyKey: "surface-off",
      },
      deps: { resolveSurface: async () => false, loadCapabilities: async () => fullCapabilities() },
    });
    expect(result.ok).toBe(false);
    expect(state.movements).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

test("a distributor location needs an owner and a warehouse must not have one", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    const { createStockLocation } = await import("@/server/distribution-commands.server");

    const ownerless = await createStockLocation({
      actor: admin(),
      data: {
        locationCode: "DS-BAD",
        locationName: "Ownerless Store",
        locationType: "distributor",
        geographyNodeId: "geo-in",
        distributorAssignmentId: null,
      },
      deps: DEPS,
    });
    expect(ownerless.ok).toBe(false);

    const ownedWarehouse = await createStockLocation({
      actor: admin(),
      data: {
        locationCode: "WH-BAD",
        locationName: "Owned Warehouse",
        locationType: "livey_warehouse",
        geographyNodeId: "geo-in",
        distributorAssignmentId: "assignment-distributor",
      },
      deps: DEPS,
    });
    expect(ownedWarehouse.ok).toBe(false);
    expect(state.locations).toHaveLength(2);
  } finally {
    harness.restore();
  }
});

test("retiring a location deactivates it and never deletes it", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    const { retireStockLocation } = await import("@/server/distribution-commands.server");
    const result = await retireStockLocation({
      actor: admin(),
      locationId: STORE,
      expectedVersion: 1,
      reason: "Store closed",
      deps: DEPS,
    });
    expect(result.ok).toBe(true);
    expect(state.locations).toHaveLength(2);
    expect(state.locations.find((row) => row.id === STORE)?.active).toBe(false);

    const stale = await retireStockLocation({
      actor: admin(),
      locationId: STORE,
      expectedVersion: 1,
      reason: "Store closed",
      deps: DEPS,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.failure.code).toBe("OPTIMISTIC_CONFLICT");
  } finally {
    harness.restore();
  }
});

test("a location cannot be retired without a reason", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    const { retireStockLocation } = await import("@/server/distribution-commands.server");
    const result = await retireStockLocation({
      actor: admin(),
      locationId: STORE,
      expectedVersion: 1,
      reason: "   ",
      deps: DEPS,
    });
    expect(result.ok).toBe(false);
    expect(state.locations.find((row) => row.id === STORE)?.active).toBe(true);
  } finally {
    harness.restore();
  }
});

// ---------------------------------------------------------------------------
// Movements
// ---------------------------------------------------------------------------

test("an opening balance establishes on-hand stock and records full evidence", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    const result = await post(state, { quantity: 10 });
    expect(result.ok).toBe(true);

    expect(balanceAt(state, WAREHOUSE)?.on_hand_quantity).toBe(10);
    const movement = state.movements[0]!;
    expect(movement.movement_type).toBe("opening_balance");
    expect(movement.actor_user_id).toBe(ADMIN_USER);
    expect(movement.assignment_id).toBe("assignment-admin");
    expect(movement.reason).toBe("Opening count");
    expect(movement.correlation_id).toBeTruthy();
    expect(movement.destination_on_hand_before).toBe(0);
    expect(movement.destination_on_hand_after).toBe(10);
    expect(state.activity).toBe(1);
    expect(state.outbox).toBe(1);
  } finally {
    harness.restore();
  }
});

test("zero, negative, and fractional quantities are refused with no write", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    for (const quantity of [0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await post(state, { quantity, idempotencyKey: `bad-${quantity}` });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.code).toBe("VALIDATION_FAILED");
    }
    expect(state.movements).toHaveLength(0);
    expect(state.balances).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("an inactive SKU or location is refused", async () => {
  const state = createState({ skus: [{ id: SKU, active: false }] });
  const harness = await installFakePool(state)();
  try {
    const inactiveSku = await post(state, { quantity: 5, idempotencyKey: "inactive-sku" });
    expect(inactiveSku.ok).toBe(false);
    expect(state.movements).toHaveLength(0);
  } finally {
    harness.restore();
  }

  const state2 = createState();
  state2.locations[0]!.active = false;
  const harness2 = await installFakePool(state2)();
  try {
    const inactiveLocation = await post(state2, { quantity: 5, idempotencyKey: "inactive-loc" });
    expect(inactiveLocation.ok).toBe(false);
    expect(state2.movements).toHaveLength(0);
  } finally {
    harness2.restore();
  }
});

test("every manual correction requires a reason", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    const result = await post(state, { quantity: 5, reason: "   ", idempotencyKey: "no-reason" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("VALIDATION_FAILED");
    expect(state.movements).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("request-driven movement types cannot be posted by hand", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    for (const movementType of ["reservation", "reservation_release", "dispatch", "delivery"]) {
      const result = await post(state, {
        movementType,
        sourceLocationId: WAREHOUSE,
        destinationLocationId: movementType === "reservation" ? null : STORE,
        quantity: 1,
        idempotencyKey: `manual-${movementType}`,
      });
      expect(result.ok).toBe(false);
    }
    expect(state.movements).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("a transfer moves on-hand stock between locations and refuses to oversell", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await post(state, { quantity: 10, idempotencyKey: "open-10" });

    const moved = await post(state, {
      movementType: "transfer",
      sourceLocationId: WAREHOUSE,
      destinationLocationId: STORE,
      quantity: 4,
      reason: "Rebalance",
      idempotencyKey: "transfer-4",
    });
    expect(moved.ok).toBe(true);
    expect(balanceAt(state, WAREHOUSE)?.on_hand_quantity).toBe(6);
    expect(balanceAt(state, STORE)?.on_hand_quantity).toBe(4);

    const tooMuch = await post(state, {
      movementType: "transfer",
      sourceLocationId: WAREHOUSE,
      destinationLocationId: STORE,
      quantity: 99,
      reason: "Rebalance",
      idempotencyKey: "transfer-99",
    });
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.failure.message).toContain("Not enough on-hand stock");
    // Rolled back whole: neither side moved.
    expect(balanceAt(state, WAREHOUSE)?.on_hand_quantity).toBe(6);
    expect(balanceAt(state, STORE)?.on_hand_quantity).toBe(4);
  } finally {
    harness.restore();
  }
});

test("damage withdraws units from available without changing on hand", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await post(state, { quantity: 10, idempotencyKey: "open-10" });
    const damaged = await post(state, {
      movementType: "damage",
      sourceLocationId: WAREHOUSE,
      destinationLocationId: null,
      quantity: 3,
      reason: "Crushed in transit",
      idempotencyKey: "damage-3",
    });
    expect(damaged.ok).toBe(true);

    const balance = balanceAt(state, WAREHOUSE)!;
    expect(balance.on_hand_quantity).toBe(10);
    expect(balance.damaged_quantity).toBe(3);

    // Damaged units are no longer available, so a transfer of the full ten
    // must fail even though on-hand still reads ten.
    const overTransfer = await post(state, {
      movementType: "transfer",
      sourceLocationId: WAREHOUSE,
      destinationLocationId: STORE,
      quantity: 10,
      reason: "Rebalance",
      idempotencyKey: "transfer-10",
    });
    expect(overTransfer.ok).toBe(false);
  } finally {
    harness.restore();
  }
});

test("a replayed idempotency key returns success without a second movement", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    const first = await post(state, { quantity: 7, idempotencyKey: "same-key" });
    const second = await post(state, { quantity: 7, idempotencyKey: "same-key" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(state.movements).toHaveLength(1);
    expect(balanceAt(state, WAREHOUSE)?.on_hand_quantity).toBe(7);
  } finally {
    harness.restore();
  }
});

test("balance rows are locked in a stable location order regardless of direction", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await post(state, { quantity: 20, idempotencyKey: "open-wh" });
    await post(state, {
      destinationLocationId: STORE,
      quantity: 20,
      idempotencyKey: "open-store",
    });

    // WAREHOUSE sorts before STORE by id, so both directions must lock
    // warehouse first — otherwise these two would deadlock in Postgres.
    const [forward, backward] = await Promise.all([
      post(state, {
        movementType: "transfer",
        sourceLocationId: WAREHOUSE,
        destinationLocationId: STORE,
        quantity: 5,
        reason: "Rebalance",
        idempotencyKey: "fwd",
      }),
      post(state, {
        movementType: "transfer",
        sourceLocationId: STORE,
        destinationLocationId: WAREHOUSE,
        quantity: 5,
        reason: "Rebalance",
        idempotencyKey: "back",
      }),
    ]);

    expect(forward.ok).toBe(true);
    expect(backward.ok).toBe(true);
    expect(balanceAt(state, WAREHOUSE)?.on_hand_quantity).toBe(20);
    expect(balanceAt(state, STORE)?.on_hand_quantity).toBe(20);
  } finally {
    harness.restore();
  }
});

test("concurrent draws on the last units admit exactly one winner", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await post(state, { quantity: 5, idempotencyKey: "open-5" });

    const results = await Promise.all([
      post(state, {
        movementType: "transfer",
        sourceLocationId: WAREHOUSE,
        destinationLocationId: STORE,
        quantity: 5,
        reason: "Rebalance",
        idempotencyKey: "draw-a",
      }),
      post(state, {
        movementType: "transfer",
        sourceLocationId: WAREHOUSE,
        destinationLocationId: STORE,
        quantity: 5,
        reason: "Rebalance",
        idempotencyKey: "draw-b",
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(balanceAt(state, WAREHOUSE)?.on_hand_quantity).toBe(0);
    expect(balanceAt(state, STORE)?.on_hand_quantity).toBe(5);
    // The loser wrote nothing at all — one opening balance plus one transfer.
    expect(state.movements).toHaveLength(2);
  } finally {
    harness.restore();
  }
});

test("portal_catalog_items.stock is never touched by a stock movement", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    // The harness throws on any statement it does not recognise, and it
    // recognises nothing touching portal_catalog_items — so a write there
    // would fail this test rather than pass silently.
    const result = await post(state, { quantity: 12, idempotencyKey: "no-catalog-write" });
    expect(result.ok).toBe(true);
  } finally {
    harness.restore();
  }
});
