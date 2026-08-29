// Contract for outreach sequences — automated, multi-step follow-up cadences
// (product.md §19.6 consent rules apply to every send this produces).
//
// Everything in this module is pure. Given a template, a start date, and a
// set of contact facts it decides WHEN each step is owed, WHAT it says, and
// WHETHER it may be sent at all. The server half
// (src/server/outreach-*.server.ts) owns finding enrollments, claiming a
// delivery, calling the mail provider, and opening Tasks.
//
// The split is where it is on purpose: the delivery half needs a database
// and a mail provider to run, while every bug that actually reaches a
// customer — a half-rendered "Hi ," greeting, a step that lands on a Sunday,
// a message sent to somebody who opted out — lives in the decision half and
// is testable here.

export const OUTREACH_SEQUENCE_STATUSES = ["draft", "active", "archived"] as const;
export type OutreachSequenceStatus = (typeof OUTREACH_SEQUENCE_STATUSES)[number];

/** Only `active` sequences are swept. A draft can be edited freely; an
 * archived one stops enrolling but keeps its history and its analytics. */
export const OUTREACH_SEQUENCE_TRANSITIONS: Record<
  OutreachSequenceStatus,
  readonly OutreachSequenceStatus[]
> = {
  draft: ["active", "archived"],
  active: ["draft", "archived"],
  archived: ["draft"],
};

export function isAllowedSequenceTransition(
  from: OutreachSequenceStatus,
  to: OutreachSequenceStatus,
): boolean {
  return OUTREACH_SEQUENCE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** An `email` step is sent by the sweep. A `task` step opens a Task for the
 * sequence owner — the "connect on LinkedIn" / "give them a call" rungs that
 * a human, not a mail server, has to do. */
export const OUTREACH_STEP_TYPES = ["email", "task"] as const;
export type OutreachStepType = (typeof OUTREACH_STEP_TYPES)[number];

export const OUTREACH_ENROLLMENT_STATUSES = ["active", "finished", "unenrolled"] as const;
export type OutreachEnrollmentStatus = (typeof OUTREACH_ENROLLMENT_STATUSES)[number];

export const OUTREACH_EXECUTION_STATUSES = [
  "pending",
  "sending",
  "sent",
  "skipped",
  "failed",
] as const;
export type OutreachExecutionStatus = (typeof OUTREACH_EXECUTION_STATUSES)[number];

export type OutreachUnenrollReason = {
  key: string;
  label: string;
  /** True for the outcomes a rep reports by hand — the sweep can only ever
   * set the automatic ones. */
  manual: boolean;
  /** Counted as a reply in the Analyze tab. */
  countsAsReply: boolean;
  /** Counted as a booked meeting in the Analyze tab. */
  countsAsMeeting: boolean;
};

// Deliberately small and outcome-shaped. "Why did this person stop hearing
// from us" is the only question this list has to answer, and every entry is
// either something good (they replied, they booked, a deal opened) or
// something that must stop the cadence immediately (they opted out, the
// address bounced).
export const OUTREACH_UNENROLL_REASONS: readonly OutreachUnenrollReason[] = [
  { key: "replied", label: "Replied", manual: true, countsAsReply: true, countsAsMeeting: false },
  {
    key: "meeting_booked",
    label: "Meeting booked",
    manual: true,
    countsAsReply: true,
    countsAsMeeting: true,
  },
  {
    key: "deal_created",
    label: "Deal created",
    manual: false,
    countsAsReply: true,
    countsAsMeeting: false,
  },
  {
    key: "not_interested",
    label: "Not interested",
    manual: true,
    countsAsReply: true,
    countsAsMeeting: false,
  },
  {
    key: "opted_out",
    label: "Unsubscribed",
    manual: false,
    countsAsReply: false,
    countsAsMeeting: false,
  },
  {
    key: "bounced",
    label: "Address bounced",
    manual: false,
    countsAsReply: false,
    countsAsMeeting: false,
  },
  {
    key: "stopped_by_owner",
    label: "Stopped by owner",
    manual: true,
    countsAsReply: false,
    countsAsMeeting: false,
  },
] as const;

const UNENROLL_REASON_BY_KEY = new Map(
  OUTREACH_UNENROLL_REASONS.map((reason) => [reason.key, reason]),
);

export function getUnenrollReason(key: string | null | undefined): OutreachUnenrollReason | null {
  if (!key) return null;
  return UNENROLL_REASON_BY_KEY.get(key) ?? null;
}

export function isManualUnenrollReason(key: string): boolean {
  return getUnenrollReason(key)?.manual === true;
}

// ---------------------------------------------------------------------------
// Personalisation tokens
// ---------------------------------------------------------------------------

export type OutreachToken = {
  key: string;
  label: string;
  /** Sample shown in the editor's token picker so the writer can see the
   * shape of what will be substituted. */
  example: string;
};

export const OUTREACH_TOKENS: readonly OutreachToken[] = [
  { key: "first_name", label: "Contact first name", example: "Devon" },
  { key: "last_name", label: "Contact last name", example: "Sharma" },
  { key: "full_name", label: "Contact full name", example: "Devon Sharma" },
  { key: "email", label: "Contact email", example: "devon@acme.com" },
  { key: "company", label: "Company", example: "Acme Logistics" },
  { key: "country", label: "Country", example: "India" },
  { key: "region", label: "Region", example: "APAC" },
  { key: "segment", label: "Segment", example: "Enterprise" },
  { key: "sender_name", label: "Your name", example: "Mark" },
  { key: "sender_email", label: "Your email", example: "mark@livey.com" },
  { key: "meeting_link", label: "Your meeting link", example: "https://cal.com/mark" },
] as const;

export const OUTREACH_TOKEN_KEYS: readonly string[] = OUTREACH_TOKENS.map((token) => token.key);

export type OutreachTokenValues = Partial<Record<string, string | null>>;

export type RenderedTemplate = {
  text: string;
  /** Tokens that resolved to nothing AND carried no fallback. The sweep
   * refuses to send a message with any of these rather than mail somebody a
   * literal "Hi ," — an empty greeting is worse than a late one. */
  missing: string[];
  /** Tokens the writer typed that aren't in OUTREACH_TOKENS at all. Surfaced
   * as an editor validation error, never sent. */
  unknown: string[];
};

// `{{first_name}}` or `{{first_name|there}}`. The fallback half is what makes
// a token safe to use in a greeting: a contact with no first name on file
// still gets "Hi there," instead of blocking the whole send.
const TOKEN_PATTERN = /\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g;

export function renderOutreachTemplate(
  template: string,
  values: OutreachTokenValues,
): RenderedTemplate {
  const missing = new Set<string>();
  const unknown = new Set<string>();

  const text = template.replace(TOKEN_PATTERN, (match, rawKey: string, rawFallback?: string) => {
    const key = rawKey.trim();
    if (!OUTREACH_TOKEN_KEYS.includes(key)) {
      unknown.add(key);
      // Left verbatim so the writer sees exactly what they typed when the
      // editor shows them the preview.
      return match;
    }
    const value = values[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    const fallback = rawFallback?.trim();
    if (fallback) return fallback;
    missing.add(key);
    return "";
  });

  return { text, missing: [...missing], unknown: [...unknown] };
}

/** Splits a contact's name into the parts the tokens above need. A single
 * word is a first name — the common case for "Devon" typed into an enrolment
 * form — and everything after the first space is the surname. */
export function splitContactName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export const MAX_SEQUENCE_STEPS = 20;
export const MAX_STEP_DAY_OFFSET = 180;

/** The business-timezone hours a sequence email may go out in. Outside this
 * window a due step simply waits for the next sweep — §19.6 asks for quiet
 * hours to be respected, and nobody reads a prospecting email at 3am anyway. */
export const OUTREACH_SEND_WINDOW = { startHour: 8, endHour: 19 } as const;

export function isWithinSendWindow(hour: number): boolean {
  return hour >= OUTREACH_SEND_WINDOW.startHour && hour < OUTREACH_SEND_WINDOW.endHour;
}

function parseCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toCalendarString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, read in UTC because a calendar date has no
 * zone of its own. */
export function isWeekend(date: string): boolean {
  const parsed = parseCalendarDate(date);
  if (!parsed) return false;
  const day = parsed.getUTCDay();
  return day === 0 || day === 6;
}

/** Next weekday on or after `date`. Idempotent on a weekday. */
export function nextBusinessDay(date: string): string {
  let cursor = parseCalendarDate(date);
  if (!cursor) return date;
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return toCalendarString(cursor);
}

/**
 * Adds `days` to a calendar date, counting only weekdays when
 * `businessDaysOnly` is set.
 *
 * Business-day counting starts from the next weekday, so a sequence enrolled
 * on a Saturday with a day-0 first step sends on Monday rather than
 * immediately — which is the whole point of the setting.
 */
export function addDays(date: string, days: number, businessDaysOnly: boolean): string {
  if (!businessDaysOnly) {
    const parsed = parseCalendarDate(date);
    if (!parsed) return date;
    return toCalendarString(new Date(parsed.getTime() + days * 86_400_000));
  }

  let cursor = parseCalendarDate(nextBusinessDay(date));
  if (!cursor) return date;
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + 86_400_000);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return toCalendarString(cursor);
}

export type SequenceStepSchedule = {
  stepIndex: number;
  dayOffset: number;
  scheduledDate: string;
};

/**
 * Materialises the whole timeline at enrolment time.
 *
 * Computing every date up front (rather than "what's next?" on each sweep)
 * is what makes the enrolment's future visible in the UI, makes the sweep a
 * plain `WHERE scheduled_for <= now()` scan, and means a sequence edited
 * tomorrow cannot silently rewrite the cadence somebody is already halfway
 * through.
 */
export function computeStepSchedule(input: {
  startDate: string;
  steps: readonly { stepIndex: number; dayOffset: number }[];
  businessDaysOnly: boolean;
}): SequenceStepSchedule[] {
  return input.steps.map((step) => ({
    stepIndex: step.stepIndex,
    dayOffset: step.dayOffset,
    scheduledDate: addDays(input.startDate, step.dayOffset, input.businessDaysOnly),
  }));
}

/** The instant a step scheduled for `date` becomes due, as an ISO string.
 * Anchored at the start of the send window rather than midnight so a step is
 * never "due" during the hours the sweep refuses to send in. */
export function scheduledInstant(date: string, offsetMinutesFromUtc = 0): string {
  const base = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(base)) return new Date().toISOString();
  const windowStart = base + OUTREACH_SEND_WINDOW.startHour * 3_600_000;
  return new Date(windowStart - offsetMinutesFromUtc * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type SequenceStepDraft = {
  stepType: OutreachStepType;
  dayOffset: number;
  subject: string;
  body: string;
  taskTitle: string;
  taskPriority: string;
};

export type StepValidationFailure = { index: number | null; message: string };

/**
 * Structural rules a sequence must satisfy before it can be saved.
 *
 * Non-decreasing day offsets are the one that matters in practice: steps are
 * displayed and executed in index order, so a step 3 scheduled before step 2
 * would send the follow-up ahead of the thing it follows up on.
 */
export function validateSequenceSteps(
  steps: readonly SequenceStepDraft[],
): StepValidationFailure | null {
  if (steps.length === 0) {
    return { index: null, message: "A sequence needs at least one step" };
  }
  if (steps.length > MAX_SEQUENCE_STEPS) {
    return { index: null, message: `A sequence can have at most ${MAX_SEQUENCE_STEPS} steps` };
  }

  let previousOffset = -1;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    if (!OUTREACH_STEP_TYPES.includes(step.stepType)) {
      return { index, message: "Unknown step type" };
    }
    if (!Number.isInteger(step.dayOffset) || step.dayOffset < 0) {
      return { index, message: "Day must be a whole number of days from enrolment" };
    }
    if (step.dayOffset > MAX_STEP_DAY_OFFSET) {
      return { index, message: `Day cannot be more than ${MAX_STEP_DAY_OFFSET} days out` };
    }
    if (step.dayOffset < previousOffset) {
      return { index, message: "Steps must run in order — this one is earlier than the last" };
    }
    previousOffset = step.dayOffset;

    if (step.stepType === "email") {
      if (!step.subject.trim()) return { index, message: "An email step needs a subject" };
      if (!step.body.trim()) return { index, message: "An email step needs a body" };
      const rendered = [
        renderOutreachTemplate(step.subject, {}),
        renderOutreachTemplate(step.body, {}),
      ];
      const unknown = [...new Set(rendered.flatMap((result) => result.unknown))];
      if (unknown.length > 0) {
        return { index, message: `Unknown personalisation token: ${unknown.join(", ")}` };
      }
    } else if (!step.taskTitle.trim()) {
      return { index, message: "A task step needs a title" };
    }
  }

  return null;
}

/** How long the whole cadence runs, in days from enrolment. */
export function sequenceDurationDays(steps: readonly { dayOffset: number }[]): number {
  if (steps.length === 0) return 0;
  return Math.max(...steps.map((step) => step.dayOffset));
}

/** Share of steps the system performs unattended — the "33% automated"
 * figure a sequence card leads with. */
export function sequenceAutomationPercent(
  steps: readonly { stepType: OutreachStepType }[],
): number {
  if (steps.length === 0) return 0;
  const automated = steps.filter((step) => step.stepType === "email").length;
  return Math.round((automated / steps.length) * 100);
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export type SequenceAnalyticsInput = {
  enrolled: number;
  active: number;
  finished: number;
  unenrolled: number;
  emailsSent: number;
  emailsOpened: number;
  emailsFailed: number;
  /** Unenrolment reason keys, one per unenrolled enrolment. */
  unenrollReasonKeys: readonly string[];
};

export type SequenceAnalytics = {
  enrolled: number;
  active: number;
  finished: number;
  unenrolled: number;
  emailsSent: number;
  emailsOpened: number;
  emailsFailed: number;
  replies: number;
  meetings: number;
  openRate: number;
  replyRate: number;
  meetingRate: number;
};

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Open rate is per email SENT; reply and meeting rates are per contact
 * ENROLLED.
 *
 * The two denominators differ because the questions do: "did this message
 * land" is about messages, while "did this cadence work" is about people. A
 * reply rate divided by sends would quietly shrink every time a sequence
 * grew a step, which reads as the copy getting worse when nothing changed.
 */
export function summarizeSequenceAnalytics(input: SequenceAnalyticsInput): SequenceAnalytics {
  let replies = 0;
  let meetings = 0;
  for (const key of input.unenrollReasonKeys) {
    const reason = getUnenrollReason(key);
    if (!reason) continue;
    if (reason.countsAsReply) replies += 1;
    if (reason.countsAsMeeting) meetings += 1;
  }

  return {
    enrolled: input.enrolled,
    active: input.active,
    finished: input.finished,
    unenrolled: input.unenrolled,
    emailsSent: input.emailsSent,
    emailsOpened: input.emailsOpened,
    emailsFailed: input.emailsFailed,
    replies,
    meetings,
    openRate: rate(input.emailsOpened, input.emailsSent),
    replyRate: rate(replies, input.enrolled),
    meetingRate: rate(meetings, input.enrolled),
  };
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

/** The form an address is stored and compared in. Lower-cased and trimmed
 * only — deliberately NOT gmail-style dot/plus stripping, which is a
 * provider-specific rule that would wrongly merge two distinct mailboxes at
 * every other provider. */
export function normalizeOutreachEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleOutreachEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

/** Footer appended to every sequence email. An outreach message with no way
 * out of the cadence is the thing §19.6 exists to prevent. */
export function outreachUnsubscribeFooter(unsubscribeUrl: string | null): string {
  if (!unsubscribeUrl) return "";
  return `\n\n—\nIf you'd rather not hear from us, unsubscribe here: ${unsubscribeUrl}`;
}
