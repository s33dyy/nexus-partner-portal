import { describe, expect, test } from "bun:test";

import {
  buildReminderCopy,
  daysUntil,
  formatReminderDate,
  getReminderOffset,
  REMINDER_OFFSETS,
  resolveDueReminder,
  toCalendarDate,
} from "@/domain/contracts/reminders";

describe("daysUntil", () => {
  test("counts whole calendar days forward and backward", () => {
    expect(daysUntil("2026-08-14", "2026-08-11")).toBe(3);
    expect(daysUntil("2026-08-11", "2026-08-11")).toBe(0);
    expect(daysUntil("2026-08-10", "2026-08-11")).toBe(-1);
  });

  test("crosses month and year boundaries", () => {
    expect(daysUntil("2026-09-01", "2026-08-31")).toBe(1);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
    expect(daysUntil("2026-03-01", "2026-02-28")).toBe(1);
  });

  // The reason this module counts UTC midnights instead of doing
  // (a - b) / 86400000 on local Date objects: a local-time span across a DST
  // boundary is 23 or 25 hours, which floors to the wrong day.
  test("is unaffected by daylight-saving transitions", () => {
    // US DST starts 2026-03-08; EU DST starts 2026-03-29.
    expect(daysUntil("2026-03-09", "2026-03-08")).toBe(1);
    expect(daysUntil("2026-03-30", "2026-03-29")).toBe(1);
    expect(daysUntil("2026-11-02", "2026-11-01")).toBe(1);
  });

  test("returns null for unparseable or impossible dates", () => {
    expect(daysUntil("not-a-date", "2026-08-11")).toBeNull();
    expect(daysUntil("2026-02-31", "2026-08-11")).toBeNull();
    expect(daysUntil("2026-13-01", "2026-08-11")).toBeNull();
    expect(daysUntil("", "2026-08-11")).toBeNull();
  });
});

describe("toCalendarDate", () => {
  test("normalizes timestamps, dates, and Date objects to YYYY-MM-DD", () => {
    expect(toCalendarDate("2026-08-11")).toBe("2026-08-11");
    expect(toCalendarDate("2026-08-11T17:45:00.000Z")).toBe("2026-08-11");
    expect(toCalendarDate(new Date(Date.UTC(2026, 7, 11)))).toBe("2026-08-11");
  });

  test("returns null for empty and invalid values", () => {
    expect(toCalendarDate(null)).toBeNull();
    expect(toCalendarDate(undefined)).toBeNull();
    expect(toCalendarDate("")).toBeNull();
    expect(toCalendarDate("garbage")).toBeNull();
    expect(toCalendarDate(new Date("garbage"))).toBeNull();
  });
});

describe("resolveDueReminder", () => {
  test("fires on each rung of the ladder", () => {
    expect(resolveDueReminder("2026-08-14", "2026-08-11")?.key).toBe("t_minus_3");
    expect(resolveDueReminder("2026-08-12", "2026-08-11")?.key).toBe("t_minus_1");
    expect(resolveDueReminder("2026-08-11", "2026-08-11")?.key).toBe("due_today");
    expect(resolveDueReminder("2026-08-10", "2026-08-11")?.key).toBe("overdue_1");
    expect(resolveDueReminder("2026-08-04", "2026-08-11")?.key).toBe("overdue_7");
  });

  test("stays silent on days between rungs, so reminders never arrive daily", () => {
    expect(resolveDueReminder("2026-08-15", "2026-08-11")).toBeNull(); // 4 days out
    expect(resolveDueReminder("2026-08-13", "2026-08-11")).toBeNull(); // 2 days out
    expect(resolveDueReminder("2026-08-09", "2026-08-11")).toBeNull(); // 2 days overdue
    expect(resolveDueReminder("2026-07-11", "2026-08-11")).toBeNull(); // long overdue
  });

  test("resolves at most one offset per day", () => {
    const day = "2026-08-11";
    for (const offset of REMINDER_OFFSETS) {
      const target = new Date(Date.UTC(2026, 7, 11) + offset.daysBefore * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const matches = REMINDER_OFFSETS.filter(
        (candidate) => daysUntil(target, day) === candidate.daysBefore,
      );
      expect(matches).toHaveLength(1);
    }
  });

  test("returns null for an invalid target date instead of throwing", () => {
    expect(resolveDueReminder("2026-02-31", "2026-08-11")).toBeNull();
  });
});

describe("buildReminderCopy", () => {
  const offsetFor = (key: string) => {
    const offset = getReminderOffset(key);
    if (!offset) throw new Error(`missing offset ${key}`);
    return offset;
  };

  test("names the record and the date on an upcoming reminder", () => {
    const copy = buildReminderCopy({
      subjectType: "task",
      subjectLabel: "Ship Q3 pricing sheet",
      offset: offsetFor("t_minus_3"),
      targetDate: "2026-08-14",
    });
    expect(copy.title).toBe("Due in 3 days: Ship Q3 pricing sheet");
    expect(copy.body).toContain("Ship Q3 pricing sheet");
    expect(copy.body).toContain("14 Aug 2026");
  });

  test("reads differently when overdue and asks for a concrete next step", () => {
    const copy = buildReminderCopy({
      subjectType: "deal",
      subjectLabel: "Northstar Cloud Suite",
      offset: offsetFor("overdue_7"),
      targetDate: "2026-08-04",
    });
    expect(copy.title).toBe("Overdue: Northstar Cloud Suite");
    expect(copy.body).toContain("7 days overdue");
    expect(copy.body).toContain("Update the proposed completion date");
  });

  test("uses today wording on the day itself", () => {
    const copy = buildReminderCopy({
      subjectType: "task",
      subjectLabel: "Call Acme",
      offset: offsetFor("due_today"),
      targetDate: "2026-08-11",
    });
    expect(copy.title).toBe("Due today: Call Acme");
  });

  test("falls back to a readable label when the record has no title", () => {
    const copy = buildReminderCopy({
      subjectType: "task",
      subjectLabel: "   ",
      offset: offsetFor("due_today"),
      targetDate: "2026-08-11",
    });
    expect(copy.title).toBe("Due today: Untitled task");
  });
});

describe("formatReminderDate", () => {
  test("formats unambiguously rather than as a numeric locale date", () => {
    expect(formatReminderDate("2026-08-11")).toBe("11 Aug 2026");
  });

  test("passes through anything it can't parse", () => {
    expect(formatReminderDate("whenever")).toBe("whenever");
  });
});
