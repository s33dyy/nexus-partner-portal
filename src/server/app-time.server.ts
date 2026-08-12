// Business-timezone helpers.
//
// The server runs in UTC (Railway containers do), but "today", "this
// evening", and "tomorrow" are questions about the calendar the users
// actually live on. Left as UTC, an India-based team gets "Good evening" at
// 11:30pm-for-them and a "due today" reminder for a day that started six
// hours earlier.
//
// APP_TIMEZONE (an IANA zone, e.g. "Asia/Kolkata") is the single knob for
// this, shared by the reminder sweep and the daily digest so the two can
// never disagree about which day it is.

const DEFAULT_TIME_ZONE = "UTC";

export function appTimeZone(): string {
  return process.env.APP_TIMEZONE?.trim() || DEFAULT_TIME_ZONE;
}

function partsInZone(now: Date, timeZone: string): Intl.DateTimeFormatPart[] | null {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
  } catch {
    return null;
  }
}

let warnedInvalidZone = false;

function partsOrFallback(now: Date, timeZone?: string): Intl.DateTimeFormatPart[] {
  const zone = timeZone ?? appTimeZone();
  const parts = partsInZone(now, zone);
  if (parts) return parts;
  if (!warnedInvalidZone) {
    warnedInvalidZone = true;
    console.warn(`[app-time] invalid APP_TIMEZONE "${zone}" — falling back to UTC`);
  }
  return partsInZone(now, DEFAULT_TIME_ZONE) ?? [];
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((entry) => entry.type === type)?.value ?? "";
}

/** `YYYY-MM-DD` for the given instant, in the business timezone. */
export function zonedCalendarDate(now: Date = new Date(), timeZone?: string): string {
  const parts = partsOrFallback(now, timeZone);
  const year = part(parts, "year");
  const month = part(parts, "month");
  const day = part(parts, "day");
  if (!year || !month || !day) return now.toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
}

/** Hour of day 0-23 for the given instant, in the business timezone. */
export function zonedHour(now: Date = new Date(), timeZone?: string): number {
  const parts = partsOrFallback(now, timeZone);
  // en-CA with hour12:false renders midnight as "24" in some ICU versions.
  const hour = Number(part(parts, "hour"));
  if (!Number.isFinite(hour)) return now.getUTCHours();
  return hour % 24;
}

/** Calendar-date arithmetic in whole days, free of DST skew. */
export function shiftCalendarDate(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(base)) return date;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The UTC instant range covering a business-timezone calendar day, for use
 * in `created_at >= start AND created_at < end` comparisons against
 * TIMESTAMPTZ columns.
 *
 * Derived by measuring the zone's actual offset at midday on that date
 * rather than assuming a fixed one, so it stays correct across DST changes.
 */
export function zonedDayRange(
  date: string,
  timeZone?: string,
): { startUtc: Date; endUtc: Date } | null {
  const noonUtc = Date.parse(`${date}T12:00:00.000Z`);
  if (Number.isNaN(noonUtc)) return null;

  const zone = timeZone ?? appTimeZone();
  const offsetMs = zoneOffsetMs(new Date(noonUtc), zone);
  const startUtc = new Date(Date.parse(`${date}T00:00:00.000Z`) - offsetMs);
  return { startUtc, endUtc: new Date(startUtc.getTime() + 86_400_000) };
}

/**
 * How far ahead of UTC the zone is at that instant, in milliseconds.
 * Formats the instant into the zone's own wall-clock fields and subtracts.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = partsInZone(instant, timeZone);
  if (!parts) return 0;
  const wallClock = Date.parse(
    `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}T${String(
      Number(part(parts, "hour")) % 24,
    ).padStart(2, "0")}:${part(parts, "minute")}:00.000Z`,
  );
  if (Number.isNaN(wallClock)) return 0;
  // Rounded to the minute — the formatter drops seconds, and no real zone
  // has a sub-minute offset.
  return Math.round((wallClock - instant.getTime()) / 60_000) * 60_000;
}
