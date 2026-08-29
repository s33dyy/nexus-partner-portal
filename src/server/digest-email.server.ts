import type { UserDigest } from "@/domain/contracts/digest";
import { shiftCalendarDate, zonedCalendarDate, zonedHour } from "@/server/app-time.server";
import { getUserDigestForUser } from "@/server/digest.server";
import { isEmailConfigured, renderSimpleEmailHtml, sendEmail } from "@/server/email.server";
import { pool } from "@/server/postgres.server";

// Daily digest email.
//
// Same security posture as the reminder sweep, and for the same reason: this
// module queries `pool` directly because a scheduled job has no caller and so
// no auth context to scope by. It never assembles content itself — every fact
// in the email comes from getUserDigestForUser(), which resolves the
// recipient's OWN governed context and runs the identical capability and
// policy checks as the in-app dialog. A recipient can therefore never be
// emailed something the UI would have hidden from them.
//
// Any future change that composes digest content here, rather than delegating
// to getUserDigestForUser(), reopens exactly that hole.

const DEFAULT_SEND_HOUR = 8;

export type DigestEmailSummary = {
  ranAt: string;
  today: string;
  sendHour: number;
  eligible: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Set when the sweep declined to do anything at all, with the reason. */
  idleReason?: string;
};

function sendHour(): number {
  const raw = Number(process.env.DIGEST_EMAIL_HOUR);
  if (!Number.isFinite(raw) || raw < 0 || raw > 23) return DEFAULT_SEND_HOUR;
  return Math.floor(raw);
}

function digestEmailEnabled(): boolean {
  return (process.env.DIGEST_EMAIL_ENABLED ?? "true").toLowerCase() !== "false";
}

type Recipient = { userId: string; email: string; fullName: string | null };

/**
 * Everyone who could receive today's digest.
 *
 * Deliberately narrow: a real email address, not opted out, and an ACTIVE
 * governed assignment. The assignment join is what stops the sweep mailing
 * offboarded or never-activated accounts — getUserDigestForUser would return
 * an empty digest for them anyway, but this avoids doing that work (and
 * claiming a dispatch row) for every dormant profile in the database.
 */
async function loadRecipients(): Promise<Recipient[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT p.id, p.email, p.full_name
     FROM profiles p
     JOIN assignments a ON a.user_id = p.id AND a.status = 'active' AND a.revoked_at IS NULL
     WHERE p.digest_email_opt_out = FALSE
       AND p.email IS NOT NULL
       AND p.email <> ''`,
  );
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    userId: String(row.id),
    email: String(row.email),
    fullName: row.full_name ? String(row.full_name) : null,
  }));
}

/** Claims one recipient-day. Returns true only if THIS call inserted it. */
async function claim(userId: string, targetDate: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO digest_email_dispatches (recipient_user_id, target_date, status)
     VALUES ($1, $2::date, 'pending')
     ON CONFLICT DO NOTHING`,
    [userId, targetDate],
  );
  return (rowCount ?? 0) > 0;
}

async function finish(
  userId: string,
  targetDate: string,
  status: "sent" | "skipped" | "failed",
  detail?: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE digest_email_dispatches SET status = $3, detail = $4
     WHERE recipient_user_id = $1 AND target_date = $2::date`,
    [userId, targetDate, status, detail?.slice(0, 500) ?? null],
  );
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "").replace(/\/+$/, "");
}

/**
 * Plain-text body.
 *
 * The digest's own `narrative` is already a complete, deterministic paragraph
 * built from the structured fields — it is what the in-app dialog reads aloud
 * — so the email leads with it verbatim rather than paraphrasing and risking
 * a second, subtly different account of the same day.
 */
export function renderDigestText(digest: UserDigest): string {
  const lines = [digest.narrative, ""];

  if (digest.tasks.length > 0) {
    lines.push("Due soon:");
    for (const task of digest.tasks.slice(0, 8)) lines.push(`  • ${task.title}`);
    lines.push("");
  }
  if (digest.tickets.length > 0) {
    lines.push("Open tickets:");
    for (const ticket of digest.tickets.slice(0, 5)) lines.push(`  • ${ticket.subject}`);
    lines.push("");
  }
  if (digest.deals.length > 0) {
    lines.push("Open deals:");
    for (const deal of digest.deals.slice(0, 5)) {
      lines.push(`  • ${deal.accountName} — ${deal.amount} (${deal.stage})`);
    }
    lines.push("");
  }

  const url = appBaseUrl();
  if (url) lines.push(`Open the portal: ${url}/dashboard`);
  return lines.join("\n").trim();
}

/**
 * Runs one pass.
 *
 * Idempotent and safe to call on the same interval as the reminder sweep: the
 * unique index on (recipient, target_date) means only one caller ever wins the
 * claim for a given person-day, no matter how many times this runs or how many
 * replicas run it.
 */
export async function runDigestEmailSweep(options?: {
  now?: Date;
  today?: string;
}): Promise<DigestEmailSummary> {
  const now = options?.now ?? new Date();
  const today = options?.today ?? zonedCalendarDate(now);
  const hour = sendHour();

  const summary: DigestEmailSummary = {
    ranAt: now.toISOString(),
    today,
    sendHour: hour,
    eligible: 0,
    claimed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  if (!digestEmailEnabled()) {
    return { ...summary, idleReason: "DIGEST_EMAIL_ENABLED=false" };
  }
  if (!(await isEmailConfigured())) {
    // Claiming rows we cannot act on would burn the day's slot and mean the
    // digest never arrives once email IS configured.
    return { ...summary, idleReason: "Email provider is not configured" };
  }
  if (zonedHour(now) < hour) {
    return { ...summary, idleReason: `Before the ${hour}:00 send hour` };
  }

  const recipients = await loadRecipients();
  summary.eligible = recipients.length;

  for (const recipient of recipients) {
    if (!(await claim(recipient.userId, today))) continue;
    summary.claimed += 1;

    try {
      // Built on the previous calendar day's evening clock so the email
      // summarises a whole day rather than the eight minutes since midnight.
      const digest = await getUserDigestForUser(recipient.userId, { now });

      if (!digest.available) {
        summary.skipped += 1;
        await finish(recipient.userId, today, "skipped", "No digest available for this role");
        continue;
      }

      const url = appBaseUrl();
      const result = await sendEmail({
        to: recipient.email,
        subject: digest.greeting || "Your LIVEY briefing",
        text: renderDigestText(digest),
        html: renderSimpleEmailHtml({
          title: digest.greeting || "Your LIVEY briefing",
          body: digest.narrative,
          actionLabel: url ? "Open the portal" : undefined,
          actionUrl: url ? `${url}/dashboard` : undefined,
          footer: "You're receiving this because daily briefings are on for your account.",
        }),
      });

      if (result.ok) {
        summary.sent += 1;
        await finish(recipient.userId, today, "sent");
      } else if (result.skipped) {
        summary.skipped += 1;
        await finish(recipient.userId, today, "skipped", result.reason);
      } else {
        summary.failed += 1;
        await finish(recipient.userId, today, "failed", result.reason);
      }
    } catch (error) {
      // One bad recipient must not abort the run for everybody after them.
      summary.failed += 1;
      await finish(
        recipient.userId,
        today,
        "failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return summary;
}

export function describeDigestEmailSweep(summary: DigestEmailSummary): string {
  if (summary.idleReason) {
    return `[digest-email] ${summary.today}: idle — ${summary.idleReason}`;
  }
  return `[digest-email] ${summary.today}: ${summary.eligible} eligible, ${summary.claimed} claimed, sent=${summary.sent}, skipped=${summary.skipped}, failed=${summary.failed}`;
}

/** Re-exported for callers that need day arithmetic alongside a sweep. */
export { shiftCalendarDate };
