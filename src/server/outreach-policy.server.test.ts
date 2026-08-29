import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import type { GovernedActor } from "@/server/governed-actor.server";
import {
  authorizeOutreach,
  bindPredicate,
  isSequenceInScope,
  sequenceScopePredicate,
} from "@/server/outreach-policy.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

const ISSUED_AT = "2026-08-25T00:00:00.000Z";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";
const PARTNER_ID = "33333333-3333-3333-3333-333333333333";
const OTHER_PARTNER_ID = "44444444-4444-4444-4444-444444444444";

function buildActor(overrides: Partial<AssignmentRecord> = {}): GovernedActor {
  const assignment: AssignmentRecord = {
    assignmentId: "assignment-1",
    userId: USER_ID,
    tenantId: "tenant-livey-org",
    organizationTenantId: "tenant-livey-org",
    roleKey: "rm",
    teamDomain: "sales",
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
    expiresAt: "2099-01-01T00:00:00.000Z",
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

test("super_admin is in scope for every sequence", () => {
  const actor = buildActor({ roleKey: "super_admin" });
  expect(isSequenceInScope(actor, { ownerId: OTHER_USER_ID, partnerId: OTHER_PARTNER_ID })).toBe(
    true,
  );
});

test("an internal role sees the sequences it owns", () => {
  const actor = buildActor();
  expect(isSequenceInScope(actor, { ownerId: USER_ID, partnerId: null })).toBe(true);
});

test("an internal role does not see somebody else's sequence", () => {
  const actor = buildActor();
  expect(isSequenceInScope(actor, { ownerId: OTHER_USER_ID, partnerId: null })).toBe(false);
});

test("a partner-scoped actor sees their own tenant's sequences even when another user owns them", () => {
  const actor = buildActor({ roleKey: "partner_admin", partnerId: PARTNER_ID });
  expect(isSequenceInScope(actor, { ownerId: OTHER_USER_ID, partnerId: PARTNER_ID })).toBe(true);
});

test("a partner-scoped actor never sees another tenant's sequence", () => {
  const actor = buildActor({ roleKey: "partner_admin", partnerId: PARTNER_ID });
  expect(isSequenceInScope(actor, { ownerId: OTHER_USER_ID, partnerId: OTHER_PARTNER_ID })).toBe(
    false,
  );
});

test("a null partner on both sides must not match — an internal role's sequence is not every internal role's", () => {
  // Both the actor and the sequence carry partnerId null. A naive
  // `actor.partnerId === sequence.partnerId` comparison would return true and
  // hand every internal role every other internal role's sequences.
  const actor = buildActor();
  expect(isSequenceInScope(actor, { ownerId: OTHER_USER_ID, partnerId: null })).toBe(false);
});

test("the scope predicate degenerates to TRUE only for super_admin", () => {
  expect(
    sequenceScopePredicate(buildActor({ roleKey: "super_admin" }), {
      ownerColumn: "s.owner_id",
      partnerColumn: "s.partner_id",
    }),
  ).toEqual({ clause: "TRUE", params: [] });
});

test("a partner-scoped predicate binds both the owner and the tenant", () => {
  const scope = sequenceScopePredicate(
    buildActor({ roleKey: "partner_admin", partnerId: PARTNER_ID }),
    { ownerColumn: "s.owner_id", partnerColumn: "s.partner_id" },
  );
  expect(scope.clause).toBe("(s.owner_id = ? OR s.partner_id = ?)");
  expect(scope.params).toEqual([USER_ID, PARTNER_ID]);
});

test("an internal predicate binds only the owner", () => {
  const scope = sequenceScopePredicate(buildActor(), {
    ownerColumn: "s.owner_id",
    partnerColumn: "s.partner_id",
  });
  expect(scope.clause).toBe("s.owner_id = ?");
  expect(scope.params).toEqual([USER_ID]);
});

test("bindPredicate renumbers placeholders from the given offset", () => {
  expect(bindPredicate("(a = ? OR b = ?)", 2)).toBe("(a = $2 OR b = $3)");
  expect(bindPredicate("TRUE", 1)).toBe("TRUE");
});

test("super_admin is authorised without consulting the permission matrix", async () => {
  // No database is reachable in this suite, so a call that reached
  // loadRoleCapabilities would reject rather than resolve — which is exactly
  // the assertion: super_admin must bypass the matrix, or a mis-set row
  // could lock out the only person who can fix it.
  const decision = await authorizeOutreach({
    actor: buildActor({ roleKey: "super_admin" }),
    operation: "create",
  });
  expect(decision.allowed).toBe(true);
});

test("super_admin is still refused a sequence that fails the row scope check", async () => {
  // Vacuous for super_admin (isSequenceInScope always passes), but the test
  // pins the ORDER: capability first, row scope second, both required.
  const decision = await authorizeOutreach({
    actor: buildActor({ roleKey: "super_admin" }),
    operation: "update",
    sequence: { ownerId: OTHER_USER_ID, partnerId: OTHER_PARTNER_ID },
  });
  expect(decision.allowed).toBe(true);
});

test("a revoked assignment is refused before any capability lookup", async () => {
  // Governance first, capability second. If the order were reversed this
  // would reach loadRoleCapabilities, which has no database in this suite.
  const actor = buildActor({ roleKey: "super_admin" });
  const decision = await authorizeOutreach({
    actor: { ...actor, assignment: { ...actor.assignment, status: "revoked" } },
    operation: "read",
  });
  expect(decision.allowed).toBe(false);
  expect(decision.reason).toBe("Assignment is not active");
});

test("an active context belonging to a different assignment is refused", async () => {
  const actor = buildActor({ roleKey: "super_admin" });
  const decision = await authorizeOutreach({
    actor: {
      ...actor,
      activeContext: { ...actor.activeContext, assignmentId: "assignment-somebody-else" },
    },
    operation: "read",
  });
  expect(decision.allowed).toBe(false);
});
