import { expect, test } from "bun:test";

import {
  buildGeographyGraph,
  buildGovernanceSeedRows,
  canGrantRole,
  containsGeography,
  countryNodeId,
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
  salesRegionNodeId,
  validateAssignmentDraft,
} from "./governance";
import { SALES_REGIONS, WORLD_COUNTRIES } from "./world-geography";

test("governance seed rows stay stable and include governed context", () => {
  // Pin issuedAt/expiresAt/correlationId so this genuinely tests that the
  // same inputs produce the same output, rather than relying on both calls
  // landing within the same wall-clock millisecond (the full world geography
  // tree takes long enough to build that they no longer reliably do).
  const seedInput = {
    superAdminUserId: "profile-1",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T08:00:00.000Z",
    correlationId: "seed-governance-test",
  };
  const rows = buildGovernanceSeedRows(seedInput);

  expect(rows.tenants).toHaveLength(1);
  expect(rows.tenants[0]?.tenantId).toBe(GOVERNANCE_TENANT_IDS.liveyOrganization);
  expect(rows.assignments[0]?.assignmentId).toBe(GOVERNANCE_ASSIGNMENT_IDS.superAdmin);
  expect(rows.activeContexts[0]?.contextId).toBe(GOVERNANCE_CONTEXT_IDS.superAdmin);
  expect(buildGovernanceSeedRows(seedInput)).toEqual(rows);
});

test("geography helpers resolve aliases and preserve ancestry", () => {
  const rows = buildGovernanceSeedRows({ superAdminUserId: "profile-1" });
  const graph = buildGeographyGraph(rows.geographyNodes, rows.geographyAliases);
  const indiaRegionNodeId = salesRegionNodeId("india");
  const apacRegionNodeId = salesRegionNodeId("apac");
  const usNodeId = countryNodeId("US");
  const sgNodeId = countryNodeId("SG");

  expect(resolveGeographyNodeId(graph, "India")).toBe(GOVERNANCE_GEOGRAPHY_NODE_IDS.india);
  expect(resolveGeographyNodeId(graph, "US")).toBe(usNodeId);
  expect(resolveGeographyNodeId(graph, "United States")).toBe(usNodeId);
  expect(listDescendantGeographyNodeIds(graph, GOVERNANCE_GEOGRAPHY_NODE_IDS.global)).toEqual(
    expect.arrayContaining([
      GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
      indiaRegionNodeId,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.maharashtra,
      usNodeId,
      sgNodeId,
    ]),
  );
  expect(listAncestorGeographyNodeIds(graph, GOVERNANCE_GEOGRAPHY_NODE_IDS.maharashtra)).toEqual([
    GOVERNANCE_GEOGRAPHY_NODE_IDS.maharashtra,
    GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
    indiaRegionNodeId,
    GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
  ]);
  expect(
    containsGeography(
      graph,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.maharashtra,
    ),
  ).toBe(true);
  expect(containsGeography(graph, apacRegionNodeId, GOVERNANCE_GEOGRAPHY_NODE_IDS.india)).toBe(
    false,
  );
  // sg and india are in different sales regions, so their only common
  // ancestor is Global.
  expect(intersectGeography(graph, sgNodeId, GOVERNANCE_GEOGRAPHY_NODE_IDS.india)).toEqual([
    GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
  ]);
});

test("world geography seeds every country under exactly one sales region", () => {
  const rows = buildGovernanceSeedRows({ superAdminUserId: "profile-1" });

  // Global + every Sales Region + every country + one illustrative province.
  expect(rows.geographyNodes).toHaveLength(1 + SALES_REGIONS.length + WORLD_COUNTRIES.length + 1);

  const countryNodes = rows.geographyNodes.filter((node) => node.nodeType === "country");
  expect(countryNodes).toHaveLength(WORLD_COUNTRIES.length);

  const usNode = countryNodes.find((node) => node.nodeId === countryNodeId("US"));
  expect(usNode?.parentNodeId).toBe(salesRegionNodeId("north_america"));

  const inNode = countryNodes.find((node) => node.nodeId === GOVERNANCE_GEOGRAPHY_NODE_IDS.india);
  expect(inNode?.parentNodeId).toBe(salesRegionNodeId("india"));

  // Every country has both a name alias and an ISO-code alias.
  const usAliases = rows.geographyAliases.filter((alias) => alias.nodeId === countryNodeId("US"));
  expect(usAliases.map((alias) => alias.legacyValue).sort()).toEqual(["US", "United States"]);
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
