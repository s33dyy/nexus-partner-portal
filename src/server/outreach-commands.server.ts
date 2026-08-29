import { randomBytes, randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import {
  createOutboxEnvelope,
  makeConcurrencyError,
  makePolicyDenial,
  type CommandExecutionResult,
  type CommandFailureContract,
} from "@/domain/contracts/commands";
import {
  computeStepSchedule,
  getUnenrollReason,
  isAllowedSequenceTransition,
  isPlausibleOutreachEmail,
  normalizeOutreachEmail,
  scheduledInstant,
  validateSequenceSteps,
  type OutreachSequenceStatus,
  type OutreachStepType,
  type SequenceStepDraft,
} from "@/domain/contracts/outreach";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { zonedCalendarDate, zonedDayRange } from "@/server/app-time.server";
import { appendOutboxEnvelope, withTransaction } from "@/server/command-runtime.server";
import { authorizeOutreach, type OutreachActor } from "@/server/outreach-policy.server";

/**
 * Write side of outreach sequences.
 *
 * Every command here authorises first, then writes inside a single
 * transaction, then records the same three artefacts every other governed
 * command in this codebase records: a domain_activity_events row, a
 * command_outbox envelope, and an optimistic version bump. Nothing in this
 * module sends anything — the sweep in outreach-sweep.server.ts owns
 * delivery, and keeping the two apart is what lets an enrolment be created
 * inside a transaction that might still roll back.
 */

const OUTREACH_EVENT_SCHEMA_VERSION = 1;

export type OutreachCommandActor = OutreachActor;

function validationFailure(message: string, field: string): CommandFailureContract {
  return {
    code: "VALIDATION_FAILED",
    message,
    fieldErrors: [{ field, message }],
    retryable: false,
  };
}

type SequenceSnapshot = {
  id: string;
  name: string;
  description: string;
  status: OutreachSequenceStatus;
  ownerId: string | null;
  partnerId: string | null;
  version: number;
  businessDaysOnly: boolean;
  threadAsReply: boolean;
  unenrollOnDealCreated: boolean;
};

async function loadSequenceForUpdate(
  tx: PoolClient,
  sequenceId: string,
): Promise<SequenceSnapshot | null> {
  const { rows } = await tx.query(
    `SELECT id, name, description, status, owner_id, partner_id, version,
            business_days_only, thread_as_reply, unenroll_on_deal_created
     FROM outreach_sequences WHERE id = $1 FOR UPDATE`,
    [sequenceId],
  );
  const row = rows[0] as
    | {
        id: string;
        name: string;
        description: string;
        status: string;
        owner_id: string | null;
        partner_id: string | null;
        version: number;
        business_days_only: boolean;
        thread_as_reply: boolean;
        unenroll_on_deal_created: boolean;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    status: row.status as OutreachSequenceStatus,
    ownerId: row.owner_id,
    partnerId: row.partner_id,
    version: Number(row.version),
    businessDaysOnly: row.business_days_only,
    threadAsReply: row.thread_as_reply,
    unenrollOnDealCreated: row.unenroll_on_deal_created,
  };
}

async function recordOutreachEvent(input: {
  tx: PoolClient;
  actor: OutreachCommandActor;
  correlationId: string;
  eventName: string;
  subjectType: "outreach_sequence" | "outreach_enrollment";
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
      OUTREACH_EVENT_SCHEMA_VERSION,
      JSON.stringify(input.payload),
    ],
  );

  await appendOutboxEnvelope(
    input.tx,
    createOutboxEnvelope({
      eventName: input.eventName,
      schemaVersion: OUTREACH_EVENT_SCHEMA_VERSION,
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

/** Partner-scoped roles can only ever own a sequence inside their own
 * tenant, whatever the request body claims. Internal roles (rm/pam/kam/isr,
 * super_admin) have no partner of their own and own theirs personally. */
function resolveSequencePartnerId(actor: OutreachCommandActor): string | null {
  return actor.assignment.partnerId ?? null;
}

// ---------------------------------------------------------------------------
// Sequence lifecycle
// ---------------------------------------------------------------------------

export type CreateSequenceInput = {
  name: string;
  description?: string | null;
  businessDaysOnly?: boolean;
  threadAsReply?: boolean;
  unenrollOnDealCreated?: boolean;
  steps: SequenceStepDraft[];
};

export async function createSequence(input: {
  actor: OutreachCommandActor;
  data: CreateSequenceInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();
  const name = input.data.name.trim();
  if (!name) {
    return {
      ok: false,
      failure: validationFailure("A sequence needs a name", "name"),
      correlationId,
    };
  }

  const stepFailure = validateSequenceSteps(input.data.steps);
  if (stepFailure) {
    return {
      ok: false,
      failure: validationFailure(
        stepFailure.index === null
          ? stepFailure.message
          : `Step ${stepFailure.index + 1}: ${stepFailure.message}`,
        "steps",
      ),
      correlationId,
    };
  }

  const policy = await authorizeOutreach({ actor: input.actor, operation: "create" });
  if (!policy.allowed) return { ok: false, failure: policy.denial, correlationId };

  return withTransaction(async (tx) => {
    const sequenceId = randomUUID();
    await tx.query(
      `INSERT INTO outreach_sequences (
         id, name, description, status, owner_id, partner_id,
         business_days_only, thread_as_reply, unenroll_on_deal_created, version
       ) VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,1)`,
      [
        sequenceId,
        name,
        input.data.description?.trim() || "",
        input.actor.userId,
        resolveSequencePartnerId(input.actor),
        input.data.businessDaysOnly ?? true,
        input.data.threadAsReply ?? true,
        input.data.unenrollOnDealCreated ?? true,
      ],
    );

    await insertSteps(tx, sequenceId, input.data.steps);

    await recordOutreachEvent({
      tx,
      actor: input.actor,
      correlationId,
      eventName: "outreach.sequence.created",
      subjectType: "outreach_sequence",
      subjectId: sequenceId,
      payload: { name, stepCount: input.data.steps.length },
    });

    return {
      ok: true,
      commandName: "outreach.sequence.create",
      subjectId: sequenceId,
      newVersion: 1,
      nextAuthorisedActions: ["outreach.sequence.saveSteps", "outreach.sequence.setStatus"],
      correlationId,
    };
  });
}

async function insertSteps(tx: PoolClient, sequenceId: string, steps: SequenceStepDraft[]) {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    await tx.query(
      `INSERT INTO outreach_sequence_steps (
         sequence_id, step_index, step_type, day_offset, subject, body, task_title, task_priority
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        sequenceId,
        index,
        step.stepType,
        step.dayOffset,
        step.stepType === "email" ? step.subject.trim() : "",
        step.stepType === "email" ? step.body.trim() : "",
        step.stepType === "task" ? step.taskTitle.trim() : "",
        step.taskPriority?.trim() || "medium",
      ],
    );
  }
}

export type SaveSequenceStepsInput = {
  sequenceId: string;
  expectedVersion: number;
  name?: string | null;
  description?: string | null;
  businessDaysOnly?: boolean;
  threadAsReply?: boolean;
  unenrollOnDealCreated?: boolean;
  steps: SequenceStepDraft[];
};

/**
 * Replaces a sequence's steps wholesale.
 *
 * Deleting and re-inserting is safe precisely because
 * outreach_step_executions snapshots step_index/step_type and every rendered
 * message is produced from the step row at send time — but the executions
 * are created at ENROLMENT time and their FK is ON DELETE CASCADE, so
 * re-cutting steps under a live enrolment would delete its remaining
 * timeline. Editing is therefore refused while any enrolment is still
 * running, which is also the behaviour a rep expects: a cadence somebody is
 * halfway through must not change under them.
 */
export async function saveSequenceSteps(input: {
  actor: OutreachCommandActor;
  data: SaveSequenceStepsInput;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();

  const stepFailure = validateSequenceSteps(input.data.steps);
  if (stepFailure) {
    return {
      ok: false,
      failure: validationFailure(
        stepFailure.index === null
          ? stepFailure.message
          : `Step ${stepFailure.index + 1}: ${stepFailure.message}`,
        "steps",
      ),
      correlationId,
    };
  }

  return withTransaction(async (tx) => {
    const sequence = await loadSequenceForUpdate(tx, input.data.sequenceId);
    if (!sequence) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Sequence is not accessible"),
        correlationId,
      };
    }

    const policy = await authorizeOutreach({
      actor: input.actor,
      operation: "update",
      sequence: { ownerId: sequence.ownerId, partnerId: sequence.partnerId },
    });
    if (!policy.allowed) return { ok: false, failure: policy.denial, correlationId };

    if (sequence.version !== input.data.expectedVersion) {
      return {
        ok: false,
        failure: makeConcurrencyError(sequence.id, input.data.expectedVersion, sequence.version),
        correlationId,
      };
    }

    const { rows: activeRows } = await tx.query(
      `SELECT count(*)::int AS count FROM outreach_enrollments
       WHERE sequence_id = $1 AND status = 'active'`,
      [sequence.id],
    );
    const activeCount = Number((activeRows[0] as { count: number } | undefined)?.count ?? 0);
    if (activeCount > 0) {
      return {
        ok: false,
        failure: validationFailure(
          `${activeCount} contact${activeCount === 1 ? " is" : "s are"} still running this sequence — stop them before editing the steps`,
          "steps",
        ),
        correlationId,
      };
    }

    await tx.query(`DELETE FROM outreach_sequence_steps WHERE sequence_id = $1`, [sequence.id]);
    await insertSteps(tx, sequence.id, input.data.steps);

    const nextVersion = sequence.version + 1;
    await tx.query(
      `UPDATE outreach_sequences
       SET name = $2, description = $3, business_days_only = $4, thread_as_reply = $5,
           unenroll_on_deal_created = $6, version = $7
       WHERE id = $1`,
      [
        sequence.id,
        input.data.name?.trim() || sequence.name,
        // `undefined` means the caller didn't send the field and the stored
        // description is kept; an explicit empty string clears it. `?? ""`
        // would have let any caller that omits the field silently blank it.
        input.data.description === undefined
          ? sequence.description
          : (input.data.description?.trim() ?? ""),
        // All three fall back to what is STORED, never to the create-time
        // default. `?? true` here meant any caller that omitted a flag
        // silently switched it back on — so a sequence deliberately set to
        // keep mailing after a deal opened would quietly start unenrolling
        // again the next time somebody renamed it.
        input.data.businessDaysOnly ?? sequence.businessDaysOnly,
        input.data.threadAsReply ?? sequence.threadAsReply,
        input.data.unenrollOnDealCreated ?? sequence.unenrollOnDealCreated,
        nextVersion,
      ],
    );

    await recordOutreachEvent({
      tx,
      actor: input.actor,
      correlationId,
      eventName: "outreach.sequence.updated",
      subjectType: "outreach_sequence",
      subjectId: sequence.id,
      payload: { stepCount: input.data.steps.length },
    });

    return {
      ok: true,
      commandName: "outreach.sequence.saveSteps",
      subjectId: sequence.id,
      newVersion: nextVersion,
      nextAuthorisedActions: ["outreach.sequence.setStatus", "outreach.enrollment.create"],
      correlationId,
    };
  });
}

export async function setSequenceStatus(input: {
  actor: OutreachCommandActor;
  sequenceId: string;
  expectedVersion: number;
  toStatus: OutreachSequenceStatus;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();

  return withTransaction(async (tx) => {
    const sequence = await loadSequenceForUpdate(tx, input.sequenceId);
    if (!sequence) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Sequence is not accessible"),
        correlationId,
      };
    }

    const policy = await authorizeOutreach({
      actor: input.actor,
      operation: "update",
      sequence: { ownerId: sequence.ownerId, partnerId: sequence.partnerId },
    });
    if (!policy.allowed) return { ok: false, failure: policy.denial, correlationId };

    if (sequence.version !== input.expectedVersion) {
      return {
        ok: false,
        failure: makeConcurrencyError(sequence.id, input.expectedVersion, sequence.version),
        correlationId,
      };
    }

    if (sequence.status === input.toStatus) {
      // Idempotent: two clicks on "Activate" is not an error, and reporting
      // one as a failed transition would be a lie.
      return {
        ok: true,
        commandName: "outreach.sequence.setStatus",
        subjectId: sequence.id,
        newVersion: sequence.version,
        nextAuthorisedActions: ["outreach.enrollment.create"],
        correlationId,
      };
    }

    if (!isAllowedSequenceTransition(sequence.status, input.toStatus)) {
      return {
        ok: false,
        failure: validationFailure(
          `A ${sequence.status} sequence cannot become ${input.toStatus}`,
          "status",
        ),
        correlationId,
      };
    }

    if (input.toStatus === "active") {
      const { rows } = await tx.query(
        `SELECT count(*)::int AS count FROM outreach_sequence_steps WHERE sequence_id = $1`,
        [sequence.id],
      );
      if (Number((rows[0] as { count: number } | undefined)?.count ?? 0) === 0) {
        return {
          ok: false,
          failure: validationFailure(
            "A sequence needs at least one step before it goes live",
            "steps",
          ),
          correlationId,
        };
      }
    }

    const nextVersion = sequence.version + 1;
    await tx.query(`UPDATE outreach_sequences SET status = $2, version = $3 WHERE id = $1`, [
      sequence.id,
      input.toStatus,
      nextVersion,
    ]);

    // Archiving stops the cadence for everyone still on it. Leaving live
    // enrolments pointing at an archived sequence would keep the sweep
    // mailing from something the owner believes they switched off.
    if (input.toStatus === "archived") {
      await stopActiveEnrollments(tx, sequence.id, "stopped_by_owner");
    }

    await recordOutreachEvent({
      tx,
      actor: input.actor,
      correlationId,
      eventName: `outreach.sequence.${input.toStatus}`,
      subjectType: "outreach_sequence",
      subjectId: sequence.id,
      payload: { fromStatus: sequence.status, toStatus: input.toStatus },
    });

    return {
      ok: true,
      commandName: "outreach.sequence.setStatus",
      subjectId: sequence.id,
      newVersion: nextVersion,
      nextAuthorisedActions:
        input.toStatus === "active"
          ? ["outreach.enrollment.create"]
          : ["outreach.sequence.setStatus"],
      correlationId,
    };
  });
}

async function stopActiveEnrollments(tx: PoolClient, sequenceId: string, reason: string) {
  const { rows } = await tx.query(
    `UPDATE outreach_enrollments
     SET status = 'unenrolled', unenroll_reason = $2, unenrolled_at = now(), version = version + 1
     WHERE sequence_id = $1 AND status = 'active'
     RETURNING id`,
    [sequenceId, reason],
  );
  const ids = (rows as Array<{ id: string }>).map((row) => row.id);
  if (ids.length === 0) return;
  await tx.query(
    `UPDATE outreach_step_executions
     SET status = 'skipped', detail = 'Enrolment stopped'
     WHERE enrollment_id = ANY($1::uuid[]) AND status = 'pending'`,
    [ids],
  );
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

export type EnrollContactInput = {
  customerId?: string | null;
  contactName: string;
  contactEmail: string;
  personalNote?: string | null;
};

export type EnrollContactsInput = {
  sequenceId: string;
  contacts: EnrollContactInput[];
};

export type EnrollmentOutcome = {
  contactEmail: string;
  enrolled: boolean;
  enrollmentId: string | null;
  reason: string | null;
};

export type EnrollContactsResult =
  | { ok: true; correlationId: string; outcomes: EnrollmentOutcome[] }
  | { ok: false; correlationId: string; failure: CommandFailureContract };

/**
 * Enrols one or more contacts and materialises their whole timeline.
 *
 * Partial success is the contract: enrolling five people where one address
 * has unsubscribed must enrol the other four and say so, not fail the batch.
 * Each contact therefore gets its own outcome and its own savepoint-free
 * insert — the batch runs in one transaction, but a rejected contact is
 * rejected by a pre-check, never by a thrown constraint.
 */
export async function enrollContacts(input: {
  actor: OutreachCommandActor;
  data: EnrollContactsInput;
  now?: Date;
}): Promise<EnrollContactsResult> {
  const correlationId = createCorrelationId();

  if (input.data.contacts.length === 0) {
    return {
      ok: false,
      correlationId,
      failure: validationFailure("Pick at least one contact to enrol", "contacts"),
    };
  }

  return withTransaction(async (tx) => {
    const sequence = await loadSequenceForUpdate(tx, input.data.sequenceId);
    if (!sequence) {
      return {
        ok: false as const,
        correlationId,
        failure: makePolicyDenial(null, "Sequence is not accessible"),
      };
    }

    const policy = await authorizeOutreach({
      actor: input.actor,
      operation: "create",
      sequence: { ownerId: sequence.ownerId, partnerId: sequence.partnerId },
    });
    if (!policy.allowed) {
      return { ok: false as const, correlationId, failure: policy.denial };
    }

    if (sequence.status !== "active") {
      return {
        ok: false as const,
        correlationId,
        failure: validationFailure("Only an active sequence can enrol contacts", "sequenceId"),
      };
    }

    const { rows: stepRows } = await tx.query(
      `SELECT id, step_index, step_type, day_offset, subject, task_title
       FROM outreach_sequence_steps WHERE sequence_id = $1 ORDER BY step_index ASC`,
      [sequence.id],
    );
    const steps = (
      stepRows as Array<{
        id: string;
        step_index: number;
        step_type: string;
        day_offset: number;
        subject: string;
        task_title: string;
      }>
    ).map((row) => ({
      id: row.id,
      stepIndex: Number(row.step_index),
      stepType: row.step_type as OutreachStepType,
      dayOffset: Number(row.day_offset),
      subject: row.subject ?? "",
      taskTitle: row.task_title ?? "",
    }));

    if (steps.length === 0) {
      return {
        ok: false as const,
        correlationId,
        failure: validationFailure("This sequence has no steps", "sequenceId"),
      };
    }

    const now = input.now ?? new Date();
    const startDate = zonedCalendarDate(now);

    /**
     * Customer ids arrive from the client and were previously written
     * straight through. They are not inert: the sweep joins portal_customers
     * to resolve {{company}}/{{country}}/{{segment}}, and the enrolment list
     * renders the company name — so an id from outside the caller's scope
     * would have pulled another tenant's customer into their UI and into the
     * body of a message they send. Each distinct id is resolved once against
     * the same scope listOutreachCustomers() offers, and anything outside it
     * is dropped to null rather than failing the batch: the enrolment is
     * still valid, it simply carries no company context.
     */
    const actorPartnerId = input.actor.assignment.partnerId ?? null;
    const requestedCustomerIds = [
      ...new Set(
        input.data.contacts
          .map((contact) => contact.customerId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    const allowedCustomerIds = new Set<string>();
    if (requestedCustomerIds.length > 0) {
      const { rows: customerRows } = await tx.query(
        actorPartnerId
          ? `SELECT id FROM portal_customers WHERE id = ANY($1::uuid[]) AND partner_id = $2`
          : `SELECT id FROM portal_customers WHERE id = ANY($1::uuid[])`,
        actorPartnerId ? [requestedCustomerIds, actorPartnerId] : [requestedCustomerIds],
      );
      for (const row of customerRows as Array<{ id: string }>) {
        allowedCustomerIds.add(String(row.id));
      }
    }
    const outcomes: EnrollmentOutcome[] = [];
    const seenInBatch = new Set<string>();

    for (const contact of input.data.contacts) {
      const email = contact.contactEmail.trim();
      const normalized = normalizeOutreachEmail(email);

      if (!isPlausibleOutreachEmail(email)) {
        outcomes.push({
          contactEmail: email,
          enrolled: false,
          enrollmentId: null,
          reason: "That is not a valid email address",
        });
        continue;
      }
      if (seenInBatch.has(normalized)) {
        outcomes.push({
          contactEmail: email,
          enrolled: false,
          enrollmentId: null,
          reason: "Listed twice in this batch",
        });
        continue;
      }
      seenInBatch.add(normalized);

      const { rows: suppressed } = await tx.query(
        `SELECT reason FROM outreach_suppressions WHERE email_normalized = $1`,
        [normalized],
      );
      if (suppressed.length > 0) {
        outcomes.push({
          contactEmail: email,
          enrolled: false,
          enrollmentId: null,
          reason: "This address has unsubscribed",
        });
        continue;
      }

      const { rows: existing } = await tx.query(
        `SELECT id FROM outreach_enrollments
         WHERE sequence_id = $1 AND contact_email_normalized = $2 AND status = 'active'`,
        [sequence.id, normalized],
      );
      if (existing.length > 0) {
        outcomes.push({
          contactEmail: email,
          enrolled: false,
          enrollmentId: null,
          reason: "Already running this sequence",
        });
        continue;
      }

      const enrollmentId = randomUUID();
      await tx.query(
        `INSERT INTO outreach_enrollments (
           id, sequence_id, customer_id, contact_name, contact_email, contact_email_normalized,
           personal_note, status, enrolled_by, partner_id, start_date, version
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10::date,1)`,
        [
          enrollmentId,
          sequence.id,
          contact.customerId && allowedCustomerIds.has(contact.customerId)
            ? contact.customerId
            : null,
          contact.contactName.trim(),
          email,
          normalized,
          contact.personalNote?.trim() || "",
          input.actor.userId,
          sequence.partnerId,
          startDate,
        ],
      );

      const schedule = computeStepSchedule({
        startDate,
        steps: steps.map((step) => ({ stepIndex: step.stepIndex, dayOffset: step.dayOffset })),
        businessDaysOnly: sequence.businessDaysOnly,
      });

      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index]!;
        const entry = schedule[index]!;
        await tx.query(
          // subject/task_title are copied, not just referenced. The step row
          // they came from can be deleted by a later edit; this row has to
          // still be able to say what it did.
          `INSERT INTO outreach_step_executions (
             enrollment_id, step_id, step_index, step_type, scheduled_for, status,
             tracking_token, step_subject, step_task_title
           ) VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8)`,
          [
            enrollmentId,
            step.id,
            step.stepIndex,
            step.stepType,
            scheduledInstant(entry.scheduledDate, zoneOffsetMinutes(entry.scheduledDate)),
            step.stepType === "email" ? randomBytes(24).toString("base64url") : null,
            step.subject,
            step.taskTitle,
          ],
        );
      }

      await recordOutreachEvent({
        tx,
        actor: input.actor,
        correlationId,
        eventName: "outreach.enrollment.created",
        subjectType: "outreach_enrollment",
        subjectId: enrollmentId,
        payload: { sequenceId: sequence.id, startDate, stepCount: steps.length },
      });

      outcomes.push({ contactEmail: email, enrolled: true, enrollmentId, reason: null });
    }

    return { ok: true as const, correlationId, outcomes };
  });
}

/**
 * How far ahead of UTC the business timezone is on that calendar date, in
 * minutes. Measured per date rather than once, so a cadence that straddles a
 * DST change still fires at 8am local on both sides of it.
 */
function zoneOffsetMinutes(date: string): number {
  const range = zonedDayRange(date);
  if (!range) return 0;
  const utcMidnight = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(utcMidnight)) return 0;
  return Math.round((utcMidnight - range.startUtc.getTime()) / 60_000);
}

export async function unenrollContact(input: {
  actor: OutreachCommandActor;
  enrollmentId: string;
  expectedVersion: number;
  reasonKey: string;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();

  const reason = getUnenrollReason(input.reasonKey);
  if (!reason || !reason.manual) {
    return {
      ok: false,
      failure: validationFailure("Pick an outcome for this contact", "reasonKey"),
      correlationId,
    };
  }

  return withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT e.id, e.status, e.version, e.sequence_id, e.contact_email,
              s.owner_id, s.partner_id
       FROM outreach_enrollments e
       JOIN outreach_sequences s ON s.id = e.sequence_id
       WHERE e.id = $1 FOR UPDATE OF e`,
      [input.enrollmentId],
    );
    const row = rows[0] as
      | {
          id: string;
          status: string;
          version: number;
          sequence_id: string;
          contact_email: string;
          owner_id: string | null;
          partner_id: string | null;
        }
      | undefined;
    if (!row) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "Enrolment is not accessible"),
        correlationId,
      };
    }

    const policy = await authorizeOutreach({
      actor: input.actor,
      operation: "update",
      sequence: { ownerId: row.owner_id, partnerId: row.partner_id },
    });
    if (!policy.allowed) return { ok: false, failure: policy.denial, correlationId };

    if (Number(row.version) !== input.expectedVersion) {
      return {
        ok: false,
        failure: makeConcurrencyError(row.id, input.expectedVersion, Number(row.version)),
        correlationId,
      };
    }

    if (row.status !== "active") {
      return {
        ok: false,
        failure: validationFailure(
          "This contact is no longer running the sequence",
          "enrollmentId",
        ),
        correlationId,
      };
    }

    const nextVersion = Number(row.version) + 1;
    await tx.query(
      `UPDATE outreach_enrollments
       SET status = 'unenrolled', unenroll_reason = $2, unenrolled_at = now(), version = $3
       WHERE id = $1`,
      [row.id, input.reasonKey, nextVersion],
    );
    await tx.query(
      `UPDATE outreach_step_executions
       SET status = 'skipped', detail = $2
       WHERE enrollment_id = $1 AND status = 'pending'`,
      [row.id, `Unenrolled: ${reason.label}`],
    );

    await recordOutreachEvent({
      tx,
      actor: input.actor,
      correlationId,
      eventName: "outreach.enrollment.unenrolled",
      subjectType: "outreach_enrollment",
      subjectId: row.id,
      payload: { sequenceId: row.sequence_id, reason: input.reasonKey },
    });

    return {
      ok: true,
      commandName: "outreach.enrollment.unenroll",
      subjectId: row.id,
      newVersion: nextVersion,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}
