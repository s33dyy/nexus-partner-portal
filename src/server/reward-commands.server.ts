import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import {
  createOutboxEnvelope,
  makeConcurrencyError,
  makePolicyDenial,
  type CommandExecutionResult,
  type CommandFailureContract,
} from "@/domain/contracts/commands";
import { evaluateActiveContextPolicy, type PolicyDecision } from "@/domain/contracts/governance";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { issueGyFTRVoucher } from "@/integrations/gyftr";
import { appendOutboxEnvelope, withTransaction } from "@/server/command-runtime.server";
import {
  resolveGovernedActor,
  type GovernedActor,
  type ResolveGovernedActorInput,
} from "@/server/governed-actor.server";
import { pool } from "@/server/postgres.server";

const REWARD_EVENT_SCHEMA_VERSION = 1;

export type RewardCommandActor = GovernedActor;
export type ResolveRewardCommandActorInput = ResolveGovernedActorInput;
export const resolveRewardCommandActor = resolveGovernedActor;

const REDEMPTION_REQUEST_ROLES = new Set(["partner_admin", "partner_user"]);
const CANCELLABLE_REDEMPTION_STATUSES = new Set(["points_reserved", "pending_review"]);

function validationFailure(message: string, field: string): CommandFailureContract {
  return {
    code: "VALIDATION_FAILED",
    message,
    fieldErrors: [{ field, message }],
    retryable: false,
  };
}

function policyFailure(subjectId: string | null, reason: string): CommandFailureContract {
  return makePolicyDenial(subjectId, reason);
}

function checkBasePolicy(actor: RewardCommandActor): PolicyDecision {
  return evaluateActiveContextPolicy({
    roles: [actor.assignment.roleKey],
    assignment: actor.assignment,
    activeContext: actor.activeContext,
  });
}

// A 23505 raised anywhere inside one of these transactions can only come
// from the idempotency-key partial unique indexes added in
// 20260801020000_risk_first_reward_integrity.sql — every other inserted id
// is a fresh randomUUID(). Treated as "another concurrent call with the
// same key already committed", never as a real failure.
function isIdempotencyKeyConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function recordRewardEvent(input: {
  tx: PoolClient;
  actor: RewardCommandActor;
  correlationId: string;
  commandName: string;
  eventName: string;
  subjectType: string;
  subjectId: string;
  payload: Record<string, unknown>;
}) {
  await input.tx.query(
    `INSERT INTO domain_activity_events (
       tenant_id, organization_tenant_id, subject_type, subject_id,
       actor_user_id, assignment_id, correlation_id, event_name, schema_version, payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.actor.assignment.tenantId,
      input.actor.assignment.organizationTenantId,
      input.subjectType,
      input.subjectId,
      input.actor.userId,
      input.actor.assignment.assignmentId,
      input.correlationId,
      input.eventName,
      REWARD_EVENT_SCHEMA_VERSION,
      JSON.stringify(input.payload),
    ],
  );

  await appendOutboxEnvelope(
    input.tx,
    createOutboxEnvelope({
      eventName: input.eventName,
      schemaVersion: REWARD_EVENT_SCHEMA_VERSION,
      aggregateType: input.subjectType,
      aggregateId: input.subjectId,
      tenantId: input.actor.assignment.tenantId,
      organizationTenantId: input.actor.assignment.organizationTenantId,
      actorUserId: input.actor.userId,
      assignmentId: input.actor.assignment.assignmentId,
      correlationId: input.correlationId,
      idempotencyKey: null,
      publishAfter: null,
      payload: input.payload,
    }),
  );
}

// ---------------------------------------------------------------------------
// Request + reservation
// ---------------------------------------------------------------------------

export type RequestRewardRedemptionInput = {
  rewardId: string;
  shippingName: string;
  shippingAddress: string;
  notes?: string | null;
  idempotencyKey: string;
};

type ExistingRedemptionRow = { id: string; user_id: string | null; version: number };

function replayResult(
  commandName: string,
  row: { id: string; version: number },
  correlationId: string,
  nextAuthorisedActions: readonly string[],
): CommandExecutionResult {
  return {
    ok: true,
    commandName,
    subjectId: row.id,
    newVersion: Number(row.version),
    nextAuthorisedActions,
    correlationId,
  };
}

export async function requestRewardRedemption(input: {
  actor: RewardCommandActor;
  data: RequestRewardRedemptionInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const rewardId = input.data.rewardId?.trim();
  const shippingName = input.data.shippingName?.trim();
  const shippingAddress = input.data.shippingAddress?.trim();
  const idempotencyKey = input.data.idempotencyKey?.trim();
  const notes = input.data.notes?.trim() || null;

  if (!rewardId || !shippingName || !shippingAddress || !idempotencyKey) {
    return {
      ok: false,
      failure: validationFailure(
        "A reward, shipping name, shipping address, and request key are required",
        "rewardId",
      ),
      correlationId,
    };
  }

  const role = input.actor.assignment.roleKey;
  if (!REDEMPTION_REQUEST_ROLES.has(role)) {
    return {
      ok: false,
      failure: policyFailure(null, "Only a partner user can request a reward redemption"),
      correlationId,
    };
  }
  const partnerId = input.actor.assignment.partnerId;
  if (!partnerId) {
    return {
      ok: false,
      failure: policyFailure(null, "A partner assignment is required to request a reward"),
      correlationId,
    };
  }

  const runRequest = () =>
    withTransaction<CommandExecutionResult>(async (tx) => {
      const basePolicy = checkBasePolicy(input.actor);
      if (!basePolicy.allowed) {
        return { ok: false, failure: basePolicy.denial, correlationId };
      }

      const existing = await tx.query(
        `SELECT id, user_id, version FROM reward_redemptions WHERE idempotency_key = $1 FOR UPDATE`,
        [idempotencyKey],
      );
      const existingRow = existing.rows[0] as ExistingRedemptionRow | undefined;
      if (existingRow) {
        if (existingRow.user_id !== input.actor.userId) {
          return {
            ok: false,
            failure: policyFailure(
              existingRow.id,
              "This request key was already used by a different actor",
            ),
            correlationId,
          };
        }
        return replayResult("reward.redemption.request", existingRow, correlationId, [
          "reward.redemption.review",
        ]);
      }

      const profileRes = await tx.query(`SELECT id FROM profiles WHERE id = $1 FOR UPDATE`, [
        input.actor.userId,
      ]);
      if (!profileRes.rows[0]) {
        return {
          ok: false,
          failure: policyFailure(null, "Requesting profile is not accessible"),
          correlationId,
        };
      }

      const itemRes = await tx.query(
        `SELECT id, title, points_cost, stock, availability, retired_at
         FROM reward_catalog_items WHERE id = $1 FOR UPDATE`,
        [rewardId],
      );
      const item = itemRes.rows[0] as
        | {
            id: string;
            title: string;
            points_cost: number;
            stock: number;
            availability: string;
            retired_at: string | null;
          }
        | undefined;
      if (
        !item ||
        item.retired_at ||
        item.availability !== "available" ||
        Number(item.stock) <= 0
      ) {
        return {
          ok: false,
          failure: validationFailure("This reward is not available for redemption", "rewardId"),
          correlationId,
        };
      }

      const balanceRes = await tx.query(
        `SELECT COALESCE(SUM(points_delta), 0)::integer AS balance
         FROM reward_point_events WHERE user_id = $1`,
        [input.actor.userId],
      );
      const balance = Number((balanceRes.rows[0] as { balance: number }).balance);
      const pointsCost = Number(item.points_cost);
      if (balance < pointsCost) {
        return {
          ok: false,
          failure: validationFailure("Not enough points for this reward", "rewardId"),
          correlationId,
        };
      }

      const redemptionId = randomUUID();
      await tx.query(
        `INSERT INTO reward_redemptions (
           id, reward_id, user_id, partner_id, points_cost, status,
           shipping_name, shipping_address, notes, idempotency_key, version,
           is_seed, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,'points_reserved',$6,$7,$8,$9,1,FALSE,now(),now())`,
        [
          redemptionId,
          item.id,
          input.actor.userId,
          partnerId,
          pointsCost,
          shippingName,
          shippingAddress,
          notes,
          idempotencyKey,
        ],
      );

      await tx.query(
        `INSERT INTO reward_point_events (
           id, user_id, partner_id, source_type, source_id, points_delta,
           reason, idempotency_key, reversal_of, is_seed, created_at
         ) VALUES ($1,$2,$3,'redemption_reservation',$4,$5,$6,$7,NULL,FALSE,now())`,
        [
          randomUUID(),
          input.actor.userId,
          partnerId,
          redemptionId,
          -pointsCost,
          `Reserved for ${item.title}`,
          `${idempotencyKey}:reservation`,
        ],
      );

      const stockUpdate = await tx.query(
        `UPDATE reward_catalog_items
         SET stock = stock - 1, updated_at = now()
         WHERE id = $1 AND stock > 0 AND availability = 'available' AND retired_at IS NULL`,
        [item.id],
      );
      if (stockUpdate.rowCount !== 1) {
        throw new Error("Reward stock changed concurrently");
      }

      await recordRewardEvent({
        tx,
        actor: input.actor,
        correlationId,
        commandName: "reward.redemption.request",
        eventName: "reward.redemption.requested",
        subjectType: "reward_redemption",
        subjectId: redemptionId,
        payload: { rewardId: item.id, pointsCost },
      });

      return {
        ok: true,
        commandName: "reward.redemption.request",
        subjectId: redemptionId,
        newVersion: 1,
        nextAuthorisedActions: ["reward.redemption.review"],
        correlationId,
      };
    });

  try {
    return await runRequest();
  } catch (error) {
    if (isIdempotencyKeyConflict(error)) {
      const { rows } = await pool.query(
        `SELECT id, user_id, version FROM reward_redemptions WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      const row = rows[0] as ExistingRedemptionRow | undefined;
      if (row && row.user_id === input.actor.userId) {
        return replayResult("reward.redemption.request", row, correlationId, [
          "reward.redemption.review",
        ]);
      }
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Review: approve / reject
// ---------------------------------------------------------------------------

type RedemptionForReviewRow = {
  id: string;
  status: string;
  version: number;
  reward_id: string;
  user_id: string | null;
  partner_id: string | null;
  points_cost: number;
};

async function loadRedemptionForUpdate(
  tx: PoolClient,
  redemptionId: string,
): Promise<RedemptionForReviewRow | null> {
  const { rows } = await tx.query(
    `SELECT id, status, version, reward_id, user_id, partner_id, points_cost
     FROM reward_redemptions WHERE id = $1 FOR UPDATE`,
    [redemptionId],
  );
  return (rows[0] as RedemptionForReviewRow | undefined) ?? null;
}

export async function approveRewardRedemption(input: {
  actor: RewardCommandActor;
  redemptionId: string;
  expectedVersion: number;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  if (input.actor.assignment.roleKey !== "super_admin") {
    return {
      ok: false,
      failure: policyFailure(input.redemptionId, "Only Super Admin can approve a redemption"),
      correlationId,
    };
  }

  const approvalResult = await withTransaction<CommandExecutionResult>(async (tx) => {
    const basePolicy = checkBasePolicy(input.actor);
    if (!basePolicy.allowed) {
      return { ok: false, failure: basePolicy.denial, correlationId };
    }

    const redemption = await loadRedemptionForUpdate(tx, input.redemptionId);
    if (!redemption) {
      return {
        ok: false,
        failure: makePolicyDenial(input.redemptionId, "Redemption is not accessible"),
        correlationId,
      };
    }
    if (Number(redemption.version) !== input.expectedVersion) {
      return {
        ok: false,
        failure: makeConcurrencyError(
          redemption.id,
          input.expectedVersion,
          Number(redemption.version),
        ),
        correlationId,
      };
    }
    if (!CANCELLABLE_REDEMPTION_STATUSES.has(redemption.status)) {
      return {
        ok: false,
        failure: validationFailure(
          `Redemption cannot be approved from status "${redemption.status}"`,
          "status",
        ),
        correlationId,
      };
    }

    const newVersion = Number(redemption.version) + 1;
    await tx.query(
      `UPDATE reward_redemptions
       SET status = 'processing', approved_by = $2, approved_at = now(),
           version = $3, updated_at = now()
       WHERE id = $1 AND version = $4`,
      [redemption.id, input.actor.userId, newVersion, input.expectedVersion],
    );

    await recordRewardEvent({
      tx,
      actor: input.actor,
      correlationId,
      commandName: "reward.redemption.approve",
      eventName: "reward.redemption.approved",
      subjectType: "reward_redemption",
      subjectId: redemption.id,
      payload: { rewardId: redemption.reward_id },
    });

    return {
      ok: true,
      commandName: "reward.redemption.approve",
      subjectId: redemption.id,
      newVersion,
      nextAuthorisedActions: [],
      correlationId,
    };
  });

  if (!approvalResult.ok) {
    return approvalResult;
  }

  // Best-effort fulfillment attempt, deliberately run as a separate step
  // from the approval transaction above so the GyFTR call never holds a DB
  // row lock (product.md §15.7: a provider timeout must stay Processing or
  // move to Failed on explicit adapter truth — it never blocks/duplicates
  // the approval itself). A failure here never overturns the approval;
  // approveRewardRedemption already succeeded by moving the redemption to
  // Processing.
  await attemptGyFTRFulfillment({
    redemptionId: approvalResult.subjectId,
    actor: input.actor,
    correlationId,
  });

  return approvalResult;
}

type RedemptionForFulfillmentRow = {
  id: string;
  reward_id: string;
  user_id: string | null;
  status: string;
  version: number;
};

// Attempts to move a just-approved (Processing) redemption to Fulfilled or
// Failed via the GyFTR adapter. See product.md §15.7/§15.8: provider
// vouchers are authoritative truth, never fabricated here — a missing
// GyFTR credential set is handled entirely inside issueGyFTRVoucher's own
// graceful stub fallback (src/integrations/gyftr/gyftr-client.ts), whose
// STUB-prefixed voucher code is itself the honest signal that no real
// voucher was issued. A genuine provider failure (ok: false) is recorded
// verbatim as failure_reason, never silently upgraded to success.
async function attemptGyFTRFulfillment(input: {
  redemptionId: string;
  actor: RewardCommandActor;
  correlationId: string;
}): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT id, reward_id, user_id, status, version
       FROM reward_redemptions WHERE id = $1`,
      [input.redemptionId],
    );
    const redemption = rows[0] as RedemptionForFulfillmentRow | undefined;
    if (!redemption || redemption.status !== "processing") return;

    let userEmail: string | undefined;
    let userMobile: string | undefined;
    if (redemption.user_id) {
      const profileRes = await pool.query(`SELECT email, phone FROM profiles WHERE id = $1`, [
        redemption.user_id,
      ]);
      const profileRow = profileRes.rows[0] as { email: string; phone: string | null } | undefined;
      userEmail = profileRow?.email;
      userMobile = profileRow?.phone ?? undefined;
    }

    // No dedicated GyFTR product-code field exists on reward_catalog_items
    // yet (deferred — see current gaps.md 15d); the catalogue item's own id
    // stands in as the product code for now.
    const voucher = await issueGyFTRVoucher({
      productCode: redemption.reward_id,
      quantity: 1,
      referenceId: redemption.id,
      userMobile,
      userEmail,
    });

    await withTransaction(async (tx) => {
      const current = await tx.query(
        `SELECT id, status, version FROM reward_redemptions WHERE id = $1 FOR UPDATE`,
        [redemption.id],
      );
      const currentRow = current.rows[0] as
        | { id: string; status: string; version: number }
        | undefined;
      // Only settle a row still Processing — a concurrent retry or manual
      // reconciliation that already moved it is left alone rather than
      // overwritten (never creates a second order/settlement).
      if (!currentRow || currentRow.status !== "processing") return;

      const newVersion = Number(currentRow.version) + 1;
      if (voucher.ok) {
        await tx.query(
          `UPDATE reward_redemptions
           SET status = 'fulfilled', fulfillment_provider = 'gyftr',
               fulfillment_reference = $2, fulfillment_voucher_code = $3,
               fulfillment_expires_at = $4, fulfilled_at = now(),
               failure_reason = NULL, version = $5, updated_at = now()
           WHERE id = $1 AND version = $6`,
          [
            redemption.id,
            voucher.fulfillmentRef,
            voucher.voucherCode,
            voucher.expiryDate,
            newVersion,
            currentRow.version,
          ],
        );
        await recordRewardEvent({
          tx,
          actor: input.actor,
          correlationId: input.correlationId,
          commandName: "reward.redemption.fulfill",
          eventName: "reward.redemption.fulfilled",
          subjectType: "reward_redemption",
          subjectId: redemption.id,
          payload: { provider: "gyftr", fulfillmentRef: voucher.fulfillmentRef },
        });
      } else {
        await tx.query(
          `UPDATE reward_redemptions
           SET status = 'failed', failure_reason = $2, version = $3, updated_at = now()
           WHERE id = $1 AND version = $4`,
          [
            redemption.id,
            `${voucher.errorCode}: ${voucher.errorMessage}`,
            newVersion,
            currentRow.version,
          ],
        );
        await recordRewardEvent({
          tx,
          actor: input.actor,
          correlationId: input.correlationId,
          commandName: "reward.redemption.fulfill",
          eventName: "reward.redemption.failed",
          subjectType: "reward_redemption",
          subjectId: redemption.id,
          payload: {
            provider: "gyftr",
            errorCode: voucher.errorCode,
            errorMessage: voucher.errorMessage,
          },
        });
      }
    });
  } catch (error) {
    // Never let a fulfillment-attempt failure overturn the approval above.
    // Best-effort: record what we can, but swallow if even that fails
    // (e.g. DB unreachable) — the redemption is left truthfully at
    // Processing rather than any status being fabricated.
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[reward-commands] GyFTR fulfillment attempt failed for redemption ${input.redemptionId}: ${message}`,
    );
    try {
      await pool.query(
        `UPDATE reward_redemptions
         SET status = 'failed', failure_reason = $2, version = version + 1, updated_at = now()
         WHERE id = $1 AND status = 'processing'`,
        [input.redemptionId, `INTERNAL_ERROR: ${message}`],
      );
    } catch {
      // Swallow — already logged above.
    }
  }
}

export async function rejectRewardRedemption(input: {
  actor: RewardCommandActor;
  redemptionId: string;
  expectedVersion: number;
  reason: string;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const reason = input.reason?.trim();
  if (input.actor.assignment.roleKey !== "super_admin") {
    return {
      ok: false,
      failure: policyFailure(input.redemptionId, "Only Super Admin can reject a redemption"),
      correlationId,
    };
  }
  if (!reason) {
    return {
      ok: false,
      failure: validationFailure("A reason is required to reject a redemption", "reason"),
      correlationId,
    };
  }

  return withTransaction(async (tx) => {
    const basePolicy = checkBasePolicy(input.actor);
    if (!basePolicy.allowed) {
      return { ok: false, failure: basePolicy.denial, correlationId };
    }

    const redemption = await loadRedemptionForUpdate(tx, input.redemptionId);
    if (!redemption) {
      return {
        ok: false,
        failure: makePolicyDenial(input.redemptionId, "Redemption is not accessible"),
        correlationId,
      };
    }
    if (Number(redemption.version) !== input.expectedVersion) {
      return {
        ok: false,
        failure: makeConcurrencyError(
          redemption.id,
          input.expectedVersion,
          Number(redemption.version),
        ),
        correlationId,
      };
    }
    if (!CANCELLABLE_REDEMPTION_STATUSES.has(redemption.status)) {
      return {
        ok: false,
        failure: validationFailure(
          `Redemption cannot be cancelled from status "${redemption.status}"`,
          "status",
        ),
        correlationId,
      };
    }

    if (redemption.user_id) {
      await tx.query(`SELECT id FROM profiles WHERE id = $1 FOR UPDATE`, [redemption.user_id]);
    }
    await tx.query(`SELECT id FROM reward_catalog_items WHERE id = $1 FOR UPDATE`, [
      redemption.reward_id,
    ]);

    const reservationRes = await tx.query(
      `SELECT id FROM reward_point_events
       WHERE source_type = 'redemption_reservation' AND source_id = $1
       LIMIT 1`,
      [redemption.id],
    );
    const reservation = reservationRes.rows[0] as { id: string } | undefined;
    if (!reservation) {
      return {
        ok: false,
        failure: makePolicyDenial(redemption.id, "No reservation found for this redemption"),
        correlationId,
      };
    }
    const releaseExists = await tx.query(
      `SELECT id FROM reward_point_events WHERE reversal_of = $1 LIMIT 1`,
      [reservation.id],
    );
    if (releaseExists.rows[0]) {
      return {
        ok: false,
        failure: makePolicyDenial(redemption.id, "This reservation was already released"),
        correlationId,
      };
    }

    await tx.query(
      `INSERT INTO reward_point_events (
         id, user_id, partner_id, source_type, source_id, points_delta,
         reason, idempotency_key, reversal_of, approved_by, approved_at,
         is_seed, created_at
       ) VALUES ($1,$2,$3,'reservation_release',$4,$5,$6,$7,$8,$9,now(),FALSE,now())`,
      [
        randomUUID(),
        redemption.user_id,
        redemption.partner_id,
        redemption.id,
        Math.abs(Number(redemption.points_cost)),
        reason,
        `reward:${redemption.id}:release`,
        reservation.id,
        input.actor.userId,
      ],
    );

    const stockRes = await tx.query(
      `UPDATE reward_catalog_items SET stock = stock + 1, updated_at = now() WHERE id = $1`,
      [redemption.reward_id],
    );
    if (stockRes.rowCount !== 1) {
      throw new Error("Reward catalogue item could not be restocked");
    }

    const newVersion = Number(redemption.version) + 1;
    await tx.query(
      `UPDATE reward_redemptions
       SET status = 'cancelled', approved_by = $2, approved_at = now(),
           version = $3, updated_at = now()
       WHERE id = $1 AND version = $4`,
      [redemption.id, input.actor.userId, newVersion, input.expectedVersion],
    );

    await recordRewardEvent({
      tx,
      actor: input.actor,
      correlationId,
      commandName: "reward.redemption.reject",
      eventName: "reward.redemption.rejected",
      subjectType: "reward_redemption",
      subjectId: redemption.id,
      payload: { reason },
    });

    return {
      ok: true,
      commandName: "reward.redemption.reject",
      subjectId: redemption.id,
      newVersion,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

// ---------------------------------------------------------------------------
// Catalogue retirement
// ---------------------------------------------------------------------------

export async function retireRewardCatalogItem(input: {
  actor: RewardCommandActor;
  rewardId: string;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  if (input.actor.assignment.roleKey !== "super_admin") {
    return {
      ok: false,
      failure: policyFailure(input.rewardId, "Only Super Admin can retire a reward"),
      correlationId,
    };
  }

  return withTransaction(async (tx) => {
    const basePolicy = checkBasePolicy(input.actor);
    if (!basePolicy.allowed) {
      return { ok: false, failure: basePolicy.denial, correlationId };
    }

    const { rows } = await tx.query(
      `SELECT id, retired_at FROM reward_catalog_items WHERE id = $1 FOR UPDATE`,
      [input.rewardId],
    );
    const item = rows[0] as { id: string; retired_at: string | null } | undefined;
    if (!item) {
      return {
        ok: false,
        failure: makePolicyDenial(input.rewardId, "Reward catalogue item is not accessible"),
        correlationId,
      };
    }

    const alreadyRetired = Boolean(item.retired_at);
    await tx.query(
      `UPDATE reward_catalog_items
       SET availability = 'retired', stock = 0,
           retired_at = COALESCE(retired_at, now()),
           retired_by = COALESCE(retired_by, $2), updated_at = now()
       WHERE id = $1`,
      [item.id, input.actor.userId],
    );

    if (!alreadyRetired) {
      await recordRewardEvent({
        tx,
        actor: input.actor,
        correlationId,
        commandName: "reward.catalog.retire",
        eventName: "reward.catalog.retired",
        subjectType: "reward_catalog_item",
        subjectId: item.id,
        payload: {},
      });
    }

    return {
      ok: true,
      commandName: "reward.catalog.retire",
      subjectId: item.id,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

// ---------------------------------------------------------------------------
// Manual point adjustment
// ---------------------------------------------------------------------------

export type AdjustRewardPointsInput = {
  userId: string;
  pointsDelta: number;
  reason: string;
  idempotencyKey: string;
};

export async function adjustRewardPoints(input: {
  actor: RewardCommandActor;
  data: AdjustRewardPointsInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  if (input.actor.assignment.roleKey !== "super_admin") {
    return {
      ok: false,
      failure: policyFailure(null, "Only Super Admin can adjust reward points"),
      correlationId,
    };
  }

  const userId = input.data.userId?.trim();
  const reason = input.data.reason?.trim();
  const idempotencyKey = input.data.idempotencyKey?.trim();
  const pointsDelta = Math.trunc(input.data.pointsDelta);
  if (!userId || !reason || !idempotencyKey || !Number.isFinite(pointsDelta) || pointsDelta === 0) {
    return {
      ok: false,
      failure: validationFailure(
        "A user, non-zero integer point delta, reason, and request key are required",
        "pointsDelta",
      ),
      correlationId,
    };
  }

  const runAdjustment = () =>
    withTransaction<CommandExecutionResult>(async (tx) => {
      const basePolicy = checkBasePolicy(input.actor);
      if (!basePolicy.allowed) {
        return { ok: false, failure: basePolicy.denial, correlationId };
      }

      const existing = await tx.query(
        `SELECT id FROM reward_point_events WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      const existingRow = existing.rows[0] as { id: string } | undefined;
      if (existingRow) {
        return {
          ok: true,
          commandName: "reward.points.adjust",
          subjectId: existingRow.id,
          newVersion: 1,
          nextAuthorisedActions: [],
          correlationId,
        };
      }

      const profileRes = await tx.query(
        `SELECT id, partner_id FROM profiles WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      const profileRow = profileRes.rows[0] as
        | { id: string; partner_id: string | null }
        | undefined;
      if (!profileRow) {
        return {
          ok: false,
          failure: makePolicyDenial(userId, "Target user is not accessible"),
          correlationId,
        };
      }

      if (pointsDelta < 0) {
        const balanceRes = await tx.query(
          `SELECT COALESCE(SUM(points_delta), 0)::integer AS balance
           FROM reward_point_events WHERE user_id = $1`,
          [userId],
        );
        const balance = Number((balanceRes.rows[0] as { balance: number }).balance);
        if (balance + pointsDelta < 0) {
          return {
            ok: false,
            failure: validationFailure(
              "This adjustment would make the balance negative",
              "pointsDelta",
            ),
            correlationId,
          };
        }
      }

      const eventId = randomUUID();
      await tx.query(
        `INSERT INTO reward_point_events (
           id, user_id, partner_id, source_type, source_id, points_delta,
           reason, approved_by, approved_at, idempotency_key, reversal_of,
           is_seed, created_at
         ) VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,now(),$8,NULL,FALSE,now())`,
        [
          eventId,
          userId,
          profileRow.partner_id,
          pointsDelta > 0 ? "manual_credit" : "manual_debit",
          pointsDelta,
          reason,
          input.actor.userId,
          idempotencyKey,
        ],
      );

      await recordRewardEvent({
        tx,
        actor: input.actor,
        correlationId,
        commandName: "reward.points.adjust",
        eventName: "reward.points.adjusted",
        subjectType: "reward_point_event",
        subjectId: eventId,
        payload: { userId, pointsDelta, reason },
      });

      return {
        ok: true,
        commandName: "reward.points.adjust",
        subjectId: eventId,
        newVersion: 1,
        nextAuthorisedActions: [],
        correlationId,
      };
    });

  try {
    return await runAdjustment();
  } catch (error) {
    if (isIdempotencyKeyConflict(error)) {
      const { rows } = await pool.query(
        `SELECT id FROM reward_point_events WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      const row = rows[0] as { id: string } | undefined;
      if (row) {
        return {
          ok: true,
          commandName: "reward.points.adjust",
          subjectId: row.id,
          newVersion: 1,
          nextAuthorisedActions: [],
          correlationId,
        };
      }
    }
    throw error;
  }
}
