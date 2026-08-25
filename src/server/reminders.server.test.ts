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

// ---------------------------------------------------------------------------
// Distribution approval escalation (product.md §24.5.2)
// ---------------------------------------------------------------------------

type EscalationRow = {
  task_id: string;
  request_id: string;
  human_id: string;
  priority: string;
  manager_assignment_id: string;
  manager_user_id: string | null;
  escalation_assignment_id: string | null;
  escalation_user_id: string | null;
};

function installEscalationPool(
  overdue: EscalationRow[],
  options: { fallbackSetting?: string | null; fallbackSuperAdmin?: string | null } = {},
) {
  const tasks: Array<Record<string, unknown>> = [];
  const notifications: Array<Record<string, unknown>> = [];

  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const originalQuery = pool.query.bind(pool);
    const originalConnect = pool.connect.bind(pool);

    const handle = async (sql: string, params: unknown[] = []) => {
      const text = String(sql).trim().replace(/\s+/g, " ");
      if (text.startsWith("SELECT t.id AS task_id")) {
        return { rows: overdue, rowCount: overdue.length };
      }
      if (text.includes("FROM app_settings")) {
        return options.fallbackSetting
          ? { rows: [{ value: options.fallbackSetting }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (text.startsWith("SELECT id FROM profiles")) {
        return { rows: [{ id: params[0] }], rowCount: 1 };
      }
      if (text.includes("FROM user_roles ur")) {
        return options.fallbackSuperAdmin
          ? { rows: [{ user_id: options.fallbackSuperAdmin }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (text.startsWith("INSERT INTO tasks")) {
        const automationKey = params[12] as string;
        if (tasks.some((task) => task.automation_key === automationKey)) {
          return { rows: [], rowCount: 0 };
        }
        tasks.push({
          id: params[0],
          title: params[1],
          description: params[2],
          assignee_id: params[6],
          creator_id: params[7],
          related_id: params[5],
          automation_key: automationKey,
        });
        return { rows: [{ id: params[0] }], rowCount: 1 };
      }
      if (text.startsWith("SELECT id, status, version, title FROM tasks")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.startsWith("INSERT INTO notifications")) {
        const userId = params[1] as string | null;
        const eventKey = params[9] as string;
        if (notifications.some((row) => row.user_id === userId && row.event_key === eventKey)) {
          return { rows: [], rowCount: 0 };
        }
        notifications.push({
          id: params[0],
          user_id: userId,
          title: params[3],
          message: params[4],
          action_url: params[8],
          event_key: eventKey,
        });
        return { rows: [{ id: params[0] }], rowCount: 1 };
      }
      const upper = text.toUpperCase();
      if (upper === "BEGIN" || upper === "COMMIT" || upper === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unhandled escalation statement: ${text}`);
    };

    pool.query = handle as unknown as typeof pool.query;
    pool.connect = (async () => ({
      query: handle,
      release: () => undefined,
    })) as unknown as typeof pool.connect;

    return {
      tasks,
      notifications,
      restore: () => {
        pool.query = originalQuery as typeof pool.query;
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

const OVERDUE: EscalationRow = {
  task_id: "task-1",
  request_id: "request-1",
  human_id: "DMS-000001",
  priority: "high",
  manager_assignment_id: "assignment-manager",
  manager_user_id: "manager-user",
  escalation_assignment_id: "assignment-director",
  escalation_user_id: "director-user",
};

test("DMS-021: an overdue approval escalates once, to the manager's own manager", async () => {
  const harness = await installEscalationPool([OVERDUE])();
  try {
    const { runDistributionEscalationSweep } = await import("@/server/reminders.server");
    const first = await runDistributionEscalationSweep();
    expect(first.overdue).toBe(1);
    expect(first.escalated).toBe(1);
    expect(first.toFallback).toBe(0);

    expect(harness.tasks).toHaveLength(1);
    expect(harness.tasks[0]?.automation_key).toBe(
      "stock-request:request-1:approval-escalation:assignment-director",
    );
    expect(harness.tasks[0]?.assignee_id).toBe("director-user");

    // The manager is told, and so is the escalation recipient — two distinct
    // recipients, two distinct event keys.
    const recipients = harness.notifications.map((row) => row.user_id).sort();
    expect(recipients).toEqual(["director-user", "manager-user"]);
    expect(String(harness.notifications[0]?.action_url)).toContain("request-1");

    // A second sweep over the same overdue approval creates nothing and
    // re-notifies nobody.
    const second = await runDistributionEscalationSweep();
    expect(second.escalated).toBe(1);
    expect(harness.tasks).toHaveLength(1);
    expect(harness.notifications).toHaveLength(2);
  } finally {
    harness.restore();
  }
});

test("DMS-021: with no ancestor assignment the escalation routes to the Super Admin fallback and says why", async () => {
  const harness = await installEscalationPool(
    [{ ...OVERDUE, escalation_assignment_id: null, escalation_user_id: null }],
    { fallbackSuperAdmin: "admin-user" },
  )();
  try {
    const { runDistributionEscalationSweep } = await import("@/server/reminders.server");
    const summary = await runDistributionEscalationSweep();
    expect(summary.escalated).toBe(1);
    expect(summary.toFallback).toBe(1);

    expect(harness.tasks[0]?.automation_key).toBe(
      "stock-request:request-1:approval-escalation:super-admin-fallback",
    );
    expect(harness.tasks[0]?.assignee_id).toBe("admin-user");
    expect(String(harness.tasks[0]?.description)).toContain("Super Admin fallback");
  } finally {
    harness.restore();
  }
});

test("DMS-021: a configured fallback user wins over the longest-standing Super Admin", async () => {
  const harness = await installEscalationPool(
    [{ ...OVERDUE, escalation_assignment_id: null, escalation_user_id: null }],
    { fallbackSetting: "configured-user", fallbackSuperAdmin: "admin-user" },
  )();
  try {
    const { runDistributionEscalationSweep } = await import("@/server/reminders.server");
    await runDistributionEscalationSweep();
    expect(harness.tasks[0]?.assignee_id).toBe("configured-user");
  } finally {
    harness.restore();
  }
});

test("DMS-021: an unroutable escalation is counted, never silently dropped", async () => {
  const harness = await installEscalationPool(
    [{ ...OVERDUE, escalation_assignment_id: null, escalation_user_id: null }],
    { fallbackSuperAdmin: null },
  )();
  try {
    const { runDistributionEscalationSweep } = await import("@/server/reminders.server");
    const summary = await runDistributionEscalationSweep();
    expect(summary.unroutable).toBe(1);
    expect(summary.escalated).toBe(0);
    expect(harness.tasks).toHaveLength(0);
  } finally {
    harness.restore();
  }
});

test("an empty overdue set does no work at all", async () => {
  const harness = await installEscalationPool([])();
  try {
    const { runDistributionEscalationSweep } = await import("@/server/reminders.server");
    const summary = await runDistributionEscalationSweep();
    expect(summary).toMatchObject({ overdue: 0, escalated: 0, toFallback: 0, unroutable: 0 });
    expect(harness.tasks).toHaveLength(0);
    expect(harness.notifications).toHaveLength(0);
  } finally {
    harness.restore();
  }
});
