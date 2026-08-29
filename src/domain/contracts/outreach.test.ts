import { describe, expect, test } from "bun:test";

import {
  addDays,
  computeStepSchedule,
  isAllowedSequenceTransition,
  isWithinSendWindow,
  nextBusinessDay,
  normalizeOutreachEmail,
  renderOutreachTemplate,
  scheduledInstant,
  sequenceAutomationPercent,
  sequenceDurationDays,
  splitContactName,
  summarizeSequenceAnalytics,
  validateSequenceSteps,
  type SequenceStepDraft,
} from "./outreach";

function emailStep(overrides: Partial<SequenceStepDraft> = {}): SequenceStepDraft {
  return {
    stepType: "email",
    dayOffset: 0,
    subject: "Hello",
    body: "Body",
    taskTitle: "",
    taskPriority: "medium",
    ...overrides,
  };
}

function taskStep(overrides: Partial<SequenceStepDraft> = {}): SequenceStepDraft {
  return {
    stepType: "task",
    dayOffset: 0,
    subject: "",
    body: "",
    taskTitle: "Connect on LinkedIn",
    taskPriority: "medium",
    ...overrides,
  };
}

describe("renderOutreachTemplate", () => {
  test("substitutes known tokens", () => {
    const result = renderOutreachTemplate("Hi {{first_name}} at {{company}}", {
      first_name: "Devon",
      company: "Acme",
    });
    expect(result.text).toBe("Hi Devon at Acme");
    expect(result.missing).toEqual([]);
    expect(result.unknown).toEqual([]);
  });

  test("reports a token with no value and no fallback as missing", () => {
    const result = renderOutreachTemplate("Hi {{first_name}},", {});
    expect(result.missing).toEqual(["first_name"]);
    // The point of reporting it: this string must never be mailed.
    expect(result.text).toBe("Hi ,");
  });

  test("a fallback satisfies an empty token without reporting it missing", () => {
    const result = renderOutreachTemplate("Hi {{first_name|there}},", { first_name: "  " });
    expect(result.text).toBe("Hi there,");
    expect(result.missing).toEqual([]);
  });

  test("an unknown token is left verbatim and reported", () => {
    const result = renderOutreachTemplate("Hi {{nickname}}", { first_name: "Devon" });
    expect(result.text).toBe("Hi {{nickname}}");
    expect(result.unknown).toEqual(["nickname"]);
    expect(result.missing).toEqual([]);
  });

  test("tolerates whitespace inside the braces", () => {
    expect(renderOutreachTemplate("Hi {{ first_name }}", { first_name: "Devon" }).text).toBe(
      "Hi Devon",
    );
  });

  test("a repeated missing token is reported once", () => {
    const result = renderOutreachTemplate("{{company}} — {{company}}", {});
    expect(result.missing).toEqual(["company"]);
  });
});

describe("splitContactName", () => {
  test("a single word is a first name", () => {
    expect(splitContactName("Devon")).toEqual({ firstName: "Devon", lastName: "" });
  });

  test("everything after the first space is the surname", () => {
    expect(splitContactName("Devon Kumar Sharma")).toEqual({
      firstName: "Devon",
      lastName: "Kumar Sharma",
    });
  });

  test("blank input yields blank parts rather than throwing", () => {
    expect(splitContactName("   ")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("business-day scheduling", () => {
  // 2026-08-29 is a Saturday, 2026-08-30 a Sunday, 2026-08-31 a Monday.
  test("nextBusinessDay rolls a weekend forward and leaves a weekday alone", () => {
    expect(nextBusinessDay("2026-08-29")).toBe("2026-08-31");
    expect(nextBusinessDay("2026-08-30")).toBe("2026-08-31");
    expect(nextBusinessDay("2026-08-31")).toBe("2026-08-31");
  });

  test("calendar-day offsets can land on a weekend", () => {
    expect(addDays("2026-08-27", 2, false)).toBe("2026-08-29");
  });

  test("business-day offsets skip the weekend", () => {
    // Thursday + 2 business days = Monday, not Saturday.
    expect(addDays("2026-08-27", 2, true)).toBe("2026-08-31");
  });

  test("a business-day sequence enrolled on a Saturday starts on Monday", () => {
    expect(addDays("2026-08-29", 0, true)).toBe("2026-08-31");
  });

  test("computeStepSchedule materialises every step from one start date", () => {
    const schedule = computeStepSchedule({
      startDate: "2026-08-27",
      steps: [
        { stepIndex: 0, dayOffset: 0 },
        { stepIndex: 1, dayOffset: 0 },
        { stepIndex: 2, dayOffset: 2 },
        { stepIndex: 3, dayOffset: 4 },
      ],
      businessDaysOnly: true,
    });
    expect(schedule.map((entry) => entry.scheduledDate)).toEqual([
      "2026-08-27",
      "2026-08-27",
      "2026-08-31",
      "2026-09-02",
    ]);
  });

  test("scheduledInstant anchors at the start of the send window, not midnight", () => {
    expect(scheduledInstant("2026-08-27")).toBe("2026-08-27T08:00:00.000Z");
  });

  test("scheduledInstant shifts by the business zone's offset", () => {
    // IST is UTC+5:30, so 08:00 local is 02:30 UTC.
    expect(scheduledInstant("2026-08-27", 330)).toBe("2026-08-27T02:30:00.000Z");
  });

  test("send window excludes the small hours and the evening", () => {
    expect(isWithinSendWindow(7)).toBe(false);
    expect(isWithinSendWindow(8)).toBe(true);
    expect(isWithinSendWindow(18)).toBe(true);
    expect(isWithinSendWindow(19)).toBe(false);
  });
});

describe("validateSequenceSteps", () => {
  test("accepts a well-formed cadence", () => {
    expect(
      validateSequenceSteps([
        emailStep({ dayOffset: 0 }),
        taskStep({ dayOffset: 0 }),
        emailStep({ dayOffset: 2 }),
      ]),
    ).toBeNull();
  });

  test("rejects an empty sequence", () => {
    expect(validateSequenceSteps([])).toEqual({
      index: null,
      message: "A sequence needs at least one step",
    });
  });

  test("rejects a step scheduled before the one above it", () => {
    const failure = validateSequenceSteps([
      emailStep({ dayOffset: 3 }),
      emailStep({ dayOffset: 1 }),
    ]);
    expect(failure?.index).toBe(1);
  });

  test("equal day offsets are allowed — same-day steps are the point", () => {
    expect(
      validateSequenceSteps([emailStep({ dayOffset: 1 }), taskStep({ dayOffset: 1 })]),
    ).toBeNull();
  });

  test("rejects an email step with no subject", () => {
    expect(validateSequenceSteps([emailStep({ subject: "  " })])?.index).toBe(0);
  });

  test("rejects a task step with no title", () => {
    expect(validateSequenceSteps([taskStep({ taskTitle: "" })])?.index).toBe(0);
  });

  test("rejects an unknown token before it can ever be sent", () => {
    const failure = validateSequenceSteps([emailStep({ body: "Hi {{nickname}}" })]);
    expect(failure?.message).toContain("nickname");
  });

  test("rejects a negative or fractional day offset", () => {
    expect(validateSequenceSteps([emailStep({ dayOffset: -1 })])?.index).toBe(0);
    expect(validateSequenceSteps([emailStep({ dayOffset: 1.5 })])?.index).toBe(0);
  });
});

describe("sequence summaries", () => {
  test("duration is the last step's offset", () => {
    expect(sequenceDurationDays([{ dayOffset: 0 }, { dayOffset: 4 }])).toBe(4);
    expect(sequenceDurationDays([])).toBe(0);
  });

  test("automation percent counts email steps", () => {
    expect(
      sequenceAutomationPercent([
        { stepType: "email" },
        { stepType: "task" },
        { stepType: "task" },
      ]),
    ).toBe(33);
    expect(sequenceAutomationPercent([])).toBe(0);
  });
});

describe("summarizeSequenceAnalytics", () => {
  test("open rate is per send, reply and meeting rates are per enrolled contact", () => {
    const analytics = summarizeSequenceAnalytics({
      enrolled: 10,
      active: 4,
      finished: 3,
      unenrolled: 3,
      emailsSent: 20,
      emailsOpened: 9,
      emailsFailed: 1,
      unenrollReasonKeys: ["replied", "meeting_booked", "opted_out"],
    });
    expect(analytics.replies).toBe(2);
    expect(analytics.meetings).toBe(1);
    expect(analytics.openRate).toBe(45);
    expect(analytics.replyRate).toBe(20);
    expect(analytics.meetingRate).toBe(10);
  });

  test("rates are zero rather than NaN when nothing has happened yet", () => {
    const analytics = summarizeSequenceAnalytics({
      enrolled: 0,
      active: 0,
      finished: 0,
      unenrolled: 0,
      emailsSent: 0,
      emailsOpened: 0,
      emailsFailed: 0,
      unenrollReasonKeys: [],
    });
    expect(analytics.openRate).toBe(0);
    expect(analytics.replyRate).toBe(0);
    expect(analytics.meetingRate).toBe(0);
  });

  test("an unrecognised reason key is ignored, not counted as a reply", () => {
    const analytics = summarizeSequenceAnalytics({
      enrolled: 1,
      active: 0,
      finished: 0,
      unenrolled: 1,
      emailsSent: 1,
      emailsOpened: 0,
      emailsFailed: 0,
      unenrollReasonKeys: ["who_knows"],
    });
    expect(analytics.replies).toBe(0);
  });
});

describe("sequence status transitions", () => {
  test("a draft can go live and an active one can be paused back to draft", () => {
    expect(isAllowedSequenceTransition("draft", "active")).toBe(true);
    expect(isAllowedSequenceTransition("active", "draft")).toBe(true);
  });

  test("an archived sequence cannot go straight back to active", () => {
    expect(isAllowedSequenceTransition("archived", "active")).toBe(false);
    expect(isAllowedSequenceTransition("archived", "draft")).toBe(true);
  });
});

describe("normalizeOutreachEmail", () => {
  test("lower-cases and trims", () => {
    expect(normalizeOutreachEmail("  Devon@Acme.COM ")).toBe("devon@acme.com");
  });

  test("keeps dots and plus tags — they address different mailboxes at most providers", () => {
    expect(normalizeOutreachEmail("de.von+crm@acme.com")).toBe("de.von+crm@acme.com");
  });
});
