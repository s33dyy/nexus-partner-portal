import {
  buildReminderCopy,
  formatReminderDate,
  getReminderOffset,
  REMINDER_CHANNELS,
  REMINDER_NOTIFICATION_TYPE,
  REMINDER_OFFSETS,
  resolveDueReminder,
  toCalendarDate,
  type ReminderChannel,
  type ReminderOffset,
  type ReminderSubjectType,
} from "@/domain/contracts/reminders";
import { shiftCalendarDate, zonedCalendarDate } from "@/server/app-time.server";
import { isEmailConfigured, renderSimpleEmailHtml, sendEmail } from "@/server/email.server";
import { pool } from "@/server/postgres.server";

// Proposed-completion-date reminder sweep.
//
// SECURITY NOTE — this module queries `pool` directly and never goes through
// table-policy.server.ts. That is deliberate and safe here for one specific
// reason: a sweep has no caller and therefore no auth context to scope by,
// and every message it sends goes to the record's OWN assignee/creator/owner,
// resolved from the record row itself. It never widens anybody's visibility:
// the only thing a recipient learns is the title of a record they already own.
// Any future change that makes this module message somebody OTHER than the
// record's own owner must add a real policy check first.
//
// The sweep is idempotent and safe to run as often as you like: each intended
// delivery is claimed by an INSERT into reminder_dispatches whose unique index
// is (subject, recipient, offset, channel, target_date), and only a claim that
// actually inserted a row proceeds to send.

const REMINDER_WINDOW_BEFORE_DAYS = Math.max(...REMINDER_OFFSETS.map((o) => o.daysBefore));
const REMINDER_WINDOW_AFTER_DAYS = Math.abs(Math.min(...REMINDER_OFFSETS.map((o) => o.daysBefore)));

export type ReminderSweepSummary = {
  ranAt: string;
  today: string;
  candidates: number;
  due: number;
  claimed: number;
  delivered: Record<ReminderChannel, number>;
  skipped: number;
  failed: number;
};

type ReminderCandidate = {
  subjectType: ReminderSubjectType;
  subjectId: string;
  subjectLabel: string;
  targetDate: string;
  recipientUserId: string;
};

type Recipient = {
  userId: string;
  fullName: string | null;
  email: string | null;
  whatsappPhone: string | null;
  whatsappVerified: boolean;
  optOut: boolean;
};

/**
 * "Today" as a calendar date in the business's own timezone (APP_TIMEZONE).
 *
 * A container running in UTC would otherwise flip the reminder day at
 * whatever local hour UTC midnight lands on — for an India-based team that
 * means a "due today" reminder arriving at 5:30am for a day that started six
 * hours earlier. Shares its day boundary with the daily digest, so the two
 * can never disagree about which day it is.
 */
export function businessToday(now: Date = new Date(), timeZone?: string): string {
  return zonedCalendarDate(now, timeZone);
}

// The SQL window is widened by a day on each side of the ladder's true span.
//
// Postgres compares a TIMESTAMPTZ against a `::date` by casting the date to
// midnight in the SERVER's timezone, while resolveDueReminder() below decides
// the exact rung from a UTC calendar date. Those two can disagree by a day at
// the boundary, which would silently drop a row from the sweep on precisely
// the day its reminder was owed. Rather than try to make the SQL agree, the
// window is deliberately loose and the JS stays authoritative: over-fetching
// two days of rows costs nothing (they simply resolve to no rung), whereas
// under-fetching loses a reminder outright.
const WINDOW_SLACK_DAYS = 1;

async function loadCandidates(today: string): Promise<ReminderCandidate[]> {
  // Only rows whose proposed date can possibly land on a rung of the ladder.
  // Without this window the sweep would scan every open task and deal in the
  // system every time it runs, forever.
  const windowStart = shiftCalendarDate(today, -REMINDER_WINDOW_AFTER_DAYS - WINDOW_SLACK_DAYS);
  const windowEnd = shiftCalendarDate(today, REMINDER_WINDOW_BEFORE_DAYS + WINDOW_SLACK_DAYS);

  const [taskRows, dealRows] = await Promise.all([
    pool.query(
      `SELECT id, title, proposed_completion_at AS target,
              COALESCE(assignee_id, creator_id) AS recipient_user_id
       FROM tasks
       WHERE proposed_completion_at IS NOT NULL
         AND status NOT IN ('completed', 'cancelled')
         AND COALESCE(assignee_id, creator_id) IS NOT NULL
         AND proposed_completion_at >= $1::date
         AND proposed_completion_at < ($2::date + INTERVAL '1 day')`,
      [windowStart, windowEnd],
    ),
    pool.query(
      `SELECT id, account_name AS title, proposed_completion_date AS target,
              user_id AS recipient_user_id
       FROM portal_deals
       WHERE proposed_completion_date IS NOT NULL
         AND stage NOT IN ('won', 'lost')
         AND user_id IS NOT NULL
         AND proposed_completion_date BETWEEN $1::date AND $2::date`,
      [windowStart, windowEnd],
    ),
  ]);

  const candidates: ReminderCandidate[] = [];
  for (const [subjectType, rows] of [
    ["task", taskRows.rows],
    ["deal", dealRows.rows],
  ] as const) {
    for (const row of rows as Array<Record<string, unknown>>) {
      const targetDate = toCalendarDate(row.target as string | Date | null);
      if (!targetDate) continue;
      candidates.push({
        subjectType,
        subjectId: String(row.id),
        subjectLabel: String(row.title ?? ""),
        targetDate,
        recipientUserId: String(row.recipient_user_id),
      });
    }
  }
  return candidates;
}

async function loadRecipients(userIds: string[]): Promise<Map<string, Recipient>> {
  if (userIds.length === 0) return new Map();
  const { rows } = await pool.query(
    `SELECT id, full_name, email, whatsapp_phone_e164, whatsapp_verified_at, reminder_opt_out
     FROM profiles WHERE id = ANY($1::uuid[])`,
    [userIds],
  );
  return new Map(
    (rows as Array<Record<string, unknown>>).map((row) => [
      String(row.id),
      {
        userId: String(row.id),
        fullName: row.full_name ? String(row.full_name) : null,
        email: row.email ? String(row.email) : null,
        whatsappPhone: row.whatsapp_phone_e164 ? String(row.whatsapp_phone_e164) : null,
        whatsappVerified: Boolean(row.whatsapp_verified_at),
        optOut: Boolean(row.reminder_opt_out),
      },
    ]),
  );
}

/**
 * Claims one (subject, recipient, offset, channel, target_date) delivery.
 *
 * Returns true only if THIS call inserted the row. A concurrent sweep (the
 * interval and an external cron firing at the same second) loses the race on
 * the unique index and gets false, so the message is sent exactly once.
 */
async function claimDispatch(input: {
  candidate: ReminderCandidate;
  offset: ReminderOffset;
  channel: ReminderChannel;
}): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO reminder_dispatches (
       subject_type, subject_id, recipient_user_id, offset_key, channel, target_date, status
     ) VALUES ($1,$2,$3,$4,$5,$6::date,'pending')
     ON CONFLICT DO NOTHING`,
    [
      input.candidate.subjectType,
      input.candidate.subjectId,
      input.candidate.recipientUserId,
      input.offset.key,
      input.channel,
      input.candidate.targetDate,
    ],
  );
  return (rowCount ?? 0) > 0;
}

async function finishDispatch(input: {
  candidate: ReminderCandidate;
  offset: ReminderOffset;
  channel: ReminderChannel;
  status: "sent" | "skipped" | "failed";
  detail?: string | null;
}): Promise<void> {
  await pool.query(
    `UPDATE reminder_dispatches
     SET status = $7, detail = $8
     WHERE subject_type = $1 AND subject_id = $2 AND recipient_user_id = $3
       AND offset_key = $4 AND channel = $5 AND target_date = $6::date`,
    [
      input.candidate.subjectType,
      input.candidate.subjectId,
      input.candidate.recipientUserId,
      input.offset.key,
      input.channel,
      input.candidate.targetDate,
      input.status,
      input.detail?.slice(0, 500) ?? null,
    ],
  );
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
}

function subjectUrl(subjectType: ReminderSubjectType): string | null {
  const base = appBaseUrl();
  if (!base) return null;
  return subjectType === "task" ? `${base}/tasks` : `${base}/deals`;
}

async function deliverInApp(input: {
  candidate: ReminderCandidate;
  copy: { title: string; body: string };
}): Promise<{ status: "sent" | "failed"; detail: string | null }> {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, read)
       VALUES ($1,$2,$3,$4,FALSE)`,
      [
        input.candidate.recipientUserId,
        input.copy.title,
        input.copy.body,
        REMINDER_NOTIFICATION_TYPE,
      ],
    );
    return { status: "sent", detail: null };
  } catch (error) {
    return { status: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function deliverWhatsapp(input: {
  recipient: Recipient;
  copy: { title: string; body: string };
}): Promise<{ status: "sent" | "skipped" | "failed"; detail: string | null }> {
  if (!input.recipient.whatsappPhone || !input.recipient.whatsappVerified) {
    return { status: "skipped", detail: "No verified WhatsApp number on the profile" };
  }
  try {
    const { sendWhatsappMessage } = await import("@/server/twilio.server");
    await sendWhatsappMessage(
      input.recipient.whatsappPhone,
      `${input.copy.title}\n\n${input.copy.body}`,
    );
    return { status: "sent", detail: null };
  } catch (error) {
    // Twilio rejects free-form sends outside the 24h customer-service window
    // unless an approved template is used. That is a configuration reality,
    // not a bug in the sweep — it is recorded and the other channels still
    // deliver.
    return { status: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}

async function deliverEmail(input: {
  candidate: ReminderCandidate;
  recipient: Recipient;
  copy: { title: string; body: string };
}): Promise<{ status: "sent" | "skipped" | "failed"; detail: string | null }> {
  if (!(await isEmailConfigured())) {
    return { status: "skipped", detail: "Email provider is not configured" };
  }
  if (!input.recipient.email) {
    return { status: "skipped", detail: "No email address on the profile" };
  }

  const url = subjectUrl(input.candidate.subjectType);
  const result = await sendEmail({
    to: input.recipient.email,
    subject: input.copy.title,
    text: `${input.copy.body}${url ? `\n\nOpen it here: ${url}` : ""}`,
    html: renderSimpleEmailHtml({
      title: input.copy.title,
      body: input.copy.body,
      actionLabel: url
        ? input.candidate.subjectType === "task"
          ? "Open tasks"
          : "Open deals"
        : undefined,
      actionUrl: url ?? undefined,
      footer: "You're receiving this because you own this record in the LIVEY Partner Portal.",
    }),
  });

  if (result.ok) return { status: "sent", detail: null };
  return { status: result.skipped ? "skipped" : "failed", detail: result.reason };
}

/**
 * Runs one full pass. Safe to call concurrently with itself.
 *
 * `today` is injectable so tests (and a backfill) can drive a specific day
 * without touching the system clock.
 */
export async function runReminderSweep(options?: {
  today?: string;
  now?: Date;
}): Promise<ReminderSweepSummary> {
  const now = options?.now ?? new Date();
  const today = options?.today ?? businessToday(now);

  const summary: ReminderSweepSummary = {
    ranAt: now.toISOString(),
    today,
    candidates: 0,
    due: 0,
    claimed: 0,
    delivered: { in_app: 0, whatsapp: 0, email: 0 },
    skipped: 0,
    failed: 0,
  };

  const candidates = await loadCandidates(today);
  summary.candidates = candidates.length;
  if (candidates.length === 0) return summary;

  const dueList = candidates
    .map((candidate) => ({ candidate, offset: resolveDueReminder(candidate.targetDate, today) }))
    .filter((entry): entry is { candidate: ReminderCandidate; offset: ReminderOffset } =>
      Boolean(entry.offset),
    );
  summary.due = dueList.length;
  if (dueList.length === 0) return summary;

  const recipients = await loadRecipients([
    ...new Set(dueList.map((entry) => entry.candidate.recipientUserId)),
  ]);

  for (const { candidate, offset } of dueList) {
    const recipient = recipients.get(candidate.recipientUserId);
    // A record whose owner's profile is gone (or who has muted reminders)
    // produces no dispatch rows at all, so un-muting later doesn't replay a
    // backlog of stale reminders at them.
    if (!recipient || recipient.optOut) continue;

    const copy = buildReminderCopy({
      subjectType: candidate.subjectType,
      subjectLabel: candidate.subjectLabel,
      offset,
      targetDate: candidate.targetDate,
    });

    for (const channel of REMINDER_CHANNELS) {
      const claimed = await claimDispatch({ candidate, offset, channel });
      if (!claimed) continue;
      summary.claimed += 1;

      let outcome: { status: "sent" | "skipped" | "failed"; detail: string | null };
      if (channel === "in_app") {
        outcome = await deliverInApp({ candidate, copy });
      } else if (channel === "whatsapp") {
        outcome = await deliverWhatsapp({ recipient, copy });
      } else {
        outcome = await deliverEmail({ candidate, recipient, copy });
      }

      // The claim row is kept even on failure, so a permanently broken
      // address or an unapproved WhatsApp template can't put the sweep into
      // a retry loop that re-sends on every tick. The next rung of the
      // ladder is the retry.
      await finishDispatch({ candidate, offset, channel, ...outcome });

      if (outcome.status === "sent") summary.delivered[channel] += 1;
      else if (outcome.status === "skipped") summary.skipped += 1;
      else summary.failed += 1;
    }
  }

  return summary;
}

/**
 * Human-readable one-liner for the server log and the job endpoint's
 * response body.
 */
export function describeSweep(summary: ReminderSweepSummary): string {
  const delivered = REMINDER_CHANNELS.map(
    (channel) => `${channel}=${summary.delivered[channel]}`,
  ).join(" ");
  return `[reminders] ${summary.today}: ${summary.candidates} candidates, ${summary.due} due, ${summary.claimed} claimed, ${delivered}, skipped=${summary.skipped}, failed=${summary.failed}`;
}

/** Re-exported so callers don't need two imports to render a reminder date. */
export { formatReminderDate, getReminderOffset };

// ---------------------------------------------------------------------------
// Distribution approval escalation (product.md §24.5.2)
// ---------------------------------------------------------------------------
//
// Same safety argument as the reminder sweep above: no caller, no auth
// context, and every message goes to someone the record itself names — the
// snapped manager, that manager's own manager, or the configured Super Admin
// fallback. It widens nobody's visibility.
//
// Idempotency is structural rather than claim-based here: the escalation
// Task carries a stable automation_key and the Notifications carry stable
// per-recipient event keys, so a second sweep over the same overdue approval
// creates nothing and re-notifies nobody.

export type DistributionEscalationSummary = {
  ranAt: string;
  overdue: number;
  escalated: number;
  toFallback: number;
  unroutable: number;
};

type OverdueApproval = {
  requestId: string;
  humanId: string;
  taskId: string;
  managerAssignmentId: string;
  managerUserId: string | null;
  escalationAssignmentId: string | null;
  escalationUserId: string | null;
  priority: string;
};

async function loadOverdueApprovals(now: Date): Promise<OverdueApproval[]> {
  const { rows } = await pool.query(
    `SELECT t.id AS task_id,
            r.id AS request_id,
            r.human_id,
            r.priority,
            r.manager_assignment_id,
            manager.user_id AS manager_user_id,
            manager.manager_assignment_id AS escalation_assignment_id,
            escalation.user_id AS escalation_user_id
     FROM tasks t
     JOIN stock_requests r
       ON r.id = t.related_id AND t.related_type = 'stock_request'
     JOIN assignments manager ON manager.assignment_id = r.manager_assignment_id
     LEFT JOIN assignments escalation
       ON escalation.assignment_id = manager.manager_assignment_id
      AND escalation.status = 'active'
     WHERE t.automation_source = 'stock_request'
       AND t.automation_key LIKE '%:manager-approval:%'
       AND t.status NOT IN ('completed', 'cancelled')
       AND t.due_at IS NOT NULL
       AND t.due_at < $1
       AND r.status = 'submitted'`,
    [now.toISOString()],
  );

  return (rows as Array<Record<string, unknown>>).map((row) => ({
    requestId: String(row.request_id),
    humanId: String(row.human_id),
    taskId: String(row.task_id),
    managerAssignmentId: String(row.manager_assignment_id),
    managerUserId: row.manager_user_id == null ? null : String(row.manager_user_id),
    escalationAssignmentId:
      row.escalation_assignment_id == null ? null : String(row.escalation_assignment_id),
    escalationUserId: row.escalation_user_id == null ? null : String(row.escalation_user_id),
    priority: String(row.priority ?? "medium"),
  }));
}

/**
 * The Super Admin an escalation lands on when the hierarchy runs out.
 *
 * Configurable through app_settings so an organisation can name the person
 * who actually watches this queue; falls back to the longest-standing Super
 * Admin so an unconfigured deployment still routes the work somewhere rather
 * than dropping it.
 */
async function resolveEscalationFallbackUserId(): Promise<string | null> {
  const configured = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'distribution.escalation_fallback_user_id'`,
  );
  const configuredId = (configured.rows[0] as { value?: unknown } | undefined)?.value;
  if (configuredId) {
    const exists = await pool.query(`SELECT id FROM profiles WHERE id = $1`, [
      String(configuredId),
    ]);
    if (exists.rows[0]) return String((exists.rows[0] as { id: unknown }).id);
  }

  const { rows } = await pool.query(
    `SELECT ur.user_id
     FROM user_roles ur
     WHERE ur.role = 'super_admin'
     ORDER BY ur.created_at ASC
     LIMIT 1`,
  );
  const row = rows[0] as { user_id?: unknown } | undefined;
  return row?.user_id ? String(row.user_id) : null;
}

export async function runDistributionEscalationSweep(options?: {
  now?: Date;
}): Promise<DistributionEscalationSummary> {
  const now = options?.now ?? new Date();
  const summary: DistributionEscalationSummary = {
    ranAt: now.toISOString(),
    overdue: 0,
    escalated: 0,
    toFallback: 0,
    unroutable: 0,
  };

  const overdue = await loadOverdueApprovals(now);
  summary.overdue = overdue.length;
  if (overdue.length === 0) return summary;

  const { ensureAutomatedTask, ensureNotification } =
    await import("@/server/workflow-automation.server");
  const { withTransaction } = await import("@/server/command-runtime.server");

  let fallbackUserId: string | null | undefined;

  for (const approval of overdue) {
    const usesFallback = !approval.escalationAssignmentId || !approval.escalationUserId;
    if (usesFallback && fallbackUserId === undefined) {
      fallbackUserId = await resolveEscalationFallbackUserId();
    }

    const escalationUserId = usesFallback ? (fallbackUserId ?? null) : approval.escalationUserId;
    const escalationKeySuffix = usesFallback
      ? "super-admin-fallback"
      : approval.escalationAssignmentId!;

    if (!escalationUserId) {
      // Nobody to escalate to at all. Recorded rather than silently skipped:
      // an unroutable escalation is an operations problem, and pretending it
      // was handled is how one goes unnoticed.
      summary.unroutable += 1;
      console.error(
        `[distribution] approval for ${approval.humanId} is overdue with no escalation recipient`,
      );
      continue;
    }

    const actionUrl = `/distribution?tab=requests&requestId=${approval.requestId}`;
    const reasonSuffix = usesFallback
      ? " No active manager was found above the approving assignment, so this was routed to the Super Admin fallback."
      : "";

    await withTransaction(async (tx) => {
      await ensureNotification(tx, {
        userId: approval.managerUserId,
        partnerId: null,
        title: `Stock request ${approval.humanId} is past its approval deadline`,
        message: "Approve or reject it, or it stays blocked with the requesting Distributor.",
        type: "stock_request",
        subjectType: "stock_request",
        subjectId: approval.requestId,
        actionUrl,
        eventKey: `stock-request:${approval.requestId}:approval-overdue`,
      });

      await ensureAutomatedTask(tx, {
        automationKey: `stock-request:${approval.requestId}:approval-escalation:${escalationKeySuffix}`,
        automationSource: "stock_request",
        templateVersion: 1,
        assigneeId: escalationUserId,
        // A sweep has no acting user; leaving the creator null is honest,
        // and automation_source already says what opened it.
        creatorId: null,
        relatedType: "stock_request",
        relatedId: approval.requestId,
        title: `Escalated: stock request ${approval.humanId} is awaiting approval`,
        description: `The approving manager has not decided within the ${approval.priority} priority SLA.${reasonSuffix}`,
        priority: "high",
        dueAt: null,
        partnerId: null,
      });

      await ensureNotification(tx, {
        userId: escalationUserId,
        partnerId: null,
        title: `Escalation: stock request ${approval.humanId} is awaiting approval`,
        message: `The approving manager has not decided within the ${approval.priority} priority SLA.${reasonSuffix}`,
        type: "stock_request",
        subjectType: "stock_request",
        subjectId: approval.requestId,
        actionUrl,
        eventKey: `stock-request:${approval.requestId}:approval-escalated`,
      });
    });

    summary.escalated += 1;
    if (usesFallback) summary.toFallback += 1;
  }

  return summary;
}

export function describeDistributionEscalationSweep(
  summary: DistributionEscalationSummary,
): string {
  return `[distribution] ${summary.overdue} overdue approval(s), ${summary.escalated} escalated (${summary.toFallback} to fallback), ${summary.unroutable} unroutable`;
}
