import { randomUUID } from "node:crypto";

import { makePolicyDenial, type ActiveContextDTO } from "./commands";
import {
  ASSIGNMENT_STATUSES,
  GEOGRAPHY_NODE_TYPES,
  ROLE_KEYS,
  TEAM_DOMAINS,
  type AssignmentStatus,
  type GeographyNodeType,
  type RoleKey,
  type TeamDomainKey,
} from "./taxonomy";

export const TENANT_KINDS = ["livey_organization", "partner"] as const;
export type TenantKind = (typeof TENANT_KINDS)[number];

export const GOVERNANCE_TENANT_IDS = {
  liveyOrganization: "tenant-livey-org",
} as const;

export const GOVERNANCE_GEOGRAPHY_NODE_IDS = {
  global: "geo-global",
  apac: "geo-apac",
  india: "geo-india",
  indiaWest: "geo-india-west",
  maharashtra: "geo-in-maharashtra",
} as const;

export const GOVERNANCE_ASSIGNMENT_IDS = {
  superAdmin: "assignment-super-admin",
} as const;

export const GOVERNANCE_CONTEXT_IDS = {
  superAdmin: "context-super-admin",
} as const;

export type GovernanceTenantRecord = {
  tenantId: string;
  tenantKind: TenantKind;
  displayName: string;
  parentTenantId: string | null;
  createdAt: string;
  updatedAt: string;
  isSeed: boolean;
};

export type GeographyNodeRecord = {
  nodeId: string;
  tenantId: string;
  organizationTenantId: string;
  nodeCode: string;
  nodeType: GeographyNodeType;
  displayName: string;
  parentNodeId: string | null;
  validFrom: string;
  validTo: string | null;
  version: number;
  isSeed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GeographyAliasRecord = {
  aliasId: string;
  nodeId: string;
  legacyValue: string;
  validFrom: string;
  validTo: string | null;
  source: string;
  isSeed: boolean;
  createdAt: string;
};

export type AssignmentRecord = {
  assignmentId: string;
  userId: string;
  tenantId: string;
  organizationTenantId: string;
  roleKey: RoleKey;
  teamDomain: TeamDomainKey;
  geographyCeilingNodeId: string;
  partnerId: string | null;
  accountId: string | null;
  portfolioId: string | null;
  queueId: string | null;
  status: AssignmentStatus;
  validFrom: string;
  validTo: string | null;
  managerAssignmentId: string | null;
  source: string;
  approverUserId: string | null;
  predecessorAssignmentId: string | null;
  successorAssignmentId: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  isSeed: boolean;
};

export type AssignmentEventRecord = {
  eventId: string;
  assignmentId: string;
  actorUserId: string | null;
  actorAssignmentId: string | null;
  action: string;
  reason: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  effectiveAt: string;
  predecessorAssignmentId: string | null;
  successorAssignmentId: string | null;
  sessionRevocationResult: string | null;
  correlationId: string;
  createdAt: string;
};

export type ActiveContextRecord = ActiveContextDTO & {
  assignmentVersion: number;
  workingScopeNodeId: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  isSeed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GeographyGraph = {
  nodesById: Map<string, GeographyNodeRecord>;
  childrenByNodeId: Map<string, string[]>;
  aliasesByLegacyValue: Map<string, string>;
};

export type GovernanceSeedRows = {
  tenants: GovernanceTenantRecord[];
  geographyNodes: GeographyNodeRecord[];
  geographyAliases: GeographyAliasRecord[];
  assignments: AssignmentRecord[];
  activeContexts: ActiveContextRecord[];
  assignmentEvents: AssignmentEventRecord[];
};

export type PolicyDecision =
  | {
      allowed: true;
      reason: null;
    }
  | {
      allowed: false;
      reason: string;
      denial: ReturnType<typeof makePolicyDenial>;
    };

const ROLE_POWER: Record<RoleKey, number> = {
  super_admin: 90,
  rm: 80,
  pam: 70,
  kam: 60,
  isr: 50,
  livey_support: 40,
  restricted_distributor: 30,
  partner_admin: 20,
  partner_user: 10,
};

export function isEffectiveAtTime(
  input: { validFrom: string; validTo: string | null },
  timestamp: string,
) {
  const at = new Date(timestamp).getTime();
  const from = new Date(input.validFrom).getTime();
  const to = input.validTo ? new Date(input.validTo).getTime() : Number.POSITIVE_INFINITY;
  if (Number.isNaN(at) || Number.isNaN(from) || Number.isNaN(to)) {
    return false;
  }
  return from <= at && at < to;
}

export function buildGeographyGraph(
  nodes: readonly GeographyNodeRecord[],
  aliases: readonly GeographyAliasRecord[] = [],
): GeographyGraph {
  const nodesById = new Map(nodes.map((node) => [node.nodeId, node]));
  const childrenByNodeId = new Map<string, string[]>();

  for (const node of nodes) {
    if (!node.parentNodeId) continue;
    const children = childrenByNodeId.get(node.parentNodeId) ?? [];
    childrenByNodeId.set(node.parentNodeId, [...children, node.nodeId]);
  }

  const aliasesByLegacyValue = new Map(
    aliases.map((alias) => [alias.legacyValue.trim().toLowerCase(), alias.nodeId]),
  );

  return { nodesById, childrenByNodeId, aliasesByLegacyValue };
}

export function resolveGeographyNodeId(
  graph: GeographyGraph,
  input: string,
  timestamp = new Date().toISOString(),
) {
  const direct = graph.nodesById.get(input);
  if (direct && isEffectiveAtTime(direct, timestamp)) {
    return direct.nodeId;
  }

  const aliasNodeId = graph.aliasesByLegacyValue.get(input.trim().toLowerCase());
  if (!aliasNodeId) return null;

  const aliased = graph.nodesById.get(aliasNodeId);
  if (!aliased || !isEffectiveAtTime(aliased, timestamp)) return null;
  return aliased.nodeId;
}

export function listDescendantGeographyNodeIds(
  graph: GeographyGraph,
  rootNodeId: string,
  timestamp = new Date().toISOString(),
) {
  const output: string[] = [];
  const queue = [rootNodeId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = graph.nodesById.get(nodeId);
    if (!node || !isEffectiveAtTime(node, timestamp)) continue;
    output.push(nodeId);

    for (const childId of graph.childrenByNodeId.get(nodeId) ?? []) {
      queue.push(childId);
    }
  }

  return output;
}

export function listAncestorGeographyNodeIds(
  graph: GeographyGraph,
  leafNodeId: string,
  timestamp = new Date().toISOString(),
) {
  const output: string[] = [];
  let current: string | null = leafNodeId;

  while (current) {
    const node = graph.nodesById.get(current);
    if (!node || !isEffectiveAtTime(node, timestamp)) break;
    output.push(current);
    current = node.parentNodeId;
  }

  return output;
}

export function containsGeography(
  graph: GeographyGraph,
  ancestorNodeId: string,
  descendantNodeId: string,
  timestamp = new Date().toISOString(),
) {
  return listAncestorGeographyNodeIds(graph, descendantNodeId, timestamp).includes(ancestorNodeId);
}

export function intersectGeography(
  graph: GeographyGraph,
  leftNodeId: string,
  rightNodeId: string,
  timestamp = new Date().toISOString(),
) {
  const left = new Set(listAncestorGeographyNodeIds(graph, leftNodeId, timestamp));
  return listAncestorGeographyNodeIds(graph, rightNodeId, timestamp).filter((nodeId) =>
    left.has(nodeId),
  );
}

export function getRolePower(role: RoleKey) {
  return ROLE_POWER[role];
}

export function canGrantRole(actorRole: RoleKey, candidateRole: RoleKey) {
  if (actorRole === "super_admin") return true;
  if (actorRole === "partner_admin") {
    return candidateRole === "partner_user";
  }
  return false;
}

export function validateAssignmentDraft(input: {
  existingAssignments: readonly AssignmentRecord[];
  draft: Pick<
    AssignmentRecord,
    | "assignmentId"
    | "userId"
    | "tenantId"
    | "organizationTenantId"
    | "roleKey"
    | "teamDomain"
    | "geographyCeilingNodeId"
    | "partnerId"
    | "accountId"
    | "portfolioId"
    | "queueId"
    | "status"
    | "validFrom"
    | "validTo"
    | "managerAssignmentId"
  >;
  actorRole: RoleKey;
  timestamp?: string;
}): PolicyDecision {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const { draft, existingAssignments } = input;

  if (!ASSIGNMENT_STATUSES.includes(draft.status)) {
    return {
      allowed: false,
      reason: "Assignment status is not governed",
      denial: makePolicyDenial(draft.assignmentId, "Assignment status is not governed"),
    };
  }

  if (!TEAM_DOMAINS.includes(draft.teamDomain)) {
    return {
      allowed: false,
      reason: "Team domain is not governed",
      denial: makePolicyDenial(draft.assignmentId, "Team domain is not governed"),
    };
  }

  if (!canGrantRole(input.actorRole, draft.roleKey)) {
    return {
      allowed: false,
      reason: "Role escalation is not permitted",
      denial: makePolicyDenial(draft.assignmentId, "Role escalation is not permitted"),
    };
  }

  if (
    new Date(draft.validFrom).getTime() >=
    new Date(draft.validTo ?? "9999-12-31T23:59:59Z").getTime()
  ) {
    return {
      allowed: false,
      reason: "Assignment dates are invalid",
      denial: makePolicyDenial(draft.assignmentId, "Assignment dates are invalid"),
    };
  }

  if (draft.managerAssignmentId && draft.managerAssignmentId === draft.assignmentId) {
    return {
      allowed: false,
      reason: "Assignment cannot manage itself",
      denial: makePolicyDenial(draft.assignmentId, "Assignment cannot manage itself"),
    };
  }

  const overlaps = existingAssignments.some((existing) => {
    if (existing.assignmentId === draft.assignmentId) {
      return false;
    }
    if (existing.userId !== draft.userId) {
      return false;
    }
    if (existing.status === "ended" || existing.status === "revoked") {
      return false;
    }
    const existingFrom = new Date(existing.validFrom).getTime();
    const existingTo = new Date(existing.validTo ?? "9999-12-31T23:59:59Z").getTime();
    const draftFrom = new Date(draft.validFrom).getTime();
    const draftTo = new Date(draft.validTo ?? "9999-12-31T23:59:59Z").getTime();
    return existingFrom < draftTo && draftFrom < existingTo;
  });

  if (overlaps) {
    return {
      allowed: false,
      reason: "Assignment overlaps an existing governed interval",
      denial: makePolicyDenial(
        draft.assignmentId,
        "Assignment overlaps an existing governed interval",
      ),
    };
  }

  if (
    draft.status === "active" &&
    !isEffectiveAtTime({ validFrom: draft.validFrom, validTo: draft.validTo }, timestamp)
  ) {
    return {
      allowed: false,
      reason: "Assignment is not effective at the requested time",
      denial: makePolicyDenial(
        draft.assignmentId,
        "Assignment is not effective at the requested time",
      ),
    };
  }

  return {
    allowed: true as const,
    reason: null as string | null,
  };
}

export function issueActiveContextFromAssignment(input: {
  assignment: AssignmentRecord;
  workingScopeNodeId?: string | null;
  issuedAt?: string;
  expiresAt?: string;
  correlationId?: string;
  contextId?: string;
}): ActiveContextRecord {
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const contextId = input.contextId ?? randomUUID();

  return {
    contextId,
    userId: input.assignment.userId,
    assignmentId: input.assignment.assignmentId,
    assignmentStatus: input.assignment.status,
    tenantId: input.assignment.tenantId,
    organizationTenantId: input.assignment.organizationTenantId,
    workingScope: input.workingScopeNodeId ?? null,
    issuedAt,
    expiresAt,
    version: input.assignment.version,
    revocationLink: null,
    correlationId: input.correlationId ?? contextId,
    assignmentVersion: input.assignment.version,
    workingScopeNodeId: input.workingScopeNodeId ?? null,
    revokedAt: null,
    revocationReason: null,
    isSeed: input.assignment.isSeed,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };
}

export function evaluateActiveContextPolicy(input: {
  roles: readonly RoleKey[];
  assignment: AssignmentRecord | null;
  activeContext: ActiveContextDTO | null;
  requestedTenantId?: string;
  requestedWorkingScope?: string | null;
}): PolicyDecision {
  if (!input.assignment || !input.activeContext) {
    return {
      allowed: false,
      reason: "Active context is required",
      denial: makePolicyDenial(null, "Active context is required"),
    };
  }

  if (input.assignment.status !== "active") {
    return {
      allowed: false,
      reason: "Assignment is not active",
      denial: makePolicyDenial(input.assignment.assignmentId, "Assignment is not active"),
    };
  }

  if (input.activeContext.assignmentId !== input.assignment.assignmentId) {
    return {
      allowed: false,
      reason: "Active context does not match assignment",
      denial: makePolicyDenial(
        input.assignment.assignmentId,
        "Active context does not match assignment",
      ),
    };
  }

  if (
    input.requestedTenantId &&
    input.requestedTenantId !== input.assignment.tenantId &&
    !input.roles.includes("super_admin")
  ) {
    return {
      allowed: false,
      reason: "Tenant mismatch",
      denial: makePolicyDenial(input.assignment.assignmentId, "Tenant mismatch"),
    };
  }

  if (
    input.requestedWorkingScope &&
    input.activeContext.workingScope &&
    input.requestedWorkingScope !== input.activeContext.workingScope &&
    !input.roles.includes("super_admin")
  ) {
    return {
      allowed: false,
      reason: "Working scope exceeds active context",
      denial: makePolicyDenial(
        input.assignment.assignmentId,
        "Working scope exceeds active context",
      ),
    };
  }

  return {
    allowed: true as const,
    reason: null as string | null,
  };
}

export function buildGovernanceSeedRows(input: {
  superAdminUserId: string;
  issuedAt?: string;
  expiresAt?: string;
  correlationId?: string;
}): GovernanceSeedRows {
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const correlationId = input.correlationId ?? "seed-governance";

  const liveyTenant: GovernanceTenantRecord = {
    tenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    tenantKind: "livey_organization",
    displayName: "LIVEY Technologies",
    parentTenantId: null,
    createdAt: issuedAt,
    updatedAt: issuedAt,
    isSeed: true,
  };

  const globalNode: GeographyNodeRecord = {
    nodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    tenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    organizationTenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    nodeCode: "global",
    nodeType: "global",
    displayName: "Global",
    parentNodeId: null,
    validFrom: issuedAt,
    validTo: null,
    version: 1,
    isSeed: true,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };

  const apacNode: GeographyNodeRecord = {
    nodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.apac,
    tenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    organizationTenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    nodeCode: "apac",
    nodeType: "sales_region",
    displayName: "APAC",
    parentNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    validFrom: issuedAt,
    validTo: null,
    version: 1,
    isSeed: true,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };

  const indiaNode: GeographyNodeRecord = {
    nodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
    tenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    organizationTenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    nodeCode: "in",
    nodeType: "country",
    displayName: "India",
    parentNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.apac,
    validFrom: issuedAt,
    validTo: null,
    version: 1,
    isSeed: true,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };

  const indiaWestNode: GeographyNodeRecord = {
    nodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.indiaWest,
    tenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    organizationTenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    nodeCode: "india-west",
    nodeType: "sales_region",
    displayName: "India West",
    parentNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.apac,
    validFrom: issuedAt,
    validTo: null,
    version: 1,
    isSeed: true,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };

  const maharashtraNode: GeographyNodeRecord = {
    nodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.maharashtra,
    tenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    organizationTenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    nodeCode: "in-mh",
    nodeType: "province_state",
    displayName: "Maharashtra",
    parentNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
    validFrom: issuedAt,
    validTo: null,
    version: 1,
    isSeed: true,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  };

  const assignment: AssignmentRecord = {
    assignmentId: GOVERNANCE_ASSIGNMENT_IDS.superAdmin,
    userId: input.superAdminUserId,
    tenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    organizationTenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    roleKey: "super_admin",
    teamDomain: "identity",
    geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    partnerId: null,
    accountId: null,
    portfolioId: null,
    queueId: null,
    status: "active",
    validFrom: issuedAt,
    validTo: null,
    managerAssignmentId: null,
    source: "bootstrap",
    approverUserId: input.superAdminUserId,
    predecessorAssignmentId: null,
    successorAssignmentId: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: issuedAt,
    updatedAt: issuedAt,
    version: 1,
    isSeed: true,
  };

  return {
    tenants: [liveyTenant],
    geographyNodes: [globalNode, apacNode, indiaNode, indiaWestNode, maharashtraNode],
    geographyAliases: [
      {
        aliasId: "alias-global",
        nodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
        legacyValue: "Global",
        validFrom: issuedAt,
        validTo: null,
        source: "bootstrap",
        isSeed: true,
        createdAt: issuedAt,
      },
      {
        aliasId: "alias-apac",
        nodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.apac,
        legacyValue: "APAC",
        validFrom: issuedAt,
        validTo: null,
        source: "bootstrap",
        isSeed: true,
        createdAt: issuedAt,
      },
      {
        aliasId: "alias-india",
        nodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.india,
        legacyValue: "India",
        validFrom: issuedAt,
        validTo: null,
        source: "bootstrap",
        isSeed: true,
        createdAt: issuedAt,
      },
      {
        aliasId: "alias-india-west",
        nodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.indiaWest,
        legacyValue: "India West",
        validFrom: issuedAt,
        validTo: null,
        source: "bootstrap",
        isSeed: true,
        createdAt: issuedAt,
      },
      {
        aliasId: "alias-maharashtra",
        nodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.maharashtra,
        legacyValue: "Maharashtra",
        validFrom: issuedAt,
        validTo: null,
        source: "bootstrap",
        isSeed: true,
        createdAt: issuedAt,
      },
    ],
    assignments: [assignment],
    activeContexts: [
      issueActiveContextFromAssignment({
        assignment,
        issuedAt,
        expiresAt,
        correlationId,
        contextId: GOVERNANCE_CONTEXT_IDS.superAdmin,
      }),
    ],
    assignmentEvents: [
      {
        eventId: "assignment-event-super-admin",
        assignmentId: assignment.assignmentId,
        actorUserId: input.superAdminUserId,
        actorAssignmentId: assignment.assignmentId,
        action: "assignment.bootstrap",
        reason: "Bootstrap super admin access",
        beforeState: null,
        afterState: {
          assignmentId: assignment.assignmentId,
          roleKey: assignment.roleKey,
          status: assignment.status,
        },
        effectiveAt: issuedAt,
        predecessorAssignmentId: null,
        successorAssignmentId: null,
        sessionRevocationResult: null,
        correlationId,
        createdAt: issuedAt,
      },
    ],
  };
}

export function isGovernedGeographyNodeType(value: string): value is GeographyNodeType {
  return GEOGRAPHY_NODE_TYPES.includes(value as GeographyNodeType);
}

export function isGovernedRoleKey(value: string): value is RoleKey {
  return ROLE_KEYS.includes(value as RoleKey);
}
