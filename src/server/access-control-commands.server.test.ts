import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import type { GovernedActor } from "@/server/governed-actor.server";

const ISSUED_AT = "2026-10-13T00:00:00.000Z";

function actor(roleKey: AssignmentRecord["roleKey"]): GovernedActor {
  const assignment: AssignmentRecord = {
    assignmentId: "assignment-1",
    userId: "user-1",
    tenantId: "tenant-livey-org",
    organizationTenantId: "tenant-livey-org",
    roleKey,
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
    expiresAt: "2026-10-13T08:00:00.000Z",
    version: 1,
    revocationLink: null,
    correlationId: "corr-1",
    assignmentVersion: 1,
    workingScopeNodeId: null,
    revokedAt: null,
    revocationReason: null,
    isSeed: true,
    createdAt: ISSUED_AT,
    updatedAt: ISSUED_AT,
  };
  return { userId: assignment.userId, assignment, activeContext };
}

test("saveUserAccessOverride rejects a non-super-admin actor", async () => {
  const { saveUserAccessOverride } = await import("@/server/role-assignment-commands.server");

  const result = await saveUserAccessOverride({
    actor: actor("rm"),
    userId: "user-2",
    featureKey: "tasks",
    operation: "delete",
    decision: "allow",
  });

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
});
