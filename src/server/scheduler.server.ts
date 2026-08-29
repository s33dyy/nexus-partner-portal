import { describeDigestEmailSweep, runDigestEmailSweep } from "@/server/digest-email.server";
import { describeOutreachSweep, runOutreachSweep } from "@/server/outreach-sweep.server";
import {
  describeDistributionEscalationSweep,
  describeSweep,
  runDistributionEscalationSweep,
  runReminderSweep,
} from "@/server/reminders.server";

// Background job scheduling.
//
// This project deploys as a single always-on Railway service (see
// railway.json / docker/entrypoint.sh) with no worker process, no queue, and
// no platform cron. Rather than introduce all three for one recurring job,
// reminders run two ways, both of which are safe to have on at once:
//
//  1. An in-process interval started on server boot. Zero extra
//     infrastructure, and it is what actually runs in production today.
//  2. POST /api/jobs/reminders, guarded by JOBS_SECRET, so an external
//     scheduler (Railway cron, GitHub Actions, cron-job.org, a health
//     checker) can drive it instead of — or alongside — the interval.
//
// Running both, or running several replicas, cannot double-send: every
// delivery is claimed by a unique-indexed INSERT in reminder_dispatches
// before it is sent, so exactly one caller wins each claim.

const DEFAULT_INTERVAL_MINUTES = 30;

// Migrations run in the entrypoint before the server starts, but the pool's
// first connection and any platform-side networking still settle for a
// moment after boot. Waiting a beat keeps the first sweep out of that window.
const BOOT_DELAY_MS = 20_000;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let sweepInFlight = false;

function remindersEnabled(): boolean {
  // Default on. Set REMINDERS_ENABLED=false to run the app with the
  // scheduler dormant (useful for local dev, and for a second replica if
  // this ever scales out and you'd rather only one instance swept).
  return (process.env.REMINDERS_ENABLED ?? "true").toLowerCase() !== "false";
}

function intervalMs(): number {
  const raw = Number(process.env.REMINDERS_INTERVAL_MINUTES);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MINUTES;
  // A minute is the floor: the sweep is cheap and idempotent, but there is
  // no reason to hammer the database more often than that.
  return Math.max(minutes, 1) * 60_000;
}

/**
 * Runs one sweep, guaranteeing it never overlaps with itself.
 *
 * Overlap protection is local to this process only — cross-process safety
 * comes from the reminder_dispatches claim, not from this flag. The flag just
 * stops a slow sweep from stacking up behind the interval.
 */
export async function runRemindersOnce(source: string): Promise<void> {
  if (sweepInFlight) {
    console.log(`[scheduler] skipping ${source} sweep — one is already running`);
    return;
  }
  sweepInFlight = true;
  try {
    // Both sweeps share the tick. They are independently idempotent (each
    // claims its own dispatch rows before sending), and each is wrapped so a
    // failure in one cannot stop the other from running.
    try {
      const summary = await runReminderSweep();
      console.log(`${describeSweep(summary)} (via ${source})`);
    } catch (error) {
      console.error("[scheduler] reminder sweep failed", error);
    }

    try {
      const summary = await runDigestEmailSweep();
      console.log(`${describeDigestEmailSweep(summary)} (via ${source})`);
    } catch (error) {
      console.error("[scheduler] digest email sweep failed", error);
    }

    // Outreach sequence delivery. Independently idempotent like the sweeps
    // above — every step is claimed by an atomic status UPDATE before it is
    // sent — and wrapped so a mail-provider outage cannot stop the others.
    try {
      const summary = await runOutreachSweep();
      console.log(`${describeOutreachSweep(summary)} (via ${source})`);
    } catch (error) {
      console.error("[scheduler] outreach sweep failed", error);
    }

    // Distribution approval SLA (product.md §24.5.2). Independently
    // idempotent like the two above — the escalation Task and its
    // Notifications carry stable keys — and wrapped so a failure here cannot
    // stop the others from running on the next tick.
    try {
      const summary = await runDistributionEscalationSweep();
      console.log(`${describeDistributionEscalationSweep(summary)} (via ${source})`);
    } catch (error) {
      console.error("[scheduler] distribution escalation sweep failed", error);
    }
  } finally {
    sweepInFlight = false;
  }
}

/** Idempotent — calling this more than once is a no-op. */
export function startBackgroundJobs(): void {
  if (started) return;
  started = true;

  if (!remindersEnabled()) {
    console.log("[scheduler] reminders disabled (REMINDERS_ENABLED=false)");
    return;
  }

  const period = intervalMs();
  console.log(
    `[scheduler] reminder + digest-email + outreach sweep every ${Math.round(period / 60_000)}m`,
  );

  setTimeout(() => {
    void runRemindersOnce("boot");
    timer = setInterval(() => {
      void runRemindersOnce("interval");
    }, period);
  }, BOOT_DELAY_MS);
}

export function stopBackgroundJobs(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

function timingSafeEqual(a: string, b: string): boolean {
  // Constant-time comparison so the secret can't be recovered a byte at a
  // time from response timing. Length is compared first and the loop always
  // runs over the full expected secret.
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

/**
 * POST /api/jobs/reminders — external-scheduler entry point.
 *
 * Auth is a shared secret in `x-jobs-secret` (or `Authorization: Bearer`).
 * When JOBS_SECRET is unset the endpoint is disabled outright rather than
 * left open — an unauthenticated job trigger is a denial-of-service handle
 * on the database and a way to spam every user's WhatsApp.
 */
export async function handleReminderJobRequest(request: Request): Promise<Response> {
  const secret = process.env.JOBS_SECRET ?? "";
  if (!secret) {
    return json({ error: "Job endpoint is disabled (JOBS_SECRET is not set)" }, 503);
  }

  const header =
    request.headers.get("x-jobs-secret") ??
    (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!header || !timingSafeEqual(header, secret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const reminders = await runReminderSweep();
    console.log(`${describeSweep(reminders)} (via api)`);
    const digestEmail = await runDigestEmailSweep();
    console.log(`${describeDigestEmailSweep(digestEmail)} (via api)`);
    const outreach = await runOutreachSweep();
    console.log(`${describeOutreachSweep(outreach)} (via api)`);
    return json({ ok: true, summary: reminders, digestEmail, outreach }, 200);
  } catch (error) {
    console.error("[scheduler] job sweep failed (api)", error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
