import { expect, test } from "bun:test";

import type { FeatureCapabilities } from "@/server/rbac-policy.server";
import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import { FEATURE_KEYS, type CrudOperation, type FeatureKey } from "@/domain/contracts/features";
import type { RoleKey } from "@/domain/contracts/taxonomy";
import {
  authorizeDistribution,
  canReadStockRequest,
  destinationLocationScopePredicate,
  isRequestCustodian,
  isRequestManager,
  isRequestRequester,
  resolveAllowedStockRequestActions,
  resolveSubmissionAuthority,
  stockLocationScopePredicate,
  stockRequestScopePredicate,
  type DistributionActor,
  type StockRequestAuthorityFacts,
} from "@/server/distribution-policy.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

const ISSUED_AT = "2026-08-25T00:00:00.000Z";
const DISTRIBUTOR_USER = "11111111-1111-1111-1111-111111111111";
const MANAGER_USER = "22222222-2222-2222-2222-222222222222";
const CUSTODIAN_USER = "33333333-3333-3333-3333-333333333333";

function buildAssignment(overrides: Partial<AssignmentRecord> = {}): AssignmentRecord {
  return {
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
}

function buildActor(overrides: Partial<AssignmentRecord> = {}): DistributionActor {
  const assignment = buildAssignment(overrides);
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

const distributor = () => buildActor();
const otherDistributor = () =>
  buildActor({
    assignmentId: "assignment-distributor-2",
    userId: "44444444-4444-4444-4444-444444444444",
  });
const manager = () =>
  buildActor({
    assignmentId: "assignment-manager",
    userId: MANAGER_USER,
    roleKey: "rm",
    teamDomain: "sales",
    partnerId: null,
    managerAssignmentId: "assignment-director",
  });
const unrelatedManager = () =>
  buildActor({
    assignmentId: "assignment-manager-2",
    userId: "55555555-5555-5555-5555-555555555555",
    roleKey: "pam",
    teamDomain: "sales",
    partnerId: null,
  });
const custodian = () =>
  buildActor({
    assignmentId: "assignment-custodian",
    userId: CUSTODIAN_USER,
    roleKey: "pam",
    teamDomain: "sales",
    partnerId: null,
  });
const superAdmin = () =>
  buildActor({
    assignmentId: "assignment-admin",
    userId: "66666666-6666-6666-6666-666666666666",
    roleKey: "super_admin",
    teamDomain: "identity",
    partnerId: null,
  });

function capabilities(grants: Partial<Record<CrudOperation, boolean>>): FeatureCapabilities {
  const empty = {} as FeatureCapabilities;
  for (const feature of FEATURE_KEYS) {
    empty[feature as FeatureKey] = {
      create: false,
      read: false,
      update: false,
      delete: false,
    };
  }
  empty.distribution = {
    create: grants.create ?? false,
    read: grants.read ?? false,
    update: grants.update ?? false,
    delete: grants.delete ?? false,
  };
  return empty;
}

function deps(
  options: { surface?: boolean; grants?: Partial<Record<CrudOperation, boolean>> } = {},
) {
  return {
    resolveSurface: async () => options.surface ?? true,
    loadCapabilities: async (_role: RoleKey | null) =>
      capabilities(options.grants ?? { read: true }),
  };
}

const REQUEST: StockRequestAuthorityFacts = {
  requesterUserId: DISTRIBUTOR_USER,
  distributorAssignmentId: "assignment-distributor",
  managerAssignmentId: "assignment-manager",
  destinationLocationId: "loc-distributor",
  custodianAssignmentIds: ["assignment-custodian"],
};

// ---------------------------------------------------------------------------
// The surface gate
// ---------------------------------------------------------------------------

test("a disabled surface denies every role identically, Super Admin included", async () => {
  for (const actor of [distributor(), manager(), custodian(), superAdmin()]) {
    const result = await authorizeDistribution(
      actor,
      "read",
      deps({ surface: false, grants: { create: true, read: true, update: true } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("POLICY_DENIED");
      expect(result.failure.reason).toBe("Distribution is not enabled in this workspace");
    }
  }
});

test("an ended, suspended, or revoked assignment fails closed", async () => {
  for (const status of ["ended", "suspended", "revoked", "scheduled"] as const) {
    const result = await authorizeDistribution(
      buildActor({ status }),
      "read",
      deps({ grants: { read: true } }),
    );
    expect(result.ok).toBe(false);
  }
});

test("a role without the distribution capability is denied", async () => {
  const result = await authorizeDistribution(
    distributor(),
    "create",
    deps({ grants: { read: true } }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failure.reason).toBe("Distribution access is not granted to this role");
  }
});

test("nobody, including Super Admin, may delete distribution records", async () => {
  const admin = await authorizeDistribution(superAdmin(), "delete", deps());
  expect(admin.ok).toBe(false);
  if (!admin.ok) expect(admin.failure.reason).toBe("Distribution records are never deleted");

  const other = await authorizeDistribution(
    manager(),
    "delete",
    deps({ grants: { read: true, update: true, delete: false } }),
  );
  expect(other.ok).toBe(false);
});

test("Super Admin bypasses the editable matrix but not the surface", async () => {
  const granted = await authorizeDistribution(superAdmin(), "update", deps({ grants: {} }));
  expect(granted.ok).toBe(true);
});

// ---------------------------------------------------------------------------
// Submission authority
// ---------------------------------------------------------------------------

function submissionTx(row: Record<string, unknown> | null) {
  const statements: string[] = [];
  return {
    statements,
    tx: {
      query: async (sql: string) => {
        statements.push(String(sql).replace(/\s+/g, " "));
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      },
    },
  };
}

test("submission snapshots the requester's own active assignment and its live manager", async () => {
  const harness = submissionTx({
    assignment_id: "assignment-distributor",
    role_key: "restricted_distributor",
    status: "active",
    partner_id: "partner-1",
    manager_assignment_id: "assignment-manager",
    manager_status: "active",
  });

  const result = await resolveSubmissionAuthority(harness.tx, distributor());
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.authority.distributorAssignmentId).toBe("assignment-distributor");
    expect(result.authority.managerAssignmentId).toBe("assignment-manager");
    expect(result.authority.partnerId).toBe("partner-1");
  }
  // Locked so the assignment cannot be ended or re-parented between the read
  // and the insert that stores the snapshot.
  expect(harness.statements[0]).toContain("FOR SHARE OF a");
});

test("submission is refused when the Distributor assignment has no active manager", async () => {
  const noManager = submissionTx({
    assignment_id: "assignment-distributor",
    role_key: "restricted_distributor",
    status: "active",
    partner_id: "partner-1",
    manager_assignment_id: null,
    manager_status: null,
  });
  const result = await resolveSubmissionAuthority(noManager.tx, distributor());
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failure.reason).toContain("no active manager");
  }

  const endedManager = submissionTx({
    assignment_id: "assignment-distributor",
    role_key: "restricted_distributor",
    status: "active",
    partner_id: "partner-1",
    manager_assignment_id: "assignment-manager",
    manager_status: "ended",
  });
  const ended = await resolveSubmissionAuthority(endedManager.tx, distributor());
  expect(ended.ok).toBe(false);
});

test("only a Distributor can submit — not a manager, and not Super Admin", async () => {
  for (const actor of [manager(), custodian(), superAdmin()]) {
    const harness = submissionTx(null);
    const result = await resolveSubmissionAuthority(harness.tx, actor);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe("Only a Distributor can submit a stock request");
    }
    // Refused before any query — no assignment row is even read.
    expect(harness.statements).toHaveLength(0);
  }
});

test("a Distributor whose stored assignment is no longer active is refused", async () => {
  const harness = submissionTx({
    assignment_id: "assignment-distributor",
    role_key: "restricted_distributor",
    status: "suspended",
    partner_id: "partner-1",
    manager_assignment_id: "assignment-manager",
    manager_status: "active",
  });
  const result = await resolveSubmissionAuthority(harness.tx, distributor());
  expect(result.ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Record-level authority
// ---------------------------------------------------------------------------

test("record authority is held by the snapped assignments, not by role", () => {
  expect(isRequestRequester(distributor(), REQUEST)).toBe(true);
  expect(isRequestRequester(otherDistributor(), REQUEST)).toBe(false);

  expect(isRequestManager(manager(), REQUEST)).toBe(true);
  // An unrelated RM/PAM holds the same role as the snapped manager and still
  // has no authority over this request.
  expect(isRequestManager(unrelatedManager(), REQUEST)).toBe(false);

  expect(isRequestCustodian(custodian(), REQUEST)).toBe(true);
  expect(isRequestCustodian(unrelatedManager(), REQUEST)).toBe(false);
});

test("another Distributor cannot read the request at all", () => {
  expect(canReadStockRequest(distributor(), REQUEST)).toBe(true);
  expect(canReadStockRequest(otherDistributor(), REQUEST)).toBe(false);
  expect(canReadStockRequest(manager(), REQUEST)).toBe(true);
  expect(canReadStockRequest(custodian(), REQUEST)).toBe(true);
  expect(canReadStockRequest(unrelatedManager(), REQUEST)).toBe(false);
  expect(canReadStockRequest(superAdmin(), REQUEST)).toBe(true);
});

// ---------------------------------------------------------------------------
// Allowed actions
// ---------------------------------------------------------------------------

const OPEN_LINES = [{ requested: 5, approved: 0, reserved: 0, dispatched: 0, received: 0 }];
const ALLOCATED_LINES = [{ requested: 5, approved: 5, reserved: 5, dispatched: 0, received: 0 }];
const DISPATCHED_LINES = [{ requested: 5, approved: 5, reserved: 5, dispatched: 5, received: 0 }];

test("only the snapped manager is offered review, and only while submitted", () => {
  const submitted = { ...REQUEST, status: "submitted" as const, lines: OPEN_LINES };
  expect(resolveAllowedStockRequestActions(manager(), submitted)).toContain("review");
  expect(resolveAllowedStockRequestActions(unrelatedManager(), submitted)).toEqual([]);
  expect(resolveAllowedStockRequestActions(distributor(), submitted)).not.toContain("review");

  const approved = { ...REQUEST, status: "approved" as const, lines: OPEN_LINES };
  expect(resolveAllowedStockRequestActions(manager(), approved)).not.toContain("review");
});

test("allocation and dispatch belong to the custodian, receipt to the requester", () => {
  const approved = { ...REQUEST, status: "approved" as const, lines: OPEN_LINES };
  expect(resolveAllowedStockRequestActions(custodian(), approved)).toContain("allocate");
  expect(resolveAllowedStockRequestActions(distributor(), approved)).not.toContain("allocate");

  const allocated = { ...REQUEST, status: "allocated" as const, lines: ALLOCATED_LINES };
  expect(resolveAllowedStockRequestActions(custodian(), allocated)).toContain("dispatch");
  expect(resolveAllowedStockRequestActions(distributor(), allocated)).not.toContain("dispatch");

  const dispatched = { ...REQUEST, status: "dispatched" as const, lines: DISPATCHED_LINES };
  expect(resolveAllowedStockRequestActions(distributor(), dispatched)).toContain("receive");
  expect(resolveAllowedStockRequestActions(custodian(), dispatched)).not.toContain("receive");
});

test("cancel disappears the moment anything is dispatched", () => {
  const allocated = { ...REQUEST, status: "allocated" as const, lines: ALLOCATED_LINES };
  expect(resolveAllowedStockRequestActions(distributor(), allocated)).toContain("cancel");

  const dispatched = { ...REQUEST, status: "dispatched" as const, lines: DISPATCHED_LINES };
  expect(resolveAllowedStockRequestActions(distributor(), dispatched)).not.toContain("cancel");
});

test("a terminal request offers nothing but reading", () => {
  const received = {
    ...REQUEST,
    status: "received" as const,
    lines: [{ requested: 5, approved: 5, reserved: 5, dispatched: 5, received: 5 }],
  };
  expect(resolveAllowedStockRequestActions(distributor(), received)).toEqual([]);
  expect(resolveAllowedStockRequestActions(manager(), received)).toEqual([]);
  // Super Admin does not get a bypass past a terminal state either.
  expect(resolveAllowedStockRequestActions(superAdmin(), received)).toEqual([]);
});

test("exception recovery belongs to the manager and custodian, not the reporter", () => {
  const exception = { ...REQUEST, status: "exception" as const, lines: ALLOCATED_LINES };
  expect(resolveAllowedStockRequestActions(manager(), exception)).toContain("resolve_exception");
  expect(resolveAllowedStockRequestActions(custodian(), exception)).toContain("resolve_exception");
  expect(resolveAllowedStockRequestActions(distributor(), exception)).not.toContain(
    "resolve_exception",
  );
});

// ---------------------------------------------------------------------------
// Read scope
// ---------------------------------------------------------------------------

test("scope predicates never return an empty clause for an unauthorised role", () => {
  const outsider = buildActor({
    assignmentId: "assignment-support",
    roleKey: "livey_support",
    teamDomain: "support",
    partnerId: null,
  });
  expect(stockRequestScopePredicate(outsider, "r", 1).clause).toBe("FALSE");
  expect(stockLocationScopePredicate(outsider, "loc", 1).clause).toBe("FALSE");
  expect(destinationLocationScopePredicate(outsider, "loc", 1).clause).toBe("FALSE");
});

test("a Distributor's scope is bound to its own assignment id", () => {
  const scope = stockRequestScopePredicate(distributor(), "r", 3);
  expect(scope.clause).toBe("r.distributor_assignment_id = $3");
  expect(scope.params).toEqual(["assignment-distributor"]);

  const locations = stockLocationScopePredicate(distributor(), "loc", 1);
  expect(locations.clause).toBe("loc.distributor_assignment_id = $1");
  expect(locations.params).toEqual(["assignment-distributor"]);
});

test("a manager's request scope covers what it decides and what it holds, and nothing else", () => {
  const scope = stockRequestScopePredicate(manager(), "r", 1);
  expect(scope.clause).toContain("r.manager_assignment_id = $1");
  expect(scope.clause).toContain("dloc.custodian_assignment_id = $1");
  expect(scope.clause).toContain("sloc.custodian_assignment_id = $1");
  expect(scope.params).toEqual(["assignment-manager"]);
});

test("a manager sees its own custodied locations and every LIVEY warehouse", () => {
  const scope = stockLocationScopePredicate(manager(), "loc", 1);
  expect(scope.clause).toContain("loc.custodian_assignment_id = $1");
  // Approving means choosing the source location per line, so a manager that
  // could see no warehouse would get an empty picker and be unable to approve.
  expect(scope.clause).toContain("loc.location_type = 'livey_warehouse'");
  // Still never a distributor_assignment_id match: that would expose another
  // Distributor's own stock to whoever manages them.
  expect(scope.clause).not.toContain("distributor_assignment_id");
});

test("Super Admin scope is unrestricted but destination scope still requires an active location", () => {
  expect(stockRequestScopePredicate(superAdmin(), "r", 1).clause).toBe("TRUE");
  expect(destinationLocationScopePredicate(superAdmin(), "loc", 1).clause).toBe(
    "loc.active = TRUE",
  );
});

test("a Distributor may only send stock to its own active locations", () => {
  const scope = destinationLocationScopePredicate(distributor(), "loc", 2);
  expect(scope.clause).toBe("loc.active = TRUE AND loc.distributor_assignment_id = $2");
  expect(scope.params).toEqual(["assignment-distributor"]);
  // A manager has no destination scope: managers approve, they do not receive.
  expect(destinationLocationScopePredicate(manager(), "loc", 1).clause).toBe("FALSE");
});
