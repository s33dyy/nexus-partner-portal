import { randomUUID } from "node:crypto";

import {
  type CommandExecutionResult,
  type CommandFailureContract,
} from "@/domain/contracts/commands";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { withTransaction } from "@/server/command-runtime.server";
import {
  resolveGovernedActor,
  type GovernedActor,
  type ResolveGovernedActorInput,
} from "@/server/governed-actor.server";

export type LearningCommandActor = GovernedActor;
export type ResolveLearningCommandActorInput = ResolveGovernedActorInput;
export const resolveLearningCommandActor = resolveGovernedActor;

function validationFailure(message: string, field = "status"): CommandFailureContract {
  return {
    code: "VALIDATION_FAILED",
    message,
    fieldErrors: [{ field, message }],
    retryable: false,
  };
}

export type SubmitAssessmentInput = {
  assessmentId: string;
  score: number;
};

export async function submitAssessmentAttempt(input: {
  actor: LearningCommandActor;
  data: SubmitAssessmentInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();

  return withTransaction(async (tx) => {
    // 1. Load assessment details
    const { rows: assessmentRows } = await tx.query(
      `SELECT passing_score, subject_id FROM learning_assessments WHERE id = $1`,
      [input.data.assessmentId],
    );

    if (assessmentRows.length === 0) {
      return {
        ok: false,
        failure: validationFailure("Assessment not found"),
        correlationId,
      };
    }

    const assessment = assessmentRows[0] as { passing_score: number; subject_id: string };
    const isPassed = input.data.score >= assessment.passing_score;

    // 2. Record the attempt
    const attemptId = randomUUID();
    await tx.query(
      `INSERT INTO learning_assessment_attempts (id, assessment_id, user_id, score, is_passed)
       VALUES ($1, $2, $3, $4, $5)`,
      [attemptId, input.data.assessmentId, input.actor.userId, input.data.score, isPassed],
    );

    // 3. Update the enrollment if passed — issue a certificate token
    if (isPassed) {
      // Find the track for this subject
      const { rows: subjectRows } = await tx.query(
        `SELECT track_id FROM learning_subjects WHERE id = $1`,
        [assessment.subject_id],
      );

      if (subjectRows.length > 0) {
        const trackId = (subjectRows[0] as { track_id: string }).track_id;
        const certificateToken = randomUUID();

        await tx.query(
          `UPDATE learning_enrollments
           SET status = 'completed',
               progress_percent = 100,
               completed_at = now(),
               certificate_token = $3,
               is_certified = TRUE,
               updated_at = now()
           WHERE user_id = $1 AND track_id = $2 AND status != 'completed'`,
          [input.actor.userId, trackId, certificateToken],
        );
      }
    }

    return {
      ok: true,
      commandName: "learning.submit_assessment",
      subjectId: attemptId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

export type EnrollInTrackInput = {
  trackId: string;
};

export async function enrollInTrack(input: {
  actor: LearningCommandActor;
  data: EnrollInTrackInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();

  return withTransaction(async (tx) => {
    // Ensure track exists and is published
    const { rows: trackRows } = await tx.query(
      `SELECT id, tier_requirement FROM learning_tracks WHERE id = $1 AND is_published = TRUE`,
      [input.data.trackId],
    );
    if (trackRows.length === 0) {
      return {
        ok: false,
        failure: validationFailure("Track not found or not published"),
        correlationId,
      };
    }
    const track = trackRows[0] as { tier_requirement: string | null };

    // insight-hub.tsx's own enroll button only ever *hides* the action for
    // an under-tier partner — it never actually checked the viewer's real
    // tier, so it blocked every partner regardless of tier, and (since this
    // is the only enforcement point) a direct call bypassed the gate
    // entirely for everyone else. super_admin has no partner tier and is
    // not gated, matching every other command's super_admin bypass.
    if (track.tier_requirement && input.actor.assignment.roleKey !== "super_admin") {
      const { meetsPartnerTierRequirement } = await import("@/lib/money");
      const partnerId = input.actor.assignment.partnerId;
      let partnerTier: string | null = null;
      if (partnerId) {
        const { rows: partnerRows } = await tx.query(`SELECT tier FROM partners WHERE id = $1`, [
          partnerId,
        ]);
        partnerTier = (partnerRows[0] as { tier: string } | undefined)?.tier ?? null;
      }
      if (!meetsPartnerTierRequirement(partnerTier, track.tier_requirement)) {
        return {
          ok: false,
          failure: validationFailure(
            `This track requires ${track.tier_requirement} tier or higher`,
            "trackId",
          ),
          correlationId,
        };
      }
    }

    // Upsert enrollment (ignore if already enrolled)
    const enrollmentId = randomUUID();
    await tx.query(
      `INSERT INTO learning_enrollments (id, user_id, track_id, status)
       VALUES ($1, $2, $3, 'in_progress')
       ON CONFLICT (user_id, track_id) DO NOTHING`,
      [enrollmentId, input.actor.userId, input.data.trackId],
    );

    return {
      ok: true,
      commandName: "learning.enroll",
      subjectId: enrollmentId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}
