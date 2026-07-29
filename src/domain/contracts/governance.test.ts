import { expect, test } from "bun:test";

import {
  buildGeographyGraph,
  buildGovernanceSeedRows,
  canGrantRole,
  containsGeography,
  evaluateActiveContextPolicy,
  GOVERNANCE_ASSIGNMENT_IDS,
  GOVERNANCE_CONTEXT_IDS,
  GOVERNANCE_GEOGRAPHY_NODE_IDS,
  GOVERNANCE_TENANT_IDS,
  intersectGeography,
  issueActiveContextFromAssignment,
  listAncestorGeographyNodeIds,
  listDescendantGeographyNodeIds,
  resolveGeographyNodeId,
  validateAssignmentDraft,
} from "./governance";

test("governance seed rows stay stable and include governed context", () => {
  const rows = buildGovernanceSeedRows({ superAdminUserId: "profile-1" });

  expect(rows.tenants).toHaveLength(1);
  expect(rows.tenants[0]?.tenantId).toBe(GOVERNANCE_TENANT_IDS.liveyOrganization);
  expect(rows.assignments[0]?.assignmentId).toBe(GOVERNANCE_ASSIGNMENT_IDS.superAdmin);
  expect(rows.activeContexts[0]?.contextId).toBe(GOVERNANCE_CONTEXT_IDS.superAdmin);
  expect(buildGovernanceSeedRows({ superAdminUserId: "profile-1" })).toEqual(rows);
});

test("geography helpers resolve aliases and preserve ancestry", () => {
  const rows = buildGovernanceSeedRows({ superAdminUserId: "profile-1" });
  const graph = buildGeographyGraph(rows.geographyNodes, rows.geographyAliases);

  expect(resolveGeographyNodeId(graph, "India")).toBe(GOVERNANCE_GEOGRAPHY_NODE_IDS.india);
  expect(listDescendantGeographyNodeIds(graph, GOVERNANCE_GEOGRAPHY_NODE_IDS.global)).toEqual(
    expect.arrayContaining([
      GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.apac,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.indiaWest,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.maharashtra,
    ]),
  );
  expect(listAncestorGeographyNodeIds(graph, GOVERNANCE_GEOGRAPHY_NODE_IDS.maharashtra)).toEqual([
    GOVERNANCE_GEOGRAPHY_NODE_IDS.maharashtra,
    GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
    GOVERNANCE_GEOGRAPHY_NODE_IDS.apac,
    GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
  ]);
  expect(
    containsGeography(
      graph,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.maharashtra,
    ),
  ).toBe(true);
  expect(
    intersectGeography(
      graph,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.indiaWest,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.maharashtra,
    ),
  ).toEqual([GOVERNANCE_GEOGRAPHY_NODE_IDS.apac, GOVERNANCE_GEOGRAPHY_NODE_IDS.global]);
});

test("assignment validation rejects overlap and escalation", () => {
  const rows = buildGovernanceSeedRows({ superAdminUserId: "profile-1" });
  const existing = rows.assignments;
  const base = existing[0]!;

  const overlapResult = validateAssignmentDraft({
    existingAssignments: existing,
    draft: {
      assignmentId: "assignment-overlap",
      userId: base.userId,
      tenantId: base.tenantId,
      organizationTenantId: base.organizationTenantId,
      roleKey: "super_admin",
      teamDomain: "identity",
      geographyCeilingNodeId: base.geographyCeilingNodeId,
      partnerId: null,
      accountId: null,
      portfolioId: null,
      queueId: null,
      status: "active",
      validFrom: base.validFrom,
      validTo: null,
      managerAssignmentId: null,
    },
    actorRole: "super_admin",
    timestamp: base.validFrom,
  });

  expect(overlapResult.allowed).toBe(false);
  expect(overlapResult.reason).toBe("Assignment overlaps an existing governed interval");

  expect(
    validateAssignmentDraft({
      existingAssignments: [],
      draft: {
        assignmentId: "assignment-escalation",
        userId: base.userId,
        tenantId: base.tenantId,
        organizationTenantId: base.organizationTenantId,
        roleKey: "super_admin",
        teamDomain: "identity",
        geographyCeilingNodeId: base.geographyCeilingNodeId,
        partnerId: null,
        accountId: null,
        portfolioId: null,
        queueId: null,
        status: "scheduled",
        validFrom: base.validFrom,
        validTo: null,
        managerAssignmentId: null,
      },
      actorRole: "partner_admin",
    }).allowed,
  ).toBe(false);

  expect(canGrantRole("super_admin", "partner_admin")).toBe(true);
  expect(canGrantRole("partner_admin", "super_admin")).toBe(false);
});

test("active context issuance and policy checks are governed", () => {
  const rows = buildGovernanceSeedRows({ superAdminUserId: "profile-1" });
  const assignment = rows.assignments[0]!;
  const activeContext = issueActiveContextFromAssignment({
    assignment,
    contextId: GOVERNANCE_CONTEXT_IDS.superAdmin,
    issuedAt: assignment.validFrom,
    expiresAt: assignment.validFrom,
  });

  expect(activeContext.assignmentId).toBe(assignment.assignmentId);
  expect(activeContext.tenantId).toBe(GOVERNANCE_TENANT_IDS.liveyOrganization);

  expect(
    evaluateActiveContextPolicy({
      roles: ["super_admin"],
      assignment,
      activeContext,
    }).allowed,
  ).toBe(true);

  expect(
    evaluateActiveContextPolicy({
      roles: ["partner_user"],
      assignment,
      activeContext: {
        ...activeContext,
        tenantId: "tenant-other",
      },
      requestedTenantId: "tenant-other",
    }).allowed,
  ).toBe(false);
});
