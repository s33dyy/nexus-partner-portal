// Contract for proposed-completion-date reminders.
//
// Everything in this module is pure: given a target date, "today", and a
// subject, it decides WHETHER a reminder is owed and WHAT it should say. The
// server module (src/server/reminders.server.ts) owns the impure half —
// finding subjects, resolving recipients, deduping against
// reminder_dispatches, and actually delivering on each channel.
//
// The split matters because the delivery half is untestable without a
// database and three external providers, while the decision half is where
// every off-by-one and timezone bug actually lives.

export const REMINDER_SUBJECT_TYPES = ["task", "deal"] as const;
export type ReminderSubjectType = (typeof REMINDER_SUBJECT_TYPES)[number];

export const REMINDER_CHANNELS = ["in_app", "whatsapp", "email"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export type ReminderOffset = {
  key: string;
  // Positive = that many days BEFORE the proposed completion date.
  // Zero = the day itself. Negative = that many days after (overdue).
  daysBefore: number;
  // Used in the reminder copy: "... is due in 3 days", "... is 7 days overdue".
  phrase: string;
  // Overdue reminders read differently and are styled differently in-app.
  overdue: boolean;
};

// Deliberately sparse rather than "every day until done": three nudges on the
// approach, then two after. A reminder that arrives daily gets muted by the
// recipient within a week, which is strictly worse than no reminder at all.
export const REMINDER_OFFSETS: readonly ReminderOffset[] = [
  { key: "t_minus_3", daysBefore: 3, phrase: "in 3 days", overdue: false },
  { key: "t_minus_1", daysBefore: 1, phrase: "tomorrow", overdue: false },
  { key: "due_today", daysBefore: 0, phrase: "today", overdue: false },
  { key: "overdue_1", daysBefore: -1, phrase: "1 day overdue", overdue: true },
  { key: "overdue_7", daysBefore: -7, phrase: "7 days overdue", overdue: true },
] as const;

export type ReminderOffsetKey = (typeof REMINDER_OFFSETS)[number]["key"];

const OFFSET_BY_KEY = new Map(REMINDER_OFFSETS.map((offset) => [offset.key, offset]));

export function getReminderOffset(key: string): ReminderOffset | null {
  return OFFSET_BY_KEY.get(key) ?? null;
}

/**
 * Whole-day difference between two calendar dates, counted in UTC days.
 *
 * Both inputs are `YYYY-MM-DD` calendar dates, not instants — a proposed
 * completion date is a promise about a DAY, not a moment, so comparing them
 * as UTC midnights is exactly right and sidesteps the DST/local-offset
 * arithmetic that makes `(a - b) / 86400000` wrong twice a year.
 *
 * Returns null if either input isn't a parseable calendar date.
 */
export function daysUntil(targetDate: string, today: string): number | null {
  const target = parseCalendarDate(targetDate);
  const now = parseCalendarDate(today);
  if (target === null || now === null) return null;
  return Math.round((target - now) / 86_400_000);
}

function parseCalendarDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month - 1, day);
  // Rejects impossible dates that Date.UTC silently rolls over (2026-02-31).
  const rolled = new Date(utc);
  if (rolled.getUTCMonth() !== month - 1 || rolled.getUTCDate() !== day) return null;
  return utc;
}

/**
 * Normalizes a timestamp or date column value to a `YYYY-MM-DD` calendar
 * date. tasks.proposed_completion_at is a TIMESTAMPTZ and
 * portal_deals.proposed_completion_date is a DATE, so the sweep sees both
 * shapes (and `pg` hands back a Date object for either).
 */
export function toCalendarDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const direct = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (direct && parseCalendarDate(direct[1]) !== null) return direct[1];
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * The single reminder owed for a subject today, or null if today isn't one
 * of the ladder's rungs.
 *
 * Exactly one offset can match a given day, so a subject can never generate
 * two reminders in the same sweep — and a sweep that runs twice in one day
 * resolves the same offset both times, which the reminder_dispatches unique
 * index then collapses into one delivery.
 */
export function resolveDueReminder(targetDate: string, today: string): ReminderOffset | null {
  const delta = daysUntil(targetDate, today);
  if (delta === null) return null;
  return REMINDER_OFFSETS.find((offset) => offset.daysBefore === delta) ?? null;
}

const SUBJECT_NOUN: Record<ReminderSubjectType, string> = {
  task: "task",
  deal: "deal",
};

export type ReminderCopy = {
  title: string;
  body: string;
};

/**
 * The wording used on every channel. In-app notifications, WhatsApp, and
 * email all render the SAME title/body so a user who gets two of them
 * doesn't have to work out whether they're being told about one thing or
 * two.
 */
export function buildReminderCopy(input: {
  subjectType: ReminderSubjectType;
  subjectLabel: string;
  offset: ReminderOffset;
  targetDate: string;
}): ReminderCopy {
  const noun = SUBJECT_NOUN[input.subjectType];
  const label = input.subjectLabel.trim() || `Untitled ${noun}`;
  const dateLabel = formatReminderDate(input.targetDate);

  if (input.offset.overdue) {
    return {
      title: `Overdue: ${label}`,
      body: `Your ${noun} "${label}" was proposed to complete on ${dateLabel} and is now ${input.offset.phrase}. Update the proposed completion date or close it out.`,
    };
  }

  if (input.offset.daysBefore === 0) {
    return {
      title: `Due today: ${label}`,
      body: `Your ${noun} "${label}" is proposed to complete today (${dateLabel}).`,
    };
  }

  return {
    title: `Due ${input.offset.phrase}: ${label}`,
    body: `Your ${noun} "${label}" is proposed to complete ${input.offset.phrase}, on ${dateLabel}.`,
  };
}

/** "12 Aug 2026" — unambiguous across locales, unlike 08/12/2026. */
export function formatReminderDate(value: string): string {
  const utc = parseCalendarDate(value);
  if (utc === null) return value;
  return new Date(utc).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The `type` written to notifications.type for in-app reminder rows. */
export const REMINDER_NOTIFICATION_TYPE = "reminder";
