import type { PolicyDenialErrorContract } from "@/domain/contracts/commands";
import {
  sequenceAutomationPercent,
  sequenceDurationDays,
  summarizeSequenceAnalytics,
  type OutreachEnrollmentStatus,
  type OutreachExecutionStatus,
  type OutreachSequenceStatus,
  type OutreachStepType,
  type SequenceAnalytics,
} from "@/domain/contracts/outreach";
import {
  authorizeOutreach,
  bindPredicate,
  sequenceScopePredicate,
  type OutreachActor,
} from "@/server/outreach-policy.server";
import { pool } from "@/server/postgres.server";

/**
 * Scoped read models for the outreach workspace.
 *
 * The outreach tables are deliberately absent from TABLE_COLUMNS and so are
 * unreachable through the generic queryTable()/supabase.from() path — the
 * same choice the Distribution module made, and for the same reason: an
 * enrolment row carries an external person's name and email address, and
 * "who may read this" is a question about the sequence's owner and tenant
 * that a client-supplied filter must never get to answer for itself.
 *
 * Every function here authorises first and queries second, and every query
 * carries a server-computed scope predicate built from the caller's governed
 * Assignment.
 */

export type OutreachReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: PolicyDenialErrorContract };

export type SequenceStepView = {
  id: string;
  stepIndex: number;
  stepType: OutreachStepType;
  dayOffset: number;
  subject: string;
  body: string;
  taskTitle: string;
  taskPriority: string;
};

export type SequenceListItem = {
  id: string;
  name: string;
  description: string;
  status: OutreachSequenceStatus;
  ownerId: string | null;
  ownerName: string | null;
  businessDaysOnly: boolean;
  threadAsReply: boolean;
  unenrollOnDealCreated: boolean;
  version: number;
  createdAt: string;
  stepCount: number;
  durationDays: number;
  automationPercent: number;
  analytics: SequenceAnalytics;
};

export type EnrollmentView = {
  id: string;
  sequenceId: string;
  sequenceName: string;
  contactName: string;
  contactEmail: string;
  customerId: string | null;
  companyName: string | null;
  status: OutreachEnrollmentStatus;
  unenrollReason: string | null;
  startDate: string;
  version: number;
  stepsTotal: number;
  stepsDone: number;
  nextStepAt: string | null;
  lastActivityAt: string | null;
};

export type ExecutionView = {
  id: string;
  stepIndex: number;
  stepType: OutreachStepType;
  status: OutreachExecutionStatus;
  scheduledFor: string;
  sentAt: string | null;
  detail: string | null;
  taskId: string | null;
  openCount: number;
  firstOpenedAt: string | null;
  subject: string;
  taskTitle: string;
};

export type SequenceDetail = {
  sequence: SequenceListItem;
  steps: SequenceStepView[];
  enrollments: EnrollmentView[];
};

export type OutreachCustomerOption = {
  id: string;
  companyName: string;
  country: string | null;
  region: string | null;
  segment: string | null;
  domain: string | null;
};

function denied(reason: string): { ok: false; failure: PolicyDenialErrorContract } {
  return {
    ok: false,
    failure: {
      code: "POLICY_DENIED",
      message: "Access denied",
      subjectId: null,
      reason,
      retryable: false,
      mayRevealRecordExistence: false,
    },
  };
}

function toIso(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (!value) return null;
  const iso = toIso(value);
  return iso || null;
}

function toDateOnly(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    if (match) return match[1]!;
  }
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

type SequenceAggregateRow = {
  id: string;
  name: string;
  description: string;
  status: string;
  owner_id: string | null;
  owner_name: string | null;
  business_days_only: boolean;
  thread_as_reply: boolean;
  unenroll_on_deal_created: boolean;
  version: number;
  created_at: unknown;
  step_count: number;
  duration_days: number;
  email_step_count: number;
  enrolled: number;
  active: number;
  finished: number;
  unenrolled: number;
  emails_sent: number;
  emails_opened: number;
  emails_failed: number;
  unenroll_reasons: string[] | null;
};

/**
 * One statement, not N+1: the per-sequence counters come from correlated
 * aggregate subqueries rather than a second round-trip per row, so the list
 * costs the same whether the workspace holds three sequences or three
 * hundred.
 */
const SEQUENCE_SELECT = `
  SELECT s.id,
         s.name,
         s.description,
         s.status,
         s.owner_id,
         p.full_name AS owner_name,
         s.business_days_only,
         s.thread_as_reply,
         s.unenroll_on_deal_created,
         s.version,
         s.created_at,
         (SELECT count(*)::int FROM outreach_sequence_steps st WHERE st.sequence_id = s.id) AS step_count,
         (SELECT COALESCE(max(st.day_offset), 0)::int FROM outreach_sequence_steps st WHERE st.sequence_id = s.id) AS duration_days,
         (SELECT count(*)::int FROM outreach_sequence_steps st WHERE st.sequence_id = s.id AND st.step_type = 'email') AS email_step_count,
         (SELECT count(*)::int FROM outreach_enrollments e WHERE e.sequence_id = s.id) AS enrolled,
         (SELECT count(*)::int FROM outreach_enrollments e WHERE e.sequence_id = s.id AND e.status = 'active') AS active,
         (SELECT count(*)::int FROM outreach_enrollments e WHERE e.sequence_id = s.id AND e.status = 'finished') AS finished,
         (SELECT count(*)::int FROM outreach_enrollments e WHERE e.sequence_id = s.id AND e.status = 'unenrolled') AS unenrolled,
         (SELECT count(*)::int FROM outreach_step_executions x
            JOIN outreach_enrollments e ON e.id = x.enrollment_id
           WHERE e.sequence_id = s.id AND x.step_type = 'email' AND x.status = 'sent') AS emails_sent,
         (SELECT count(*)::int FROM outreach_step_executions x
            JOIN outreach_enrollments e ON e.id = x.enrollment_id
           WHERE e.sequence_id = s.id AND x.step_type = 'email' AND x.first_opened_at IS NOT NULL) AS emails_opened,
         (SELECT count(*)::int FROM outreach_step_executions x
            JOIN outreach_enrollments e ON e.id = x.enrollment_id
           WHERE e.sequence_id = s.id AND x.step_type = 'email' AND x.status = 'failed') AS emails_failed,
         (SELECT array_agg(e.unenroll_reason) FROM outreach_enrollments e
           WHERE e.sequence_id = s.id AND e.unenroll_reason IS NOT NULL) AS unenroll_reasons
  FROM outreach_sequences s
  LEFT JOIN profiles p ON p.id = s.owner_id
`;

function mapSequenceRow(row: SequenceAggregateRow): SequenceListItem {
  const stepCount = Number(row.step_count);
  const emailSteps = Number(row.email_step_count);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    status: row.status as OutreachSequenceStatus,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    businessDaysOnly: Boolean(row.business_days_only),
    threadAsReply: Boolean(row.thread_as_reply),
    unenrollOnDealCreated: Boolean(row.unenroll_on_deal_created),
    version: Number(row.version),
    createdAt: toIso(row.created_at),
    stepCount,
    durationDays: sequenceDurationDays(
      // The aggregate already reduced the offsets to their max; wrapping it
      // back into the contract helper keeps "duration" defined in exactly
      // one place rather than half in SQL and half in TypeScript.
      stepCount > 0 ? [{ dayOffset: Number(row.duration_days) }] : [],
    ),
    automationPercent: sequenceAutomationPercent(
      Array.from({ length: stepCount }, (_, index) => ({
        stepType: (index < emailSteps ? "email" : "task") as OutreachStepType,
      })),
    ),
    analytics: summarizeSequenceAnalytics({
      enrolled: Number(row.enrolled),
      active: Number(row.active),
      finished: Number(row.finished),
      unenrolled: Number(row.unenrolled),
      emailsSent: Number(row.emails_sent),
      emailsOpened: Number(row.emails_opened),
      emailsFailed: Number(row.emails_failed),
      unenrollReasonKeys: row.unenroll_reasons ?? [],
    }),
  };
}

export async function listSequences(
  actor: OutreachActor,
): Promise<OutreachReadResult<SequenceListItem[]>> {
  const policy = await authorizeOutreach({ actor, operation: "read" });
  if (!policy.allowed) return denied(policy.reason ?? "Access denied");

  const scope = sequenceScopePredicate(actor, {
    ownerColumn: "s.owner_id",
    partnerColumn: "s.partner_id",
  });
  const { rows } = await pool.query(
    `${SEQUENCE_SELECT} WHERE ${bindPredicate(scope.clause, 1)} ORDER BY s.created_at DESC LIMIT 200`,
    scope.params,
  );

  return { ok: true, data: (rows as SequenceAggregateRow[]).map(mapSequenceRow) };
}

export async function getSequenceDetail(
  actor: OutreachActor,
  sequenceId: string,
): Promise<OutreachReadResult<SequenceDetail>> {
  const policy = await authorizeOutreach({ actor, operation: "read" });
  if (!policy.allowed) return denied(policy.reason ?? "Access denied");

  const scope = sequenceScopePredicate(actor, {
    ownerColumn: "s.owner_id",
    partnerColumn: "s.partner_id",
  });
  const { rows } = await pool.query(
    `${SEQUENCE_SELECT} WHERE s.id = $1 AND ${bindPredicate(scope.clause, 2)}`,
    [sequenceId, ...scope.params],
  );
  const row = rows[0] as SequenceAggregateRow | undefined;
  // Out of scope and non-existent answer identically — a "no such sequence"
  // that differs from "not yours" tells a prober which ids are real.
  if (!row) return denied("Sequence is not accessible");

  const [stepRows, enrollmentRows] = await Promise.all([
    pool.query(
      `SELECT id, step_index, step_type, day_offset, subject, body, task_title, task_priority
       FROM outreach_sequence_steps WHERE sequence_id = $1 ORDER BY step_index ASC`,
      [sequenceId],
    ),
    pool.query(
      `SELECT e.id, e.sequence_id, e.contact_name, e.contact_email, e.customer_id, e.status,
              e.unenroll_reason, e.start_date, e.version,
              c.company_name,
              (SELECT count(*)::int FROM outreach_step_executions x WHERE x.enrollment_id = e.id) AS steps_total,
              (SELECT count(*)::int FROM outreach_step_executions x
                WHERE x.enrollment_id = e.id AND x.status NOT IN ('pending', 'sending')) AS steps_done,
              (SELECT min(x.scheduled_for) FROM outreach_step_executions x
                WHERE x.enrollment_id = e.id AND x.status = 'pending') AS next_step_at,
              (SELECT max(x.sent_at) FROM outreach_step_executions x
                WHERE x.enrollment_id = e.id) AS last_activity_at
       FROM outreach_enrollments e
       LEFT JOIN portal_customers c ON c.id = e.customer_id
       WHERE e.sequence_id = $1
       ORDER BY e.created_at DESC
       LIMIT 500`,
      [sequenceId],
    ),
  ]);

  const steps = (
    stepRows.rows as Array<{
      id: string;
      step_index: number;
      step_type: string;
      day_offset: number;
      subject: string;
      body: string;
      task_title: string;
      task_priority: string;
    }>
  ).map((step) => ({
    id: step.id,
    stepIndex: Number(step.step_index),
    stepType: step.step_type as OutreachStepType,
    dayOffset: Number(step.day_offset),
    subject: step.subject ?? "",
    body: step.body ?? "",
    taskTitle: step.task_title ?? "",
    taskPriority: step.task_priority ?? "medium",
  }));

  const sequence = mapSequenceRow(row);
  // The list query has to infer the email/task split from two counts; here
  // the real steps are in hand, so the headline figure is exact.
  sequence.automationPercent = sequenceAutomationPercent(steps);
  sequence.durationDays = sequenceDurationDays(steps);

  return {
    ok: true,
    data: {
      sequence,
      steps,
      enrollments: (enrollmentRows.rows as Array<Record<string, unknown>>).map((enrollment) => ({
        id: String(enrollment.id),
        sequenceId: String(enrollment.sequence_id),
        sequenceName: sequence.name,
        contactName: String(enrollment.contact_name ?? ""),
        contactEmail: String(enrollment.contact_email ?? ""),
        customerId: enrollment.customer_id ? String(enrollment.customer_id) : null,
        companyName: enrollment.company_name ? String(enrollment.company_name) : null,
        status: String(enrollment.status) as OutreachEnrollmentStatus,
        unenrollReason: enrollment.unenroll_reason ? String(enrollment.unenroll_reason) : null,
        startDate: toDateOnly(enrollment.start_date),
        version: Number(enrollment.version),
        stepsTotal: Number(enrollment.steps_total ?? 0),
        stepsDone: Number(enrollment.steps_done ?? 0),
        nextStepAt: toIsoOrNull(enrollment.next_step_at),
        lastActivityAt: toIsoOrNull(enrollment.last_activity_at),
      })),
    },
  };
}

/**
 * One enrolment's whole timeline.
 *
 * Reads the step's copy from the EXECUTION's own snapshot rather than joining
 * outreach_sequence_steps. The join used to be an inner one, so re-cutting a
 * sequence's steps — which sets step_id to NULL on historical rows — would
 * have made every past contact's timeline render empty.
 */
export async function getEnrollmentTimeline(
  actor: OutreachActor,
  enrollmentId: string,
): Promise<OutreachReadResult<ExecutionView[]>> {
  const policy = await authorizeOutreach({ actor, operation: "read" });
  if (!policy.allowed) return denied(policy.reason ?? "Access denied");

  const scope = sequenceScopePredicate(actor, {
    ownerColumn: "s.owner_id",
    partnerColumn: "s.partner_id",
  });
  const { rows } = await pool.query(
    `SELECT x.id, x.step_index, x.step_type, x.status, x.scheduled_for, x.sent_at, x.detail,
            x.task_id, x.open_count, x.first_opened_at,
            x.step_subject, x.step_task_title
     FROM outreach_step_executions x
     JOIN outreach_enrollments e ON e.id = x.enrollment_id
     JOIN outreach_sequences s   ON s.id = e.sequence_id
     WHERE x.enrollment_id = $1 AND ${bindPredicate(scope.clause, 2)}
     ORDER BY x.step_index ASC`,
    [enrollmentId, ...scope.params],
  );

  return {
    ok: true,
    data: (rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      stepIndex: Number(row.step_index),
      stepType: String(row.step_type) as OutreachStepType,
      status: String(row.status) as OutreachExecutionStatus,
      scheduledFor: toIso(row.scheduled_for),
      sentAt: toIsoOrNull(row.sent_at),
      detail: row.detail ? String(row.detail) : null,
      taskId: row.task_id ? String(row.task_id) : null,
      openCount: Number(row.open_count ?? 0),
      firstOpenedAt: toIsoOrNull(row.first_opened_at),
      subject: String(row.step_subject ?? ""),
      taskTitle: String(row.step_task_title ?? ""),
    })),
  };
}

/**
 * Customers the caller may enrol against, for the enrolment dialog's picker.
 *
 * Scoped by the caller's own partner tenant rather than by the sequence:
 * picking a Customer only supplies personalisation context and the
 * "a deal opened" unenrolment trigger, so the question is "which customers
 * may this person see", which is the tenant's answer, not the sequence's.
 */
export async function listOutreachCustomers(
  actor: OutreachActor,
  search: string,
): Promise<OutreachReadResult<OutreachCustomerOption[]>> {
  const policy = await authorizeOutreach({ actor, operation: "read" });
  if (!policy.allowed) return denied(policy.reason ?? "Access denied");

  const params: unknown[] = [];
  const clauses: string[] = ["merged_into_customer_id IS NULL"];

  const partnerId = actor.assignment.partnerId ?? null;
  if (partnerId) {
    params.push(partnerId);
    clauses.push(`partner_id = $${params.length}`);
  }

  const term = search.trim();
  if (term) {
    params.push(`%${term}%`);
    clauses.push(`company_name ILIKE $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT id, company_name, country, region, segment, domain
     FROM portal_customers
     WHERE ${clauses.join(" AND ")}
     ORDER BY company_name ASC
     LIMIT 50`,
    params,
  );

  return {
    ok: true,
    data: (rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      companyName: String(row.company_name ?? ""),
      country: row.country ? String(row.country) : null,
      region: row.region ? String(row.region) : null,
      segment: row.segment ? String(row.segment) : null,
      domain: row.domain ? String(row.domain) : null,
    })),
  };
}
