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

// ─── completeLesson ─────────────────────────────────────────────────────────

function installCompleteLessonFakePool(options: {
  lessonExists?: boolean;
  enrolled?: boolean;
  totalRequired: number;
  completedRequired: number;
}) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const progressInserts: Array<{ params: unknown[] }> = [];
    const enrollmentUpdates: Array<{ sql: string; params: unknown[] }> = [];

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        const text = sql.trim();
        if (text.includes("FROM learning_lessons ll") && text.includes("WHERE ll.id = $1")) {
          if (options.lessonExists === false) return { rows: [], rowCount: 0 };
          return { rows: [{ id: "lesson-1", track_id: "track-1" }], rowCount: 1 };
        }
        if (text.startsWith("SELECT id FROM learning_enrollments")) {
          if (options.enrolled === false) return { rows: [], rowCount: 0 };
          return { rows: [{ id: "enrollment-1" }], rowCount: 1 };
        }
        if (text.startsWith("INSERT INTO learning_lesson_progress")) {
          progressInserts.push({ params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        if (text.includes("COUNT(*) FILTER")) {
          return {
            rows: [
              {
                total_required: String(options.totalRequired),
                completed_required: String(options.completedRequired),
              },
            ],
            rowCount: 1,
          };
        }
        if (text.startsWith("UPDATE learning_enrollments")) {
          enrollmentUpdates.push({ sql: text, params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };

    const originalConnect = pool.connect.bind(pool);
    pool.connect = (async () => fakeClient) as typeof pool.connect;

    return {
      progressInserts,
      enrollmentUpdates,
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

test("completeLesson denies for a lesson that doesn't exist", async () => {
  const harness = await installCompleteLessonFakePool({
    lessonExists: false,
    totalRequired: 1,
    completedRequired: 0,
  })();
  try {
    const { completeLesson } = await import("@/server/learning-commands.server");
    const result = await completeLesson({ actor: buildActor(), data: { lessonId: "missing" } });
    expect(result.ok).toBe(false);
  } finally {
    harness.restore();
  }
});

test("completeLesson denies when the caller isn't enrolled in the lesson's track", async () => {
  const harness = await installCompleteLessonFakePool({
    enrolled: false,
    totalRequired: 3,
    completedRequired: 0,
  })();
  try {
    const { completeLesson } = await import("@/server/learning-commands.server");
    const result = await completeLesson({ actor: buildActor(), data: { lessonId: "lesson-1" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("VALIDATION_FAILED");
  } finally {
    harness.restore();
  }
});

test("completeLesson records progress without completing the track when required lessons remain", async () => {
  const harness = await installCompleteLessonFakePool({ totalRequired: 3, completedRequired: 2 })();
  try {
    const { completeLesson } = await import("@/server/learning-commands.server");
    const result = await completeLesson({ actor: buildActor(), data: { lessonId: "lesson-1" } });
    expect(result.ok).toBe(true);
    expect(harness.progressInserts).toHaveLength(1);
    expect(harness.enrollmentUpdates).toHaveLength(1);
    expect(harness.enrollmentUpdates[0].sql).not.toContain("status = 'completed'");
    // progress_percent is bound as $3
    expect(harness.enrollmentUpdates[0].params[2]).toBe(67);
  } finally {
    harness.restore();
  }
});

test("completeLesson marks the track completed and issues a certificate once every required lesson is done", async () => {
  const harness = await installCompleteLessonFakePool({ totalRequired: 3, completedRequired: 3 })();
  try {
    const { completeLesson } = await import("@/server/learning-commands.server");
    const result = await completeLesson({ actor: buildActor(), data: { lessonId: "lesson-1" } });
    expect(result.ok).toBe(true);
    expect(harness.enrollmentUpdates).toHaveLength(1);
    expect(harness.enrollmentUpdates[0].sql).toContain("status = 'completed'");
    expect(harness.enrollmentUpdates[0].sql).toContain("certificate_token");
    expect(harness.enrollmentUpdates[0].params[2]).toBe(100); // progress_percent
    expect(typeof harness.enrollmentUpdates[0].params[3]).toBe("string"); // certificateToken
  } finally {
    harness.restore();
  }
});
