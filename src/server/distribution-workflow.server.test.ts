import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import { FEATURE_KEYS, type FeatureKey } from "@/domain/contracts/features";
import type { DistributionActor } from "@/server/distribution-policy.server";
import type { FeatureCapabilities } from "@/server/rbac-policy.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

const ISSUED_AT = "2026-08-25T00:00:00.000Z";
const DISTRIBUTOR_USER = "11111111-1111-1111-1111-111111111111";
const MANAGER_USER = "22222222-2222-2222-2222-222222222222";
const CUSTODIAN_USER = "33333333-3333-3333-3333-333333333333";
const OTHER_DISTRIBUTOR_USER = "44444444-4444-4444-4444-444444444444";
const ADMIN_USER = "66666666-6666-6666-6666-666666666666";

const WAREHOUSE = "10000000-0000-0000-0000-000000000001";
const STORE = "20000000-0000-0000-0000-000000000002";
const OTHER_STORE = "20000000-0000-0000-0000-000000000009";
const SKU_A = "30000000-0000-0000-0000-00000000000a";
const SKU_B = "30000000-0000-0000-0000-00000000000b";

function actorFor(overrides: Partial<AssignmentRecord>): DistributionActor {
  const assignment: AssignmentRecord = {
    assignmentId: "assignment-distributor",
    userId: DISTRIBUTOR_USER,
    tenantId: "tenant-livey-org",
    organizationTenantId: "tenant-livey-org",
    roleKey: "restricted_distributor",
    teamDomain: "logistics",
    geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    partnerId: "partner-1",
    accountId: null,
    portfolioId: null,
    queueId: null,
    status: "active",
    validFrom: ISSUED_AT,
    validTo: null,
    managerAssignmentId: "assignment-manager",
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
    contextId: `context-${assignment.assignmentId}`,
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

const distributor = () => actorFor({});
const otherDistributor = () =>
  actorFor({
    assignmentId: "assignment-distributor-2",
    userId: OTHER_DISTRIBUTOR_USER,
    managerAssignmentId: "assignment-manager",
  });
const manager = () =>
  actorFor({
    assignmentId: "assignment-manager",
    userId: MANAGER_USER,
    roleKey: "rm",
    teamDomain: "sales",
    partnerId: null,
    managerAssignmentId: "assignment-director",
  });
const unrelatedManager = () =>
  actorFor({
    assignmentId: "assignment-manager-9",
    userId: "55555555-5555-5555-5555-555555555555",
    roleKey: "pam",
    teamDomain: "sales",
    partnerId: null,
  });
const custodian = () =>
  actorFor({
    assignmentId: "assignment-custodian",
    userId: CUSTODIAN_USER,
    roleKey: "pam",
    teamDomain: "sales",
    partnerId: null,
  });
const superAdmin = () =>
  actorFor({
    assignmentId: "assignment-admin",
    userId: ADMIN_USER,
    roleKey: "super_admin",
    teamDomain: "identity",
    partnerId: null,
  });

function fullCapabilities(): FeatureCapabilities {
  const capabilities = {} as FeatureCapabilities;
  for (const feature of FEATURE_KEYS) {
    capabilities[feature as FeatureKey] = { create: true, read: true, update: true, delete: false };
  }
  return capabilities;
}

const DEPS = {
  resolveSurface: async () => true,
  loadCapabilities: async () => fullCapabilities(),
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

type State = {
  assignments: Array<{
    assignment_id: string;
    user_id: string;
    role_key: string;
    status: string;
    partner_id: string | null;
    manager_assignment_id: string | null;
  }>;
  skus: Array<{ id: string; sku_code: string; active: boolean }>;
  locations: Array<{
    id: string;
    location_name: string;
    active: boolean;
    distributor_assignment_id: string | null;
    custodian_assignment_id: string | null;
  }>;
  balances: Row[];
  movements: Row[];
  requests: Row[];
  lines: Row[];
  transitions: Row[];
  tasks: Row[];
  notifications: Row[];
  activity: Row[];
  outbox: Row[];
  sequence: number;
};

function createState(): State {
  return {
    assignments: [
      {
        assignment_id: "assignment-distributor",
        user_id: DISTRIBUTOR_USER,
        role_key: "restricted_distributor",
        status: "active",
        partner_id: "partner-1",
        manager_assignment_id: "assignment-manager",
      },
      {
        assignment_id: "assignment-distributor-2",
        user_id: OTHER_DISTRIBUTOR_USER,
        role_key: "restricted_distributor",
        status: "active",
        partner_id: "partner-1",
        manager_assignment_id: "assignment-manager",
      },
      {
        assignment_id: "assignment-manager",
        user_id: MANAGER_USER,
        role_key: "rm",
        status: "active",
        partner_id: null,
        manager_assignment_id: "assignment-director",
      },
      {
        assignment_id: "assignment-custodian",
        user_id: CUSTODIAN_USER,
        role_key: "pam",
        status: "active",
        partner_id: null,
        manager_assignment_id: "assignment-manager",
      },
    ],
    skus: [
      { id: SKU_A, sku_code: "LV-A", active: true },
      { id: SKU_B, sku_code: "LV-B", active: true },
    ],
    locations: [
      {
        id: WAREHOUSE,
        location_name: "Mumbai Warehouse",
        active: true,
        distributor_assignment_id: null,
        custodian_assignment_id: "assignment-custodian",
      },
      {
        id: STORE,
        location_name: "Pune Distributor Store",
        active: true,
        distributor_assignment_id: "assignment-distributor",
        custodian_assignment_id: null,
      },
      {
        id: OTHER_STORE,
        location_name: "Nagpur Distributor Store",
        active: true,
        distributor_assignment_id: "assignment-distributor-2",
        custodian_assignment_id: null,
      },
    ],
    balances: [],
    movements: [],
    requests: [],
    lines: [],
    transitions: [],
    tasks: [],
    notifications: [],
    activity: [],
    outbox: [],
    sequence: 0,
  };
}

function createLocks() {
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

function installFakePool(state: State) {
  const locks = createLocks();

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
    function track<T extends Row>(collection: T[], row: T) {
      collection.push(row);
      undo.push(() => {
        const index = collection.indexOf(row);
        if (index >= 0) collection.splice(index, 1);
      });
    }
    function mutate(row: Row, changes: Row) {
      const before = { ...row };
      Object.assign(row, changes);
      undo.push(() => Object.assign(row, before));
    }

    async function handle(
      sql: string,
      params: unknown[],
    ): Promise<{ rows: Row[]; rowCount: number }> {
      // --- assignments ---------------------------------------------------
      if (sql.startsWith("SELECT a.assignment_id, a.role_key")) {
        const row = state.assignments.find(
          (a) => a.assignment_id === params[0] && a.user_id === params[1],
        );
        if (!row) return { rows: [], rowCount: 0 };
        const managerRow = state.assignments.find(
          (a) => a.assignment_id === row.manager_assignment_id,
        );
        return {
          rows: [
            {
              assignment_id: row.assignment_id,
              role_key: row.role_key,
              status: row.status,
              partner_id: row.partner_id,
              manager_assignment_id: row.manager_assignment_id,
              manager_status: managerRow?.status ?? null,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith("SELECT user_id FROM assignments")) {
        const row = state.assignments.find(
          (a) => a.assignment_id === params[0] && a.status === "active",
        );
        return { rows: row ? [{ user_id: row.user_id }] : [], rowCount: row ? 1 : 0 };
      }

      // --- catalogue / locations -----------------------------------------
      if (sql.startsWith("SELECT sku.id FROM product_skus sku")) {
        const sku = state.skus.find((row) => row.id === params[0] && row.active);
        return { rows: sku ? [{ id: sku.id }] : [], rowCount: sku ? 1 : 0 };
      }
      if (sql.startsWith("SELECT id, location_name FROM stock_locations")) {
        const row = state.locations.find(
          (loc) =>
            loc.id === params[0] && loc.active && loc.distributor_assignment_id === params[1],
        );
        return {
          rows: row ? [{ id: row.id, location_name: row.location_name }] : [],
          rowCount: row ? 1 : 0,
        };
      }
      if (sql.startsWith("SELECT id FROM stock_locations WHERE id = $1 AND active = TRUE")) {
        const row = state.locations.find((loc) => loc.id === params[0] && loc.active);
        return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
      }

      // --- balances -------------------------------------------------------
      if (sql.startsWith("INSERT INTO inventory_balances (product_sku_id, location_id)")) {
        const [skuId, locationId] = params as [string, string];
        if (
          !state.balances.some(
            (row) => row.product_sku_id === skuId && row.location_id === locationId,
          )
        ) {
          track(state.balances, {
            id: `bal-${skuId}-${locationId}`,
            product_sku_id: skuId,
            location_id: locationId,
            on_hand_quantity: 0,
            reserved_quantity: 0,
            damaged_quantity: 0,
            in_transit_quantity: 0,
            version: 1,
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
        mutate(row, {
          on_hand_quantity: onHand,
          reserved_quantity: reserved,
          damaged_quantity: damaged,
          in_transit_quantity: inTransit,
          version: newVersion,
        });
        return { rows: [], rowCount: 1 };
      }

      // --- movements -------------------------------------------------------
      if (sql.startsWith("SELECT id FROM inventory_movements WHERE idempotency_key")) {
        const row = state.movements.find((m) => m.idempotency_key === params[0]);
        return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.startsWith("INSERT INTO inventory_movements")) {
        const key = params[12] as string;
        if (state.movements.some((m) => m.idempotency_key === key)) {
          const error = new Error("duplicate key") as Error & { code: string };
          error.code = "23505";
          throw error;
        }
        track(state.movements, {
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
        });
        return { rows: [], rowCount: 1 };
      }

      // --- requests ---------------------------------------------------------
      if (sql.startsWith("SELECT id, version, requester_user_id FROM stock_requests")) {
        const row = state.requests.find((r) => r.idempotency_key === params[0]);
        return {
          rows: row
            ? [{ id: row.id, version: row.version, requester_user_id: row.requester_user_id }]
            : [],
          rowCount: row ? 1 : 0,
        };
      }
      if (sql.startsWith("INSERT INTO stock_requests")) {
        const key = params[10] as string;
        if (state.requests.some((r) => r.idempotency_key === key)) {
          const error = new Error("duplicate key") as Error & { code: string };
          error.code = "23505";
          throw error;
        }
        state.sequence += 1;
        const humanId = `DMS-${String(state.sequence).padStart(6, "0")}`;
        track(state.requests, {
          id: params[0],
          human_id: humanId,
          distributor_assignment_id: params[1],
          requester_user_id: params[2],
          manager_assignment_id: params[3],
          destination_location_id: params[4],
          deal_id: params[5],
          customer_id: params[6],
          priority: params[7],
          required_by: params[8],
          reason: params[9],
          idempotency_key: key,
          status: "submitted",
          version: 1,
          decision_reason: null,
          exception_reason: null,
          exception_from_status: null,
        });
        return { rows: [{ human_id: humanId }], rowCount: 1 };
      }
      if (sql.startsWith("SELECT r.id, r.human_id")) {
        await lock(`request:${params[0]}`);
        const row = state.requests.find((r) => r.id === params[0]);
        if (!row) return { rows: [], rowCount: 0 };
        const destination = state.locations.find((loc) => loc.id === row.destination_location_id);
        const distributorAssignment = state.assignments.find(
          (a) => a.assignment_id === row.distributor_assignment_id,
        );
        return {
          rows: [
            {
              ...row,
              destination_custodian_assignment_id: destination?.custodian_assignment_id ?? null,
              partner_id: distributorAssignment?.partner_id ?? null,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith("UPDATE stock_requests")) {
        const [
          id,
          status,
          newVersion,
          decisionReason,
          exceptionReason,
          exceptionFrom,
          expectedVersion,
        ] = params as [string, string, number, string | null, string | null, string | null, number];
        const row = state.requests.find((r) => r.id === id);
        if (!row || row.version !== expectedVersion) return { rows: [], rowCount: 0 };
        mutate(row, {
          status,
          version: newVersion,
          decision_reason: decisionReason ?? row.decision_reason,
          exception_reason: exceptionReason,
          exception_from_status: exceptionFrom,
        });
        return { rows: [], rowCount: 1 };
      }

      // --- lines -------------------------------------------------------------
      if (sql.startsWith("INSERT INTO stock_request_lines")) {
        track(state.lines, {
          id: `line-${state.lines.length + 1}`,
          request_id: params[0],
          product_sku_id: params[1],
          source_location_id: null,
          requested_quantity: params[2],
          approved_quantity: 0,
          reserved_quantity: 0,
          dispatched_quantity: 0,
          received_quantity: 0,
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("SELECT l.id, l.product_sku_id, sku.sku_code")) {
        const rows = state.lines
          .filter((line) => line.request_id === params[0])
          .map((line) => {
            const sku = state.skus.find((candidate) => candidate.id === line.product_sku_id);
            const source = state.locations.find(
              (candidate) => candidate.id === line.source_location_id,
            );
            return {
              ...line,
              sku_code: sku?.sku_code ?? "",
              source_custodian_assignment_id: source?.custodian_assignment_id ?? null,
            };
          })
          .sort((left, right) => String(left.sku_code).localeCompare(String(right.sku_code)));
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith("UPDATE stock_request_lines")) {
        const [id, approved, reserved, dispatched, received, sourceLocationId] = params as [
          string,
          number,
          number,
          number,
          number,
          string | null,
        ];
        const row = state.lines.find((line) => line.id === id);
        if (!row) return { rows: [], rowCount: 0 };
        mutate(row, {
          approved_quantity: approved,
          reserved_quantity: reserved,
          dispatched_quantity: dispatched,
          received_quantity: received,
          source_location_id: sourceLocationId ?? row.source_location_id,
        });
        return { rows: [], rowCount: 1 };
      }

      // --- evidence -----------------------------------------------------------
      if (sql.startsWith("INSERT INTO stock_request_transitions")) {
        track(state.transitions, {
          request_id: params[0],
          command_name: params[1],
          from_status: params[2],
          to_status: params[3],
          actor_user_id: params[4],
          assignment_id: params[5],
          reason: params[6],
          correlation_id: params[7],
        });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO domain_activity_events")) {
        track(state.activity, { event_name: params[7], subject_id: params[3] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO command_outbox")) {
        track(state.outbox, { event_name: params[1], aggregate_id: params[4] });
        return { rows: [], rowCount: 1 };
      }

      // --- tasks ---------------------------------------------------------------
      if (sql.startsWith("INSERT INTO tasks")) {
        const automationKey = params[12] as string;
        const conflict = state.tasks.some(
          (task) =>
            task.automation_key === automationKey &&
            task.status !== "completed" &&
            task.status !== "cancelled",
        );
        if (conflict) return { rows: [], rowCount: 0 };
        track(state.tasks, {
          id: params[0],
          title: params[1],
          status: "to_do",
          priority: params[3],
          related_type: params[4],
          related_id: params[5],
          assignee_id: params[6],
          creator_id: params[7],
          partner_id: params[8],
          due_at: params[9],
          automation_source: params[10],
          automation_template_version: params[11],
          automation_key: automationKey,
          version: 1,
        });
        return { rows: [{ id: params[0] }], rowCount: 1 };
      }
      if (sql.startsWith("SELECT id, status, version, title FROM tasks")) {
        const rows = state.tasks
          .filter(
            (task) =>
              task.automation_key === params[0] &&
              task.status !== "completed" &&
              task.status !== "cancelled",
          )
          .map((task) => ({ ...task }));
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith("UPDATE tasks SET status = 'completed'")) {
        const [id, newVersion, expectedVersion] = params as [string, number, number];
        const row = state.tasks.find((task) => task.id === id);
        if (!row || row.version !== expectedVersion) return { rows: [], rowCount: 0 };
        mutate(row, { status: "completed", version: newVersion });
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO task_transitions")) {
        return { rows: [], rowCount: 1 };
      }

      // --- notifications --------------------------------------------------------
      if (sql.startsWith("INSERT INTO notifications")) {
        const [id, userId, partnerId, title, message, , , subjectId, actionUrl, eventKey] =
          params as [
            string,
            string | null,
            string | null,
            string,
            string,
            string,
            string,
            string,
            string | null,
            string,
          ];
        const conflict = state.notifications.some(
          (row) => row.user_id === userId && row.event_key === eventKey,
        );
        if (conflict) return { rows: [], rowCount: 0 };
        track(state.notifications, {
          id,
          user_id: userId,
          partner_id: partnerId,
          title,
          message,
          subject_id: subjectId,
          action_url: actionUrl,
          event_key: eventKey,
        });
        return { rows: [{ id }], rowCount: 1 };
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function commands() {
  return import("@/server/distribution-commands.server");
}

async function seedStock(state: State, quantity: number, skuId = SKU_A) {
  const { postManualStockMovement } = await commands();
  const result = await postManualStockMovement({
    actor: superAdmin(),
    data: {
      movementType: "opening_balance",
      productSkuId: skuId,
      destinationLocationId: WAREHOUSE,
      quantity,
      reason: "Opening count",
      idempotencyKey: `open-${skuId}-${quantity}`,
    },
    deps: DEPS,
  });
  expect(result.ok).toBe(true);
}

async function submit(
  state: State,
  overrides: Record<string, unknown> = {},
  actor = distributor(),
) {
  const { submitStockRequest } = await commands();
  return submitStockRequest({
    actor,
    data: {
      destinationLocationId: STORE,
      requiredBy: "2026-09-01",
      priority: "high",
      reason: "Restock for a tagged deal",
      lines: [{ productSkuId: SKU_A, quantity: 5 }],
      idempotencyKey: "submit-1",
      ...overrides,
    } as never,
    deps: DEPS,
  });
}

function request(state: State) {
  return state.requests[0]!;
}
function lineFor(state: State, skuId = SKU_A) {
  return state.lines.find((line) => line.product_sku_id === skuId)!;
}
function balance(state: State, locationId: string, skuId = SKU_A) {
  return state.balances.find(
    (row) => row.location_id === locationId && row.product_sku_id === skuId,
  );
}
function openTasks(state: State) {
  return state.tasks.filter((task) => task.status !== "completed");
}
function notificationsFor(state: State, userId: string) {
  return state.notifications.filter((row) => row.user_id === userId);
}

async function approveAll(state: State, quantity = 5) {
  const { reviewStockRequest } = await commands();
  return reviewStockRequest({
    actor: manager(),
    data: {
      requestId: String(request(state).id),
      expectedVersion: Number(request(state).version),
      decision: "approve",
      reason: "Approved in full",
      lines: state.lines.map((line) => ({
        lineId: String(line.id),
        approvedQuantity: quantity,
        sourceLocationId: WAREHOUSE,
      })),
    },
    deps: DEPS,
  });
}

async function allocateAll(state: State, key = "alloc-1") {
  const { allocateStockRequest } = await commands();
  return allocateStockRequest({
    actor: custodian(),
    data: {
      requestId: String(request(state).id),
      expectedVersion: Number(request(state).version),
      lines: [],
      idempotencyKey: key,
    },
    deps: DEPS,
  });
}

async function dispatchAll(state: State, key = "dispatch-1") {
  const { dispatchStockRequest } = await commands();
  return dispatchStockRequest({
    actor: custodian(),
    data: {
      requestId: String(request(state).id),
      expectedVersion: Number(request(state).version),
      lines: [],
      idempotencyKey: key,
    },
    deps: DEPS,
  });
}

async function receiveAll(
  state: State,
  key = "receive-1",
  lines: Array<{ lineId: string; quantity: number }> = [],
) {
  const { receiveStockRequest } = await commands();
  return receiveStockRequest({
    actor: distributor(),
    data: {
      requestId: String(request(state).id),
      expectedVersion: Number(request(state).version),
      lines,
      idempotencyKey: key,
    },
    deps: DEPS,
  });
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

test("DMS-001: submission stores the lines and snapshots the manager assignment", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    const result = await submit(state, {
      lines: [
        { productSkuId: SKU_A, quantity: 5 },
        { productSkuId: SKU_B, quantity: 3 },
      ],
    });
    expect(result.ok).toBe(true);

    const row = request(state);
    expect(row.status).toBe("submitted");
    expect(String(row.human_id)).toMatch(/^DMS-\d{6}$/);
    expect(row.manager_assignment_id).toBe("assignment-manager");
    expect(row.distributor_assignment_id).toBe("assignment-distributor");
    expect(state.lines).toHaveLength(2);

    // One approval Task for the snapped manager, with a due date from the
    // priority's SLA, and one Notification carrying a working deep link.
    expect(openTasks(state)).toHaveLength(1);
    const task = state.tasks[0]!;
    expect(task.automation_key).toBe(`stock-request:${row.id}:manager-approval:assignment-manager`);
    expect(task.assignee_id).toBe(MANAGER_USER);
    expect(task.due_at).toBeTruthy();

    const notification = notificationsFor(state, MANAGER_USER)[0]!;
    expect(String(notification.action_url)).toContain(String(row.id));
    expect(state.transitions[0]?.to_status).toBe("submitted");
    expect(state.activity.map((row) => row.event_name)).toContain("stock_request.submitted");
  } finally {
    harness.restore();
  }
});

test("DMS-002: a Distributor cannot submit to a location it does not own", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    const result = await submit(state, { destinationLocationId: OTHER_STORE });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
      // Must not distinguish "no such location" from "someone else's".
      expect(result.failure.message).toBe("Access denied");
    }
    expect(state.requests).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("DMS-003: an inactive Distributor assignment cannot submit", async () => {
  for (const status of ["suspended", "ended", "revoked"]) {
    const state = createState();
    state.assignments[0]!.status = status;
    const harness = await installFakePool(state)();
    try {
      const result = await submit(state);
      expect(result.ok).toBe(false);
      expect(state.requests).toHaveLength(0);
    } finally {
      harness.restore();
    }
  }
});

test("DMS-004: submission is refused when the assignment has no live manager", async () => {
  const state = createState();
  state.assignments[0]!.manager_assignment_id = null;
  const harness = await installFakePool(state)();
  try {
    const result = await submit(state);
    expect(result.ok).toBe(false);
    expect(state.requests).toHaveLength(0);
    expect(state.tasks).toHaveLength(0);
  } finally {
    harness.restore();
  }

  const ended = createState();
  ended.assignments[2]!.status = "ended";
  const harness2 = await installFakePool(ended)();
  try {
    const result = await submit(ended);
    expect(result.ok).toBe(false);
    expect(ended.requests).toHaveLength(0);
  } finally {
    harness2.restore();
  }
});

test("DMS-005: a replayed submission creates one request, one task, one notification", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    const first = await submit(state);
    const second = await submit(state);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.subjectId).toBe(first.subjectId);

    expect(state.requests).toHaveLength(1);
    expect(state.lines).toHaveLength(1);
    expect(state.tasks).toHaveLength(1);
    expect(state.notifications).toHaveLength(1);
  } finally {
    harness.restore();
  }
});

test("submission validates its own shape before opening a transaction", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    const duplicateSku = await submit(state, {
      lines: [
        { productSkuId: SKU_A, quantity: 1 },
        { productSkuId: SKU_A, quantity: 2 },
      ],
    });
    expect(duplicateSku.ok).toBe(false);

    const zeroQuantity = await submit(state, {
      lines: [{ productSkuId: SKU_A, quantity: 0 }],
      idempotencyKey: "zero",
    });
    expect(zeroQuantity.ok).toBe(false);

    const noLines = await submit(state, { lines: [], idempotencyKey: "empty" });
    expect(noLines.ok).toBe(false);

    const noReason = await submit(state, { reason: "  ", idempotencyKey: "no-reason" });
    expect(noReason.ok).toBe(false);

    expect(state.requests).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

test("DMS-006: the snapped manager approves, the approval task closes, and fulfilment opens", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    const result = await approveAll(state, 4);
    expect(result.ok).toBe(true);

    const row = request(state);
    expect(row.status).toBe("approved");
    expect(row.decision_reason).toBe("Approved in full");
    expect(lineFor(state).approved_quantity).toBe(4);
    expect(lineFor(state).source_location_id).toBe(WAREHOUSE);

    const approvalTask = state.tasks.find((task) =>
      String(task.automation_key).includes("manager-approval"),
    )!;
    expect(approvalTask.status).toBe("completed");

    const fulfilmentTask = state.tasks.find((task) =>
      String(task.automation_key).includes("fulfilment"),
    )!;
    expect(fulfilmentTask.automation_key).toBe(
      `stock-request:${row.id}:fulfilment:assignment-custodian`,
    );
    expect(fulfilmentTask.assignee_id).toBe(CUSTODIAN_USER);

    expect(notificationsFor(state, DISTRIBUTOR_USER).length).toBeGreaterThan(0);
    expect(notificationsFor(state, CUSTODIAN_USER).length).toBeGreaterThan(0);
  } finally {
    harness.restore();
  }
});

test("DMS-007: an unrelated RM or PAM cannot approve", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    const { reviewStockRequest } = await commands();
    const result = await reviewStockRequest({
      actor: unrelatedManager(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: 1,
        decision: "approve",
        reason: "Looks fine to me",
        lines: [
          { lineId: String(lineFor(state).id), approvedQuantity: 5, sourceLocationId: WAREHOUSE },
        ],
      },
      deps: DEPS,
    });
    expect(result.ok).toBe(false);
    expect(request(state).status).toBe("submitted");
    expect(lineFor(state).approved_quantity).toBe(0);
  } finally {
    harness.restore();
  }
});

test("DMS-008: rejection is terminal, closes the task, and notifies the requester once", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await submit(state);
    const { reviewStockRequest } = await commands();
    const result = await reviewStockRequest({
      actor: manager(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: 1,
        decision: "reject",
        reason: "Not this quarter",
        lines: [],
      },
      deps: DEPS,
    });
    expect(result.ok).toBe(true);
    expect(request(state).status).toBe("rejected");
    expect(openTasks(state)).toHaveLength(0);
    expect(notificationsFor(state, DISTRIBUTOR_USER)).toHaveLength(1);

    // Terminal: nothing further is possible.
    const again = await reviewStockRequest({
      actor: manager(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: Number(request(state).version),
        decision: "approve",
        reason: "Changed my mind",
        lines: [],
      },
      deps: DEPS,
    });
    expect(again.ok).toBe(false);
  } finally {
    harness.restore();
  }
});

test("DMS-009: approving more than was requested is refused before any write", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    const result = await approveAll(state, 9);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("VALIDATION_FAILED");
    expect(request(state).status).toBe("submitted");
    expect(lineFor(state).approved_quantity).toBe(0);
  } finally {
    harness.restore();
  }
});

test("approving zero units on every line is refused rather than silently stranding the request", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    const result = await approveAll(state, 0);
    expect(result.ok).toBe(false);
    expect(request(state).status).toBe("submitted");
  } finally {
    harness.restore();
  }
});

test("approving a quantity without a source location is refused", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    const { reviewStockRequest } = await commands();
    const result = await reviewStockRequest({
      actor: manager(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: 1,
        decision: "approve",
        reason: "Approved",
        lines: [{ lineId: String(lineFor(state).id), approvedQuantity: 5, sourceLocationId: null }],
      },
      deps: DEPS,
    });
    expect(result.ok).toBe(false);
    expect(request(state).status).toBe("submitted");
  } finally {
    harness.restore();
  }
});

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

test("DMS-010: allocation reserves stock, lowers available, and reaches allocated", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    await approveAll(state, 5);
    const result = await allocateAll(state);
    expect(result.ok).toBe(true);

    expect(request(state).status).toBe("allocated");
    expect(lineFor(state).reserved_quantity).toBe(5);
    const warehouse = balance(state, WAREHOUSE)!;
    expect(warehouse.on_hand_quantity).toBe(20);
    expect(warehouse.reserved_quantity).toBe(5);

    const reservation = state.movements.find((m) => m.movement_type === "reservation")!;
    expect(reservation.request_id).toBe(request(state).id);
    expect(reservation.quantity).toBe(5);
  } finally {
    harness.restore();
  }
});

test("DMS-011: a short warehouse produces a partial allocation and notifies all three parties", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 3);
    await submit(state);
    await approveAll(state, 5);
    const result = await allocateAll(state);
    expect(result.ok).toBe(true);

    expect(request(state).status).toBe("partially_allocated");
    expect(lineFor(state).reserved_quantity).toBe(3);

    const shortage = state.notifications.filter((row) =>
      String(row.event_key).includes("shortage"),
    );
    const recipients = new Set(shortage.map((row) => row.user_id));
    expect(recipients.has(DISTRIBUTOR_USER)).toBe(true);
    expect(recipients.has(MANAGER_USER)).toBe(true);
    expect(recipients.has(CUSTODIAN_USER)).toBe(true);
  } finally {
    harness.restore();
  }
});

test("DMS-012: nothing available leaves the request awaiting stock", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 5);
    await submit(state);
    await approveAll(state, 5);
    // Everything is committed elsewhere before the custodian tries.
    const { postManualStockMovement } = await commands();
    await postManualStockMovement({
      actor: superAdmin(),
      data: {
        movementType: "damage",
        productSkuId: SKU_A,
        sourceLocationId: WAREHOUSE,
        quantity: 5,
        reason: "Water damage",
        idempotencyKey: "damage-all",
      },
      deps: DEPS,
    });

    const result = await allocateAll(state);
    expect(result.ok).toBe(true);
    expect(request(state).status).toBe("awaiting_stock");
    expect(lineFor(state).reserved_quantity).toBe(0);
    expect(state.movements.some((m) => m.movement_type === "reservation")).toBe(false);
  } finally {
    harness.restore();
  }
});

test("an explicit allocation beyond available stock fails with no partial write", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 2);
    await submit(state, {
      lines: [
        { productSkuId: SKU_A, quantity: 5 },
        { productSkuId: SKU_B, quantity: 5 },
      ],
    });
    await approveAll(state, 5);

    const { allocateStockRequest } = await commands();
    const result = await allocateStockRequest({
      actor: custodian(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: Number(request(state).version),
        lines: state.lines.map((line) => ({ lineId: String(line.id), quantity: 5 })),
        idempotencyKey: "explicit-too-much",
      },
      deps: DEPS,
    });

    expect(result.ok).toBe(false);
    // Neither line moved, and the warehouse committed nothing.
    expect(state.lines.every((line) => line.reserved_quantity === 0)).toBe(true);
    expect(balance(state, WAREHOUSE)?.reserved_quantity ?? 0).toBe(0);
    expect(state.movements.some((m) => m.movement_type === "reservation")).toBe(false);
  } finally {
    harness.restore();
  }
});

test("DMS-013: two custodians racing for the last units produce exactly one winner", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 5);
    await submit(state);
    await approveAll(state, 5);

    const { allocateStockRequest } = await commands();
    const version = Number(request(state).version);
    const results = await Promise.all([
      allocateStockRequest({
        actor: custodian(),
        data: {
          requestId: String(request(state).id),
          expectedVersion: version,
          lines: [],
          idempotencyKey: "race-a",
        },
        deps: DEPS,
      }),
      allocateStockRequest({
        actor: custodian(),
        data: {
          requestId: String(request(state).id),
          expectedVersion: version,
          lines: [],
          idempotencyKey: "race-b",
        },
        deps: DEPS,
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(lineFor(state).reserved_quantity).toBe(5);
    expect(state.movements.filter((m) => m.movement_type === "reservation")).toHaveLength(1);
  } finally {
    harness.restore();
  }
});

// ---------------------------------------------------------------------------
// Dispatch, receipt
// ---------------------------------------------------------------------------

test("DMS-014: dispatch moves stock into transit and opens the confirm-receipt task", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    await approveAll(state, 5);
    await allocateAll(state);
    const result = await dispatchAll(state);
    expect(result.ok).toBe(true);

    expect(request(state).status).toBe("dispatched");
    const warehouse = balance(state, WAREHOUSE)!;
    expect(warehouse.on_hand_quantity).toBe(15);
    expect(warehouse.reserved_quantity).toBe(0);
    const store = balance(state, STORE)!;
    expect(store.in_transit_quantity).toBe(5);
    expect(store.on_hand_quantity).toBe(0);

    expect(
      state.tasks.find((task) => String(task.automation_key).includes("fulfilment"))?.status,
    ).toBe("completed");
    const receiptTask = state.tasks.find((task) =>
      String(task.automation_key).includes("confirm-receipt"),
    )!;
    expect(receiptTask.assignee_id).toBe(DISTRIBUTOR_USER);
    // The requester is a Distributor, so the Task must carry their Partner
    // scope or their own Task list will not admit it.
    expect(receiptTask.partner_id).toBe("partner-1");
  } finally {
    harness.restore();
  }
});

test("DMS-015 and DMS-016: partial then full receipt lands the stock and completes the request", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    await approveAll(state, 5);
    await allocateAll(state);
    await dispatchAll(state);

    const partial = await receiveAll(state, "receive-partial", [
      { lineId: String(lineFor(state).id), quantity: 3 },
    ]);
    expect(partial.ok).toBe(true);
    expect(request(state).status).toBe("partially_received");
    expect(balance(state, STORE)?.on_hand_quantity).toBe(3);
    expect(balance(state, STORE)?.in_transit_quantity).toBe(2);
    expect(
      state.tasks.find((task) => String(task.automation_key).includes("confirm-receipt"))?.status,
    ).toBe("to_do");

    const rest = await receiveAll(state, "receive-rest");
    expect(rest.ok).toBe(true);
    expect(request(state).status).toBe("received");
    expect(balance(state, STORE)?.on_hand_quantity).toBe(5);
    expect(balance(state, STORE)?.in_transit_quantity).toBe(0);
    expect(openTasks(state)).toHaveLength(0);

    const completion = state.notifications.filter((row) =>
      String(row.event_key).startsWith(`stock-request:${request(state).id}:received`),
    );
    const recipients = new Set(completion.map((row) => row.user_id));
    expect(recipients.has(DISTRIBUTOR_USER)).toBe(true);
    expect(recipients.has(MANAGER_USER)).toBe(true);
    expect(recipients.has(CUSTODIAN_USER)).toBe(true);
  } finally {
    harness.restore();
  }
});

test("DMS-017: receiving more than was dispatched is refused", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    await approveAll(state, 5);
    await allocateAll(state);
    await dispatchAll(state);

    const result = await receiveAll(state, "over-receive", [
      { lineId: String(lineFor(state).id), quantity: 9 },
    ]);
    expect(result.ok).toBe(false);
    expect(lineFor(state).received_quantity).toBe(0);
    expect(balance(state, STORE)?.on_hand_quantity).toBe(0);
  } finally {
    harness.restore();
  }
});

test("only the requester may confirm receipt", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    await approveAll(state, 5);
    await allocateAll(state);
    await dispatchAll(state);

    const { receiveStockRequest } = await commands();
    const result = await receiveStockRequest({
      actor: custodian(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: Number(request(state).version),
        lines: [],
        idempotencyKey: "custodian-receives",
      },
      deps: DEPS,
    });
    expect(result.ok).toBe(false);
    expect(lineFor(state).received_quantity).toBe(0);
  } finally {
    harness.restore();
  }
});

// ---------------------------------------------------------------------------
// Cancellation, exception
// ---------------------------------------------------------------------------

test("DMS-018: cancelling before dispatch releases reservations and closes every open task", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    await approveAll(state, 5);
    await allocateAll(state);
    expect(balance(state, WAREHOUSE)?.reserved_quantity).toBe(5);

    const { cancelStockRequest } = await commands();
    const result = await cancelStockRequest({
      actor: distributor(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: Number(request(state).version),
        reason: "Customer withdrew the order",
      },
      deps: DEPS,
    });
    expect(result.ok).toBe(true);

    expect(request(state).status).toBe("cancelled");
    expect(lineFor(state).reserved_quantity).toBe(0);
    expect(balance(state, WAREHOUSE)?.reserved_quantity).toBe(0);
    expect(balance(state, WAREHOUSE)?.on_hand_quantity).toBe(20);
    expect(openTasks(state)).toHaveLength(0);
    expect(
      notificationsFor(state, MANAGER_USER).some((row) =>
        String(row.event_key).endsWith(":cancelled"),
      ),
    ).toBe(true);
  } finally {
    harness.restore();
  }
});

test("DMS-019: cancellation is refused once anything is dispatched", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    await approveAll(state, 5);
    await allocateAll(state);
    await dispatchAll(state);

    const { cancelStockRequest } = await commands();
    const result = await cancelStockRequest({
      actor: distributor(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: Number(request(state).version),
        reason: "Changed my mind",
      },
      deps: DEPS,
    });
    expect(result.ok).toBe(false);
    expect(request(state).status).toBe("dispatched");
  } finally {
    harness.restore();
  }
});

test("DMS-020: an exception parks the request and recovery returns it to where it was", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    await approveAll(state, 5);
    await allocateAll(state);
    expect(request(state).status).toBe("allocated");

    const { reportStockRequestException, resolveStockRequestException } = await commands();
    const reported = await reportStockRequestException({
      actor: distributor(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: Number(request(state).version),
        reason: "Two units arrived damaged",
      },
      deps: DEPS,
    });
    expect(reported.ok).toBe(true);
    expect(request(state).status).toBe("exception");
    expect(request(state).exception_from_status).toBe("allocated");
    expect(request(state).exception_reason).toBe("Two units arrived damaged");

    const resolved = await resolveStockRequestException({
      actor: manager(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: Number(request(state).version),
        reason: "Replacement units allocated",
      },
      deps: DEPS,
    });
    expect(resolved.ok).toBe(true);
    expect(request(state).status).toBe("allocated");
    expect(request(state).exception_reason).toBeNull();

    // Both transitions are retained; nothing is deleted.
    const toStatuses = state.transitions.map((row) => row.to_status);
    expect(toStatuses).toContain("exception");
    expect(toStatuses.filter((status) => status === "allocated")).toHaveLength(2);
  } finally {
    harness.restore();
  }
});

test("a Distributor cannot resolve the exception they reported", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    await approveAll(state, 5);
    const { reportStockRequestException, resolveStockRequestException } = await commands();
    await reportStockRequestException({
      actor: distributor(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: Number(request(state).version),
        reason: "Wrong product approved",
      },
      deps: DEPS,
    });

    const result = await resolveStockRequestException({
      actor: distributor(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: Number(request(state).version),
        reason: "It is fine actually",
      },
      deps: DEPS,
    });
    expect(result.ok).toBe(false);
    expect(request(state).status).toBe("exception");
  } finally {
    harness.restore();
  }
});

// ---------------------------------------------------------------------------
// Cross-cutting
// ---------------------------------------------------------------------------

test("DMS-022: an unrelated Distributor cannot act on or discover the request", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    await approveAll(state, 5);
    await allocateAll(state);
    await dispatchAll(state);

    const { receiveStockRequest, cancelStockRequest, reportStockRequestException } =
      await commands();
    const requestId = String(request(state).id);
    const version = Number(request(state).version);

    for (const attempt of [
      receiveStockRequest({
        actor: otherDistributor(),
        data: { requestId, expectedVersion: version, lines: [], idempotencyKey: "steal-receive" },
        deps: DEPS,
      }),
      cancelStockRequest({
        actor: otherDistributor(),
        data: { requestId, expectedVersion: version, reason: "Not mine" },
        deps: DEPS,
      }),
      reportStockRequestException({
        actor: otherDistributor(),
        data: { requestId, expectedVersion: version, reason: "Not mine" },
        deps: DEPS,
      }),
    ]) {
      const result = await attempt;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe("POLICY_DENIED");
        expect(result.failure.message).toBe("Access denied");
      }
    }
    expect(request(state).status).toBe("dispatched");
    expect(lineFor(state).received_quantity).toBe(0);
  } finally {
    harness.restore();
  }
});

test("a stale expectedVersion is refused on every request command", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    await approveAll(state, 5);

    const { allocateStockRequest } = await commands();
    const result = await allocateStockRequest({
      actor: custodian(),
      data: {
        requestId: String(request(state).id),
        // The approval already bumped the version to 2.
        expectedVersion: 1,
        lines: [],
        idempotencyKey: "stale",
      },
      deps: DEPS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("OPTIMISTIC_CONFLICT");
    expect(lineFor(state).reserved_quantity).toBe(0);
  } finally {
    harness.restore();
  }
});

test("DMS-024: the balance projection equals the movement ledger for every pair", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);
    await approveAll(state, 5);
    await allocateAll(state);
    await dispatchAll(state);
    await receiveAll(state);

    const signs: Record<
      string,
      { source?: Record<string, number>; destination?: Record<string, number> }
    > = {
      opening_balance: { destination: { on_hand_quantity: 1 } },
      reservation: { source: { reserved_quantity: 1 } },
      reservation_release: { source: { reserved_quantity: -1 } },
      dispatch: {
        source: { on_hand_quantity: -1, reserved_quantity: -1 },
        destination: { in_transit_quantity: 1 },
      },
      delivery: { destination: { in_transit_quantity: -1, on_hand_quantity: 1 } },
    };

    const replayed = new Map<string, Record<string, number>>();
    const bump = (key: string, field: string, delta: number) => {
      const entry = replayed.get(key) ?? {
        on_hand_quantity: 0,
        reserved_quantity: 0,
        damaged_quantity: 0,
        in_transit_quantity: 0,
      };
      entry[field] = (entry[field] ?? 0) + delta;
      replayed.set(key, entry);
    };

    for (const movement of state.movements) {
      const effect = signs[String(movement.movement_type)];
      if (!effect) continue;
      const quantity = Number(movement.quantity);
      for (const [field, sign] of Object.entries(effect.source ?? {})) {
        bump(`${movement.product_sku_id}:${movement.source_location_id}`, field, sign * quantity);
      }
      for (const [field, sign] of Object.entries(effect.destination ?? {})) {
        bump(
          `${movement.product_sku_id}:${movement.destination_location_id}`,
          field,
          sign * quantity,
        );
      }
    }

    for (const stored of state.balances) {
      const key = `${stored.product_sku_id}:${stored.location_id}`;
      const expected = replayed.get(key) ?? {
        on_hand_quantity: 0,
        reserved_quantity: 0,
        damaged_quantity: 0,
        in_transit_quantity: 0,
      };
      expect(stored.on_hand_quantity).toBe(expected.on_hand_quantity);
      expect(stored.reserved_quantity).toBe(expected.reserved_quantity);
      expect(stored.in_transit_quantity).toBe(expected.in_transit_quantity);
    }
  } finally {
    harness.restore();
  }
});

test("DMS-025: a disabled distribution surface denies every request command", async () => {
  const state = createState();
  const harness = await installFakePool(state)();
  try {
    await seedStock(state, 20);
    await submit(state);

    const offDeps = {
      resolveSurface: async () => false,
      loadCapabilities: async () => fullCapabilities(),
    };
    const { submitStockRequest, reviewStockRequest, allocateStockRequest } = await commands();

    const submitted = await submitStockRequest({
      actor: distributor(),
      data: {
        destinationLocationId: STORE,
        requiredBy: "2026-09-01",
        priority: "high",
        reason: "Restock",
        lines: [{ productSkuId: SKU_A, quantity: 1 }],
        idempotencyKey: "surface-off-submit",
      },
      deps: offDeps,
    });
    expect(submitted.ok).toBe(false);

    const reviewed = await reviewStockRequest({
      actor: manager(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: 1,
        decision: "approve",
        reason: "Approved",
        lines: [],
      },
      deps: offDeps,
    });
    expect(reviewed.ok).toBe(false);

    const allocated = await allocateStockRequest({
      actor: custodian(),
      data: {
        requestId: String(request(state).id),
        expectedVersion: 1,
        lines: [],
        idempotencyKey: "off",
      },
      deps: offDeps,
    });
    expect(allocated.ok).toBe(false);

    expect(state.requests).toHaveLength(1);
    expect(request(state).status).toBe("submitted");
  } finally {
    harness.restore();
  }
});
