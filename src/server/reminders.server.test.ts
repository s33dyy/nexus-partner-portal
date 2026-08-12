import { describe, expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://localhost/test";

import { businessToday, describeSweep } from "@/server/reminders.server";

describe("businessToday", () => {
  // The whole reason this helper exists: a container running in UTC would
  // otherwise flip "today" at 5:30am India time, so a "due today" reminder
  // would land on the wrong calendar day for the people receiving it.
  test("resolves the calendar day in the configured business timezone", () => {
    // 2026-08-11T20:00Z is already 2026-08-12 in Kolkata (+05:30).
    const instant = new Date("2026-08-11T20:00:00.000Z");
    expect(businessToday(instant, "UTC")).toBe("2026-08-11");
    expect(businessToday(instant, "Asia/Kolkata")).toBe("2026-08-12");
  });

  test("resolves a day behind UTC for western timezones", () => {
    // 2026-08-11T02:00Z is still 2026-08-10 in Los Angeles (-07:00).
    const instant = new Date("2026-08-11T02:00:00.000Z");
    expect(businessToday(instant, "America/Los_Angeles")).toBe("2026-08-10");
  });

  test("falls back to UTC rather than throwing on an invalid timezone", () => {
    const instant = new Date("2026-08-11T12:00:00.000Z");
    expect(businessToday(instant, "Not/AZone")).toBe("2026-08-11");
  });

  test("always returns a YYYY-MM-DD calendar date", () => {
    expect(businessToday(new Date("2026-01-05T00:00:00.000Z"), "UTC")).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});

describe("describeSweep", () => {
  test("reports every channel so a quiet sweep is distinguishable from a broken one", () => {
    const line = describeSweep({
      ranAt: "2026-08-11T09:00:00.000Z",
      today: "2026-08-11",
      candidates: 12,
      due: 3,
      claimed: 9,
      delivered: { in_app: 3, whatsapp: 2, email: 0 },
      skipped: 4,
      failed: 0,
    });
    expect(line).toContain("2026-08-11");
    expect(line).toContain("12 candidates");
    expect(line).toContain("3 due");
    expect(line).toContain("in_app=3");
    expect(line).toContain("whatsapp=2");
    expect(line).toContain("email=0");
    expect(line).toContain("skipped=4");
    expect(line).toContain("failed=0");
  });
});
