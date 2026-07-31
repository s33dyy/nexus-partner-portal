import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import type { GovernedActor } from "@/server/governed-actor.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

const ISSUED_AT = "2026-07-30T00:00:00.000Z";

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

function buildActiveContext(assignment: AssignmentRecord): ActiveContextRecord {
  return {
    contextId: "context-1",
    userId: assignment.userId,
    assignmentId: assignment.assignmentId,
    assignmentStatus: assignment.status,
    tenantId: assignment.tenantId,
    organizationTenantId: assignment.organizationTenantId,
    workingScope: null,
    issuedAt: ISSUED_AT,
    expiresAt: "2026-07-30T08:00:00.000Z",
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
}

function buildActor(overrides: Partial<AssignmentRecord> = {}): GovernedActor {
  const assignment = buildAssignment(overrides);
  return {
    userId: assignment.userId,
    assignment,
    activeContext: buildActiveContext(assignment),
  };
}

function installFakePool(options: { tierRequirement: string | null; partnerTier: string | null }) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const insertEnrollmentCalls: Array<{ params: unknown[] }> = [];

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        const text = sql.trim();
        if (text.includes("FROM learning_tracks WHERE id")) {
          return {
            rows: [{ id: "track-1", tier_requirement: options.tierRequirement }],
            rowCount: 1,
          };
        }
        if (text.includes("FROM partners WHERE id")) {
          return {
            rows: options.partnerTier ? [{ tier: options.partnerTier }] : [],
            rowCount: options.partnerTier ? 1 : 0,
          };
        }
        if (text.startsWith("INSERT INTO learning_enrollments")) {
          insertEnrollmentCalls.push({ params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };

    const originalConnect = pool.connect.bind(pool);
    pool.connect = (async () => fakeClient) as typeof pool.connect;

    return {
      insertEnrollmentCalls,
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

test("enrollInTrack allows enrollment when the track has no tier requirement", async () => {
  const harness = await installFakePool({ tierRequirement: null, partnerTier: "registered" })();
  try {
    const { enrollInTrack } = await import("@/server/learning-commands.server");
    const result = await enrollInTrack({
      actor: buildActor(),
      data: { trackId: "track-1" },
    });
    expect(result.ok).toBe(true);
    expect(harness.insertEnrollmentCalls).toHaveLength(1);
  } finally {
    harness.restore();
  }
});

test("enrollInTrack denies a below-tier partner from a tier-gated track", async () => {
  const harness = await installFakePool({ tierRequirement: "Gold", partnerTier: "silver" })();
  try {
    const { enrollInTrack } = await import("@/server/learning-commands.server");
    const result = await enrollInTrack({
      actor: buildActor({ partnerId: "partner-1" }),
      data: { trackId: "track-1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_FAILED");
    }
    expect(harness.insertEnrollmentCalls).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("enrollInTrack allows an at-or-above-tier partner into a tier-gated track", async () => {
  const harness = await installFakePool({ tierRequirement: "Gold", partnerTier: "platinum" })();
  try {
    const { enrollInTrack } = await import("@/server/learning-commands.server");
    const result = await enrollInTrack({
      actor: buildActor({ partnerId: "partner-1" }),
      data: { trackId: "track-1" },
    });
    expect(result.ok).toBe(true);
    expect(harness.insertEnrollmentCalls).toHaveLength(1);
  } finally {
    harness.restore();
  }
});

test("enrollInTrack never gates super_admin (no partner tier of their own)", async () => {
  const harness = await installFakePool({ tierRequirement: "Platinum", partnerTier: null })();
  try {
    const { enrollInTrack } = await import("@/server/learning-commands.server");
    const result = await enrollInTrack({
      actor: buildActor({ roleKey: "super_admin", partnerId: null }),
      data: { trackId: "track-1" },
    });
    expect(result.ok).toBe(true);
  } finally {
    harness.restore();
  }
});
