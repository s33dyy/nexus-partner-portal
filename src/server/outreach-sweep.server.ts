import {
  isWithinSendWindow,
  normalizeOutreachEmail,
  outreachUnsubscribeFooter,
  renderOutreachTemplate,
  splitContactName,
  type OutreachStepType,
  type OutreachTokenValues,
} from "@/domain/contracts/outreach";
import { zonedDayRange, zonedHour } from "@/server/app-time.server";
import { isEmailConfigured, sendEmail } from "@/server/email.server";
import type { QueryRunner } from "@/server/command-runtime.server";
import { pool } from "@/server/postgres.server";
import { ensureAutomatedTask } from "@/server/workflow-automation.server";

/**
 * Delivery sweep for outreach sequences.
 *
 * SECURITY NOTE — like reminders.server.ts, this module queries `pool`
 * directly and never goes through table-policy.server.ts. A sweep has no
 * caller and therefore no auth context to scope by. What makes that safe
 * here is that the sweep can only ever act on work a governed command
 * already authorised: every row it processes was materialised by
 * enrollContacts(), which ran authorizeOutreach() first. The sweep decides
 * WHEN, never WHO or WHETHER.
 *
 * Exactly-once delivery comes from the claim, not from this process:
 * `UPDATE ... SET status='sending' WHERE id=$1 AND status='pending'` is
 * atomic, so of two sweeps racing on the same row, precisely one sees
 * rowCount 1 and proceeds to send. Everything after the claim is idempotent
 * or recorded, and a row abandoned in 'sending' by a process that died is
 * reclaimed after STALE_CLAIM_MINUTES.
 */

/** How long a claimed-but-unfinished step waits before another sweep may
 * retry it. Long enough that a slow mail provider is never double-sent to,
 * short enough that a crashed deploy doesn't strand a cadence for a day. */
const STALE_CLAIM_MINUTES = 15;

/** Per-tick ceiling. A sweep that tried to drain an unbounded backlog in one
 * pass would hold the pool open for minutes and hit provider rate limits;
 * what is left simply goes out on the next tick. */
const MAX_STEPS_PER_SWEEP = 200;

export type OutreachSweepSummary = {
  ranAt: string;
  due: number;
  claimed: number;
  emailsSent: number;
  tasksOpened: number;
  skipped: number;
  failed: number;
  autoUnenrolled: number;
  finished: number;
  deferredOutOfWindow: number;
};

/** One step that is owed right now, joined to everything rendering it
 * needs. Exported so the pure composition helpers below can be tested
 * without a database. */
export type DueStep = {
  executionId: string;
  enrollmentId: string;
  stepIndex: number;
  stepType: OutreachStepType;
  scheduledFor: string;
  trackingToken: string | null;
  subject: string;
  body: string;
  taskTitle: string;
  taskPriority: string;
  sequenceId: string;
  sequenceName: string;
  threadAsReply: boolean;
  unenrollOnDealCreated: boolean;
  ownerId: string | null;
  partnerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerMeetingLink: string | null;
  contactName: string;
  contactEmail: string;
  contactEmailNormalized: string;
  personalNote: string;
  customerId: string | null;
  companyName: string | null;
  customerCountry: string | null;
  customerRegion: string | null;
  customerSegment: string | null;
  startDate: string;
  firstEmailSubject: string | null;
};

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
}

export function trackingPixelUrl(token: string): string | null {
  const base = appBaseUrl();
  return base ? `${base}/api/outreach/open/${token}.gif` : null;
}

export function unsubscribeUrl(token: string): string | null {
  const base = appBaseUrl();
  return base ? `${base}/api/outreach/unsubscribe/${token}` : null;
}

async function reclaimStaleClaims(): Promise<void> {
  await pool.query(
    `UPDATE outreach_step_executions
     SET status = 'pending', claimed_at = NULL
     WHERE status = 'sending'
       AND claimed_at IS NOT NULL
       AND claimed_at < now() - ($1 || ' minutes')::interval`,
    [String(STALE_CLAIM_MINUTES)],
  );
}

async function loadDueSteps(now: Date): Promise<DueStep[]> {
  const { rows } = await pool.query(
    `SELECT x.id                AS execution_id,
            x.enrollment_id,
            x.step_index,
            x.step_type,
            x.scheduled_for,
            x.tracking_token,
            st.subject,
            st.body,
            st.task_title,
            st.task_priority,
            s.id                AS sequence_id,
            s.name              AS sequence_name,
            s.thread_as_reply,
            s.unenroll_on_deal_created,
            s.owner_id,
            s.partner_id,
            p.full_name         AS owner_name,
            p.email             AS owner_email,
            p.meeting_link      AS owner_meeting_link,
            e.contact_name,
            e.contact_email,
            e.contact_email_normalized,
            e.personal_note,
            e.customer_id,
            e.start_date,
            c.company_name,
            c.country           AS customer_country,
            c.region            AS customer_region,
            c.segment           AS customer_segment,
            (SELECT st2.subject FROM outreach_sequence_steps st2
              WHERE st2.sequence_id = s.id AND st2.step_type = 'email'
              ORDER BY st2.step_index ASC LIMIT 1) AS first_email_subject
     FROM outreach_step_executions x
     JOIN outreach_enrollments e   ON e.id = x.enrollment_id
     JOIN outreach_sequences s     ON s.id = e.sequence_id
     JOIN outreach_sequence_steps st ON st.id = x.step_id
     LEFT JOIN profiles p          ON p.id = s.owner_id
     LEFT JOIN portal_customers c  ON c.id = e.customer_id
     WHERE x.status = 'pending'
       AND x.scheduled_for <= $1
       AND e.status = 'active'
       AND s.status = 'active'
     ORDER BY x.scheduled_for ASC
     LIMIT ${MAX_STEPS_PER_SWEEP}`,
    [now.toISOString()],
  );

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    executionId: String(row.execution_id),
    enrollmentId: String(row.enrollment_id),
    stepIndex: Number(row.step_index),
    stepType: String(row.step_type) as OutreachStepType,
    scheduledFor: toIsoString(row.scheduled_for),
    trackingToken: row.tracking_token ? String(row.tracking_token) : null,
    subject: String(row.subject ?? ""),
    body: String(row.body ?? ""),
    taskTitle: String(row.task_title ?? ""),
    taskPriority: String(row.task_priority ?? "medium"),
    sequenceId: String(row.sequence_id),
    sequenceName: String(row.sequence_name ?? ""),
    threadAsReply: Boolean(row.thread_as_reply),
    unenrollOnDealCreated: Boolean(row.unenroll_on_deal_created),
    ownerId: row.owner_id ? String(row.owner_id) : null,
    partnerId: row.partner_id ? String(row.partner_id) : null,
    ownerName: row.owner_name ? String(row.owner_name) : null,
    ownerEmail: row.owner_email ? String(row.owner_email) : null,
    ownerMeetingLink: row.owner_meeting_link ? String(row.owner_meeting_link) : null,
    contactName: String(row.contact_name ?? ""),
    contactEmail: String(row.contact_email ?? ""),
    contactEmailNormalized: String(row.contact_email_normalized ?? ""),
    personalNote: String(row.personal_note ?? ""),
    customerId: row.customer_id ? String(row.customer_id) : null,
    companyName: row.company_name ? String(row.company_name) : null,
    customerCountry: row.customer_country ? String(row.customer_country) : null,
    customerRegion: row.customer_region ? String(row.customer_region) : null,
    customerSegment: row.customer_segment ? String(row.customer_segment) : null,
    startDate: toDateOnly(row.start_date),
    firstEmailSubject: row.first_email_subject ? String(row.first_email_subject) : null,
  }));
}

function toIsoString(value: unknown): string {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toDateOnly(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) {
    // A DATE column has no zone; `pg` returns it as local midnight, so read
    // the local components rather than going through toISOString(), which
    // would shift the day backwards east of UTC.
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

export function buildTokenValues(step: DueStep): OutreachTokenValues {
  const { firstName, lastName } = splitContactName(step.contactName);
  return {
    first_name: firstName,
    last_name: lastName,
    full_name: step.contactName,
    email: step.contactEmail,
    company: step.companyName,
    country: step.customerCountry,
    region: step.customerRegion,
    segment: step.customerSegment,
    sender_name: step.ownerName,
    sender_email: step.ownerEmail,
    meeting_link: step.ownerMeetingLink,
  };
}

/** Claims one step for this sweep. True only if THIS call won the row. */
async function claimStep(executionId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE outreach_step_executions
     SET status = 'sending', claimed_at = now()
     WHERE id = $1 AND status = 'pending'`,
    [executionId],
  );
  return (rowCount ?? 0) > 0;
}

async function finishStep(input: {
  executionId: string;
  status: "sent" | "skipped" | "failed";
  detail?: string | null;
  taskId?: string | null;
}): Promise<void> {
  await pool.query(
    `UPDATE outreach_step_executions
     SET status = $2,
         detail = $3,
         task_id = COALESCE($4, task_id),
         sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
         claimed_at = NULL
     WHERE id = $1`,
    [input.executionId, input.status, input.detail?.slice(0, 500) ?? null, input.taskId ?? null],
  );
}

/** Returns the step to 'pending' without consuming it — used when a claimed
 * step turns out not to be sendable yet (outside the send window). */
async function releaseStep(executionId: string): Promise<void> {
  await pool.query(
    `UPDATE outreach_step_executions
     SET status = 'pending', claimed_at = NULL
     WHERE id = $1 AND status = 'sending'`,
    [executionId],
  );
}

export type AutoUnenrollCheck = { reasonKey: string; detail: string } | null;

/**
 * The two unenrolment criteria the system can decide by itself.
 *
 * Both are checked immediately before each send rather than on a schedule of
 * their own, because the only moment they matter is the moment we are about
 * to mail somebody: an opt-out recorded a minute ago must stop the very next
 * message, and a sweep that read a stale answer would send it anyway.
 */
export async function evaluateAutoUnenroll(step: DueStep): Promise<AutoUnenrollCheck> {
  const { rows: suppressed } = await pool.query(
    `SELECT reason FROM outreach_suppressions WHERE email_normalized = $1`,
    [step.contactEmailNormalized],
  );
  if (suppressed.length > 0) {
    return { reasonKey: "opted_out", detail: "Recipient unsubscribed" };
  }

  if (step.unenrollOnDealCreated && step.customerId) {
    const { rows: deals } = await pool.query(
      // `$2::date` compared against a TIMESTAMPTZ promotes the date to
      // midnight in the SERVER's zone, not the business's. On a UTC container
      // serving an IST team that boundary sits at 05:30 local, so a deal
      // opened at 09:00 on the enrolment's own start date read as "before
      // enrolment" and never stopped the cadence. zonedDayRange gives the
      // real instant the business day began — the same helper the reminder
      // sweep and the daily digest already share their day boundary with.
      `SELECT id FROM portal_deals
       WHERE customer_id = $1
         AND created_at >= $2
       LIMIT 1`,
      [step.customerId, startOfBusinessDay(step.startDate)],
    );
    if (deals.length > 0) {
      return { reasonKey: "deal_created", detail: "A deal was opened for this customer" };
    }
  }

  return null;
}

async function applyAutoUnenroll(step: DueStep, check: NonNullable<AutoUnenrollCheck>) {
  await pool.query(
    `UPDATE outreach_enrollments
     SET status = 'unenrolled', unenroll_reason = $2, unenrolled_at = now(), version = version + 1
     WHERE id = $1 AND status = 'active'`,
    [step.enrollmentId, check.reasonKey],
  );
  await pool.query(
    `UPDATE outreach_step_executions
     SET status = 'skipped', detail = $2, claimed_at = NULL
     WHERE enrollment_id = $1 AND status IN ('pending', 'sending')`,
    [step.enrollmentId, check.detail],
  );
}

/** Marks an enrolment finished once nothing is left to do for it. */
async function finishEnrollmentIfComplete(enrollmentId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE outreach_enrollments
     SET status = 'finished', finished_at = now(), version = version + 1
     WHERE id = $1
       AND status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM outreach_step_executions
         WHERE enrollment_id = $1 AND status IN ('pending', 'sending')
       )`,
    [enrollmentId],
  );
  return (rowCount ?? 0) > 0;
}

export function composeEmail(step: DueStep): {
  ok: boolean;
  subject: string;
  text: string;
  html: string;
  missing: string[];
} {
  const values = buildTokenValues(step);

  // Which subject actually goes out is decided BEFORE the missing-token
  // check, because a threaded follow-up sends the FIRST step's subject, not
  // its own. Checking this step's subject and then mailing a different one
  // would let an unresolved token in step 1's subject reach a recipient as
  // "Re: Welcome to the  report" — the exact failure the check exists to
  // prevent.
  const threaded = Boolean(
    step.threadAsReply && step.firstEmailSubject && step.subject.trim() !== step.firstEmailSubject,
  );
  const renderedSubject = renderOutreachTemplate(
    threaded ? step.firstEmailSubject! : step.subject,
    values,
  );
  const renderedBody = renderOutreachTemplate(step.body, values);
  const missing = [...new Set([...renderedSubject.missing, ...renderedBody.missing])];

  // A message with an unresolved token is not sent at all. "Hi ," reaching a
  // prospect costs more than a step that quietly waits for the rep to fill in
  // a first name — and the skip reason tells them exactly which field.
  if (missing.length > 0) {
    return { ok: false, subject: "", text: "", html: "", missing };
  }

  const subjectPrefix = threaded ? "Re: " : "";
  const baseSubject = renderedSubject.text;

  // The rep's one-off line rides above the template on the first email only —
  // it is a greeting for this person, not a paragraph to repeat five times.
  const note =
    step.stepIndex === 0 && step.personalNote.trim() ? `${step.personalNote.trim()}\n\n` : "";
  const unsubscribe = step.trackingToken ? unsubscribeUrl(step.trackingToken) : null;
  const text = `${note}${renderedBody.text}${outreachUnsubscribeFooter(unsubscribe)}`;

  return {
    ok: true,
    subject: `${subjectPrefix}${baseSubject}`,
    text,
    html: renderOutreachEmailHtml({
      body: `${note}${renderedBody.text}`,
      unsubscribeUrl: unsubscribe,
      pixelUrl: step.trackingToken ? trackingPixelUrl(step.trackingToken) : null,
    }),
    missing: [],
  };
}

/**
 * Deliberately plain HTML: a prospecting email that looks like a newsletter
 * gets filed like a newsletter. No tables, no images beyond the 1x1 open
 * pixel, inline styles only, and the recipient's own line breaks preserved.
 */
export function renderOutreachEmailHtml(input: {
  body: string;
  unsubscribeUrl: string | null;
  pixelUrl: string | null;
}): string {
  const paragraphs = input.body
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px">${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("");
  const unsubscribe = input.unsubscribeUrl
    ? `<p style="margin:24px 0 0;color:#6b7280;font-size:12px">If you'd rather not hear from us, <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#6b7280">unsubscribe</a>.</p>`
    : "";
  const pixel = input.pixelUrl
    ? `<img src="${escapeHtml(input.pixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />`
    : "";

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.55;color:#111827;max-width:560px;margin:0 auto;padding:24px;font-size:14px">
  ${paragraphs}
  ${unsubscribe}
  ${pixel}
</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function executeEmailStep(
  step: DueStep,
  summary: OutreachSweepSummary,
  now: Date,
): Promise<void> {
  if (!isWithinSendWindow(zonedHour(now))) {
    // Quiet hours (product.md §19.6). Released rather than skipped: the step
    // is still owed, just not right now.
    await releaseStep(step.executionId);
    summary.deferredOutOfWindow += 1;
    return;
  }

  if (!(await isEmailConfigured())) {
    await finishStep({
      executionId: step.executionId,
      status: "skipped",
      detail: "Email provider is not configured",
    });
    summary.skipped += 1;
    return;
  }

  const composed = composeEmail(step);
  if (!composed.ok) {
    await finishStep({
      executionId: step.executionId,
      status: "skipped",
      detail: `Missing personalisation: ${composed.missing.join(", ")}`,
    });
    summary.skipped += 1;
    return;
  }

  const result = await sendEmail({
    to: step.contactEmail,
    subject: composed.subject,
    text: composed.text,
    html: composed.html,
  });

  if (result.ok) {
    await finishStep({ executionId: step.executionId, status: "sent" });
    summary.emailsSent += 1;
    return;
  }

  await finishStep({
    executionId: step.executionId,
    status: result.skipped ? "skipped" : "failed",
    detail: result.reason,
  });
  if (result.skipped) summary.skipped += 1;
  else summary.failed += 1;
}

async function executeTaskStep(step: DueStep, summary: OutreachSweepSummary): Promise<void> {
  if (!step.ownerId) {
    await finishStep({
      executionId: step.executionId,
      status: "skipped",
      detail: "The sequence has no owner to assign this task to",
    });
    summary.skipped += 1;
    return;
  }

  const values = buildTokenValues(step);
  const title = renderOutreachTemplate(step.taskTitle, values).text;
  const contactLabel = step.contactName.trim() || step.contactEmail;
  const company = step.companyName ? ` (${step.companyName})` : "";

  try {
    // Keyed on the execution, so a replay of this exact step reuses the Task
    // rather than opening a second one. Routed through the shared automation
    // helper for the same reason every other workflow is: a generated task
    // belongs in /tasks with the rest of the owner's work.
    const { taskId } = await ensureAutomatedTask(pool, {
      automationKey: `outreach:${step.executionId}`,
      automationSource: "outreach_sequence",
      templateVersion: 1,
      assigneeId: step.ownerId,
      creatorId: step.ownerId,
      relatedType: "outreach_enrollment",
      relatedId: step.enrollmentId,
      title,
      description: `${step.sequenceName} — step ${step.stepIndex + 1} for ${contactLabel}${company}.`,
      priority: step.taskPriority || "medium",
      // The day the cadence asked for this to happen. A generated task with
      // no due date sorts to the bottom of /tasks and never reaches the
      // reminder sweep, which turns "remind me to call them on day 4" into
      // "here is a task, some time, whenever".
      dueAt: step.scheduledFor,
      partnerId: step.partnerId,
    });
    await finishStep({ executionId: step.executionId, status: "sent", taskId });
    summary.tasksOpened += 1;
  } catch (error) {
    await finishStep({
      executionId: step.executionId,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    });
    summary.failed += 1;
  }
}

/**
 * Runs one full pass. Safe to call concurrently with itself and with any
 * other replica — see the claim note at the top of the module.
 */
export async function runOutreachSweep(options?: { now?: Date }): Promise<OutreachSweepSummary> {
  const now = options?.now ?? new Date();
  const summary: OutreachSweepSummary = {
    ranAt: now.toISOString(),
    due: 0,
    claimed: 0,
    emailsSent: 0,
    tasksOpened: 0,
    skipped: 0,
    failed: 0,
    autoUnenrolled: 0,
    finished: 0,
    deferredOutOfWindow: 0,
  };

  await reclaimStaleClaims();

  const due = await loadDueSteps(now);
  summary.due = due.length;
  if (due.length === 0) return summary;

  // Enrolments already stopped earlier in THIS pass. Without it, a cadence
  // with two steps due at once would re-check (and re-log) the same opt-out
  // for the second step after the first had already stopped the enrolment.
  const stopped = new Set<string>();

  for (const step of due) {
    if (stopped.has(step.enrollmentId)) continue;

    if (!(await claimStep(step.executionId))) continue;
    summary.claimed += 1;

    const autoUnenroll = await evaluateAutoUnenroll(step);
    if (autoUnenroll) {
      await applyAutoUnenroll(step, autoUnenroll);
      stopped.add(step.enrollmentId);
      summary.autoUnenrolled += 1;
      continue;
    }

    try {
      if (step.stepType === "email") {
        await executeEmailStep(step, summary, now);
      } else {
        await executeTaskStep(step, summary);
      }
    } catch (error) {
      // A throw here would abandon the row in 'sending' until the stale
      // reclaim picked it up 15 minutes later. Recording the failure keeps
      // the reason visible on the enrolment timeline instead.
      await finishStep({
        executionId: step.executionId,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
      summary.failed += 1;
    }

    if (await finishEnrollmentIfComplete(step.enrollmentId)) {
      summary.finished += 1;
    }
  }

  return summary;
}

export function describeOutreachSweep(summary: OutreachSweepSummary): string {
  return `[outreach] ${summary.due} due, ${summary.emailsSent} emailed, ${summary.tasksOpened} tasks, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.autoUnenrolled} auto-unenrolled, ${summary.finished} finished, ${summary.deferredOutOfWindow} deferred`;
}

// ---------------------------------------------------------------------------
// Recipient-facing endpoints
// ---------------------------------------------------------------------------

/**
 * 1x1 open pixel. Always returns the GIF, whatever the token — a 404 for an
 * unknown token would turn this endpoint into an oracle for guessing valid
 * ones, and the image has to render either way.
 */
/** The instant the given business-timezone calendar day began, as a real
 * TIMESTAMPTZ-comparable Date. Falls back to UTC midnight only if the zone
 * cannot be resolved at all. */
function startOfBusinessDay(date: string): Date {
  const range = zonedDayRange(date);
  if (range) return range.startUtc;
  const utcMidnight = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isNaN(utcMidnight) ? new Date(0) : new Date(utcMidnight);
}

export async function handleOutreachOpenPixel(token: string): Promise<Response> {
  const clean = token.replace(/\.gif$/i, "");
  if (clean) {
    try {
      await pool.query(
        `UPDATE outreach_step_executions
         SET open_count = open_count + 1,
             first_opened_at = COALESCE(first_opened_at, now())
         WHERE tracking_token = $1 AND status = 'sent'`,
        [clean],
      );
    } catch (error) {
      console.error("[outreach] failed to record open", error);
    }
  }

  // Transparent 1x1 GIF.
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  return new Response(new Uint8Array(gif), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Content-Length": String(gif.length),
    },
  });
}

/**
 * Unsubscribe. Only POST performs it; everything else renders a confirmation
 * page.
 *
 * The split is not ceremony: mail clients and security scanners prefetch
 * every link in a message, so a GET that suppressed the address would
 * unsubscribe people who never clicked anything.
 *
 * The guard is written as "not POST" rather than "is GET" deliberately. The
 * is-GET form is fail-OPEN — a HEAD from `curl -I`, an OPTIONS preflight, or
 * any unrecognised verb skips the confirmation page and lands straight on the
 * suppression, which is precisely the prefetch scenario this split exists to
 * prevent. Suppression has no undo in any product surface, so the safe
 * default has to be the read-only branch.
 */
export async function handleOutreachUnsubscribe(
  request: Request,
  token: string,
  // Injected so the verb handling can be tested without a database. Module
  // mocking is not an option here: bun's mock.module is process-wide, so
  // replacing the pool for this file replaces it for every other suite in
  // the run.
  deps: { query: QueryRunner["query"] } = pool,
): Promise<Response> {
  const { rows } = await deps.query(
    `SELECT x.enrollment_id, e.contact_email, e.contact_email_normalized
     FROM outreach_step_executions x
     JOIN outreach_enrollments e ON e.id = x.enrollment_id
     WHERE x.tracking_token = $1`,
    [token],
  );
  const row = rows[0] as
    | { enrollment_id: string; contact_email: string; contact_email_normalized: string }
    | undefined;

  if (!row) {
    return htmlResponse(
      unsubscribePage({
        heading: "Link not recognised",
        body: "This unsubscribe link is no longer valid. If you keep hearing from us, reply to the message and we'll remove you.",
        action: null,
      }),
      404,
    );
  }

  if (request.method !== "POST") {
    return htmlResponse(
      unsubscribePage({
        heading: "Unsubscribe",
        body: `Stop sending outreach emails to ${row.contact_email}?`,
        action: { label: "Yes, unsubscribe me", token },
      }),
      200,
    );
  }

  const normalized = normalizeOutreachEmail(row.contact_email);
  await deps.query(
    `INSERT INTO outreach_suppressions (email_normalized, reason, source, enrollment_id)
     VALUES ($1, 'unsubscribed', 'recipient', $2)
     ON CONFLICT (email_normalized) DO NOTHING`,
    [normalized, row.enrollment_id],
  );

  // Suppression alone would only stop future sends once the sweep next
  // checked. Stopping every live enrolment for this address now means the
  // recipient's click takes effect across every sequence they are on, which
  // is what "unsubscribe" means to the person clicking it.
  const { rows: stoppedRows } = await deps.query(
    `UPDATE outreach_enrollments
     SET status = 'unenrolled', unenroll_reason = 'opted_out', unenrolled_at = now(),
         version = version + 1
     WHERE contact_email_normalized = $1 AND status = 'active'
     RETURNING id`,
    [normalized],
  );
  const stoppedIds = (stoppedRows as Array<{ id: string }>).map((entry) => entry.id);
  if (stoppedIds.length > 0) {
    await deps.query(
      `UPDATE outreach_step_executions
       SET status = 'skipped', detail = 'Recipient unsubscribed', claimed_at = NULL
       WHERE enrollment_id = ANY($1::uuid[]) AND status IN ('pending', 'sending')`,
      [stoppedIds],
    );
  }

  return htmlResponse(
    unsubscribePage({
      heading: "You're unsubscribed",
      body: `${row.contact_email} won't receive any more outreach emails from us.`,
      action: null,
    }),
    200,
  );
}

function unsubscribePage(input: {
  heading: string;
  body: string;
  action: { label: string; token: string } | null;
}): string {
  const form = input.action
    ? `<form method="post" action="/api/outreach/unsubscribe/${escapeHtml(input.action.token)}">
         <button type="submit" style="margin-top:20px;background:#3730a3;color:#fff;border:0;border-radius:8px;padding:11px 20px;font-size:14px;font-weight:600;cursor:pointer">${escapeHtml(input.action.label)}</button>
       </form>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(input.heading)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;margin:0;padding:48px 20px;color:#111827">
  <div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
    <h1 style="margin:0 0 10px;font-size:18px">${escapeHtml(input.heading)}</h1>
    <p style="margin:0;color:#4b5563;font-size:14px;line-height:1.55">${escapeHtml(input.body)}</p>
    ${form}
  </div>
</body></html>`;
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
