import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://localhost/test";
// The digest now has a morning and an evening mode, so every test has to
// state which one it is exercising — otherwise the suite's result depends on
// what time of day it happens to run. APP_TIMEZONE is pinned for the same
// reason: the mode, the greeting, and the "is this today?" windows are all
// resolved in the business timezone.
process.env.APP_TIMEZONE = "UTC";
const MORNING = new Date("2026-08-11T09:00:00.000Z");
const EVENING = new Date("2026-08-11T18:30:00.000Z");

type RolePermissionRow = {
  feature_key: string;
  can_create: boolean;
  can_read: boolean;
  can_update: boolean;
  can_delete: boolean;
};

// Real production restricted_distributor rows (db/schema.sql) — used
// verbatim rather than invented, so the "each section gates independently"
// test reflects an actual role/capability combination, not a fixture that
// happens to exercise the code path.
const RESTRICTED_DISTRIBUTOR_PERMISSIONS: RolePermissionRow[] = [
  { feature_key: "deals", can_create: false, can_read: true, can_update: true, can_delete: false },
  {
    feature_key: "partners",
    can_create: false,
    can_read: false,
    can_update: false,
    can_delete: false,
  },
  {
    feature_key: "customers",
    can_create: false,
    can_read: true,
    can_update: false,
    can_delete: false,
  },
  {
    feature_key: "catalog",
    can_create: false,
    can_read: false,
    can_update: false,
    can_delete: false,
  },
  {
    feature_key: "tickets",
    can_create: false,
    can_read: false,
    can_update: false,
    can_delete: false,
  },
  { feature_key: "tasks", can_create: false, can_read: true, can_update: true, can_delete: false },
  {
    feature_key: "learning",
    can_create: false,
    can_read: true,
    can_update: false,
    can_delete: false,
  },
  {
    feature_key: "rewards",
    can_create: false,
    can_read: false,
    can_update: false,
    can_delete: false,
  },
  {
    feature_key: "integrations",
    can_create: false,
    can_read: false,
    can_update: false,
    can_delete: false,
  },
  {
    feature_key: "users",
    can_create: false,
    can_read: false,
    can_update: false,
    can_delete: false,
  },
  { feature_key: "audit", can_create: false, can_read: true, can_update: false, can_delete: false },
  { feature_key: "news", can_create: false, can_read: false, can_update: false, can_delete: false },
  {
    feature_key: "assistant",
    can_create: false,
    can_read: true,
    can_update: false,
    can_delete: false,
  },
];

const FULL_ACCESS_PERMISSIONS: RolePermissionRow[] = [
  "deals",
  "partners",
  "customers",
  "catalog",
  "tickets",
  "tasks",
  "learning",
  "rewards",
  "integrations",
  "users",
  "audit",
  "news",
  "assistant",
  // Matches the real super_admin row in db/schema.sql — the evening briefing
  // reads call_logs, which is gated on this capability.
  "calls",
].map((feature_key) => ({
  feature_key,
  can_create: true,
  can_read: true,
  can_update: true,
  can_delete: true,
}));

function activeContextRow(overrides: Record<string, unknown> = {}) {
  return {
    context_id: "context-1",
    user_id: "user-1",
    assignment_id: "assignment-1",
    tenant_id: "tenant-livey-org",
    organization_tenant_id: "tenant-livey-org",
    working_scope: null,
    issued_at: "2026-07-30T00:00:00.000Z",
    expires_at: "2026-07-30T08:00:00.000Z",
    version: 1,
    revocation_link: null,
    context_revoked_at: null,
    context_revocation_reason: null,
    correlation_id: "corr-1",
    context_is_seed: true,
    context_created_at: "2026-07-30T00:00:00.000Z",
    context_updated_at: "2026-07-30T00:00:00.000Z",
    assignment_version: 1,
    assignment_status: "active",
    role_key: "super_admin",
    team_domain: "identity",
    geography_ceiling_node_id: "geo-global",
    partner_id: null,
    account_id: null,
    portfolio_id: null,
    queue_id: null,
    manager_assignment_id: null,
    source: "test",
    approver_user_id: null,
    predecessor_assignment_id: null,
    successor_assignment_id: null,
    valid_from: "2026-07-30T00:00:00.000Z",
    valid_to: null,
    revoked_at: null,
    revocation_reason: null,
    assignment_created_at: "2026-07-30T00:00:00.000Z",
    assignment_updated_at: "2026-07-30T00:00:00.000Z",
    assignment_is_seed: true,
    ...overrides,
  };
}

function installFakePool(input: {
  hasSession?: boolean;
  hasActiveContext?: boolean;
  roleKey?: string;
  rolePermissionRows?: RolePermissionRow[];
  newsRows?: Array<Record<string, unknown>>;
  taskRows?: Array<Record<string, unknown>>;
  ticketRows?: Array<Record<string, unknown>>;
  learningTrackRows?: Array<Record<string, unknown>>;
  learningEnrollmentRows?: Array<Record<string, unknown>>;
  notificationRows?: Array<Record<string, unknown>>;
  dealRows?: Array<Record<string, unknown>>;
  callLogRows?: Array<Record<string, unknown>>;
  pricingRows?: Array<Record<string, unknown>>;
}) {
  const hasSession = input.hasSession ?? true;
  const hasActiveContext = input.hasActiveContext ?? true;
  const roleKey = input.roleKey ?? "super_admin";
  const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
  const observed: Array<{ sql: string; params: unknown[] }> = [];

  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const originalQuery = pool.query.bind(pool);

    pool.query = (async (sql: string, params: unknown[] = []) => {
      const text = String(sql);
      observed.push({ sql: text, params });

      if (text.includes("FROM sessions s")) {
        if (!hasSession) return { rows: [], rowCount: 0 } as never;
        return {
          rows: [
            {
              token_hash: "hash",
              expires_at: futureExpiry,
              revoked_at: null,
              id: "user-1",
              email: "user@example.com",
              full_name: "Ananya Rao",
              phone: null,
              company_name: "Harbor Logistics",
            },
          ],
          rowCount: 1,
        } as never;
      }
      if (text.includes("FROM profiles WHERE id = $1")) {
        return {
          rows: [
            {
              id: "user-1",
              email: "user@example.com",
              password_hash: "x",
              full_name: "Ananya Rao",
              phone: null,
              company_name: "Harbor Logistics",
              avatar_url: null,
              partner_id: "partner-1",
              partner_status: "approved",
              must_reset_password: false,
            },
          ],
          rowCount: 1,
        } as never;
      }
      if (text.includes("FROM user_roles WHERE user_id = $1")) {
        return { rows: [{ role: roleKey }], rowCount: 1 } as never;
      }
      if (text.includes("FROM active_contexts ac")) {
        if (!hasActiveContext) return { rows: [], rowCount: 0 } as never;
        return { rows: [activeContextRow({ role_key: roleKey })], rowCount: 1 } as never;
      }
      if (text.includes("FROM role_permissions")) {
        const rows = input.rolePermissionRows ?? FULL_ACCESS_PERMISSIONS;
        return { rows, rowCount: rows.length } as never;
      }
      if (text.includes('FROM "portal_news_posts"')) {
        const rows = input.newsRows ?? [];
        return { rows, rowCount: rows.length } as never;
      }
      if (text.includes('FROM "tasks"')) {
        const rows = input.taskRows ?? [];
        return { rows, rowCount: rows.length } as never;
      }
      if (text.includes('FROM "support_tickets"')) {
        const rows = input.ticketRows ?? [];
        return { rows, rowCount: rows.length } as never;
      }
      if (text.includes('FROM "learning_tracks"')) {
        const rows = input.learningTrackRows ?? [];
        return { rows, rowCount: rows.length } as never;
      }
      if (text.includes('FROM "learning_enrollments"')) {
        const rows = input.learningEnrollmentRows ?? [];
        return { rows, rowCount: rows.length } as never;
      }
      if (text.includes('FROM "notifications"')) {
        const rows = input.notificationRows ?? [];
        return { rows, rowCount: rows.length } as never;
      }
      if (text.includes('FROM "portal_deals"')) {
        const rows = input.dealRows ?? [];
        return { rows, rowCount: rows.length } as never;
      }
      if (text.includes('FROM "call_logs"')) {
        const rows = input.callLogRows ?? [];
        return { rows, rowCount: rows.length } as never;
      }
      if (text.includes("FROM portal_deal_collaborators")) {
        return { rows: [], rowCount: 0 } as never;
      }
      if (text.includes("FROM pricing_revisions")) {
        const rows = input.pricingRows ?? [];
        return { rows, rowCount: rows.length } as never;
      }
      return { rows: [], rowCount: 0 } as never;
    }) as typeof pool.query;

    return {
      observed,
      restore: () => {
        pool.query = originalQuery as typeof pool.query;
      },
    };
  };
}

test("getUserDigest returns available:false when there is no session", async () => {
  const harness = await installFakePool({ hasSession: false })();
  try {
    const { getUserDigest } = await import("@/server/digest.server");
    const digest = await getUserDigest("any-token", { now: MORNING });
    expect(digest.available).toBe(false);
    expect(digest.news).toEqual([]);
    expect(digest.tasks).toEqual([]);
  } finally {
    harness.restore();
  }
});

test("getUserDigest returns available:false when there is no active governed context", async () => {
  const harness = await installFakePool({ hasActiveContext: false })();
  try {
    const { getUserDigest } = await import("@/server/digest.server");
    const digest = await getUserDigest("any-token", { now: MORNING });
    expect(digest.available).toBe(false);
  } finally {
    harness.restore();
  }
});

test("getUserDigest returns available:false when the role lacks assistant/read", async () => {
  const harness = await installFakePool({
    roleKey: "restricted_distributor",
    rolePermissionRows: RESTRICTED_DISTRIBUTOR_PERMISSIONS.map((row) =>
      row.feature_key === "assistant" ? { ...row, can_read: false } : row,
    ),
  })();
  try {
    const { getUserDigest } = await import("@/server/digest.server");
    const digest = await getUserDigest("any-token", { now: MORNING });
    expect(digest.available).toBe(false);
  } finally {
    harness.restore();
  }
});

test("getUserDigest gates each section independently by its own feature capability", async () => {
  const harness = await installFakePool({
    roleKey: "restricted_distributor",
    rolePermissionRows: RESTRICTED_DISTRIBUTOR_PERMISSIONS,
    newsRows: [
      {
        id: "news-1",
        title: "Should never appear",
        caption: "news read is false for this role",
        posted_by_name: "LIVEY",
        posted_by_role: "super_admin",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    ],
    ticketRows: [
      { id: "ticket-1", subject: "Should never appear", status: "open", priority: "high" },
    ],
    taskRows: [
      {
        id: "task-1",
        title: "Follow up",
        status: "open",
        priority: "medium",
        due_at: new Date().toISOString(),
      },
    ],
    learningTrackRows: [
      { id: "track-1", title: "Solution Selling", is_published: true, created_at: "2026-01-01" },
    ],
    learningEnrollmentRows: [{ track_id: "track-1", status: "in_progress", progress_percent: 40 }],
  })();
  try {
    const { getUserDigest } = await import("@/server/digest.server");
    const digest = await getUserDigest("any-token", { now: MORNING });

    expect(digest.available).toBe(true);
    // news/read=false and tickets/read=false for restricted_distributor —
    // both sections come back empty even though rows exist in the DB.
    expect(digest.news).toEqual([]);
    expect(digest.tickets).toEqual([]);
    // tasks/read=true and learning/read=true — these sections DO populate.
    expect(digest.tasks).toHaveLength(1);
    expect(digest.learning).toHaveLength(1);
  } finally {
    harness.restore();
  }
});

test("getUserDigest excludes done/canceled tasks and tasks not due soon, keeps open near-due tasks", async () => {
  // Anchored to MORNING, not Date.now(): the digest under test runs on the
  // pinned clock, so fixtures built from the real clock drift out of the
  // "due soon" horizon as real time passes and fail on a date change.
  const now = MORNING.getTime();
  const soon = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const farFuture = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  const overdue = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const harness = await installFakePool({
    taskRows: [
      {
        id: "task-open-soon",
        title: "Renew contract",
        status: "open",
        priority: "high",
        due_at: soon,
      },
      {
        id: "task-overdue",
        title: "Send proposal",
        status: "in_progress",
        priority: "high",
        due_at: overdue,
      },
      {
        id: "task-far-future",
        title: "Plan QBR",
        status: "open",
        priority: "low",
        due_at: farFuture,
      },
      { id: "task-done", title: "Already done", status: "done", priority: "low", due_at: soon },
      { id: "task-canceled", title: "Dropped", status: "canceled", priority: "low", due_at: soon },
    ],
  })();
  try {
    const { getUserDigest } = await import("@/server/digest.server");
    const digest = await getUserDigest("any-token", { now: MORNING });

    const ids = digest.tasks.map((t) => t.id).sort();
    expect(ids).toEqual(["task-open-soon", "task-overdue"]);
  } finally {
    harness.restore();
  }
});

test("getUserDigest narrative covers every populated section and skips the fabricated-fact risk of an LLM", async () => {
  const soon = new Date(MORNING.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const harness = await installFakePool({
    newsRows: [
      {
        id: "news-1",
        title: "Northstar Cloud Suite closed won",
        caption: "Big win for the APAC team",
        posted_by_name: "LIVEY",
        posted_by_role: "super_admin",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    ],
    taskRows: [
      { id: "task-1", title: "Follow up", status: "open", priority: "high", due_at: soon },
    ],
    // The fake pool doesn't execute the real WHERE clause — it stands in for
    // "the query already applied its filter," so this fixture represents
    // what a real status = ANY($1) filter would already have returned, not
    // the whole unfiltered table. The filter's own correctness (the right
    // status list is sent) is asserted separately below via `observed`.
    ticketRows: [{ id: "ticket-1", subject: "Password reset", status: "open", priority: "medium" }],
    learningTrackRows: [
      { id: "track-1", title: "Sales Fundamentals", is_published: true, created_at: "2026-01-01" },
      { id: "track-2", title: "Already finished", is_published: true, created_at: "2026-01-01" },
    ],
    learningEnrollmentRows: [
      { track_id: "track-1", status: "in_progress", progress_percent: 40 },
      { track_id: "track-2", status: "completed", progress_percent: 100 },
    ],
    notificationRows: [
      { id: "notif-1", read: false },
      { id: "notif-2", read: false },
    ],
    dealRows: [
      {
        id: "deal-1",
        stage: "negotiation",
        account_name: "Northstar Cloud Suite",
        product: "Cloud Suite",
        amount: "1500",
        currency_code: "USD",
        user_id: "user-1",
        partner_id: "partner-1",
        is_hidden_to_team: false,
        country: "United States",
        amount_usd: null,
        amount_value: null,
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    ],
    pricingRows: [{ deal_id: "deal-1", total_dtp_usd: 1500 }],
  })();
  try {
    const { getUserDigest } = await import("@/server/digest.server");
    const digest = await getUserDigest("any-token", { now: MORNING });

    expect(digest.available).toBe(true);
    expect(digest.pipeline).toEqual({ openDealCount: 1, pipelineValueUsd: 1500 });
    expect(digest.deals).toHaveLength(1);
    expect(digest.deals[0].accountName).toBe("Northstar Cloud Suite");
    expect(digest.tasks).toHaveLength(1);
    expect(digest.tickets).toHaveLength(1); // only the "open" one, not "resolved"
    expect(digest.learning).toHaveLength(1); // only the 40%-progress one
    expect(digest.unreadNotificationCount).toBe(2);

    expect(digest.narrative).toContain(
      "You have 1 open deal worth $1,500 in your pipeline — including Northstar Cloud Suite.",
    );
    expect(digest.narrative).toContain('1 task needs your attention soon: "Follow up".');
    expect(digest.narrative).toContain('You have 1 open support ticket: "Password reset".');
    expect(digest.narrative).toContain("2 unread notifications waiting for you.");
    expect(digest.narrative).toContain('You\'re partway through "Sales Fundamentals" (40%).');
    expect(digest.narrative).toContain('Latest from LIVEY: "Northstar Cloud Suite closed won".');
    // Every narrative always ends with a concrete next-step question —
    // tasks is the highest-priority non-empty section in this fixture.
    expect(digest.narrative).toContain("Want me to walk you through your tasks due soon?");

    // The mock can't apply a real WHERE clause, so the meaningful check here
    // is that the query itself asks for the right status list — excluding
    // resolved/closed/canceled — not that the mock happens to filter them.
    const ticketQuery = harness.observed.find((entry) =>
      entry.sql.includes('FROM "support_tickets"'),
    );
    expect(ticketQuery?.params).toEqual([
      ["open", "triaged", "waiting_on_partner", "waiting_on_livey", "reopened"],
    ]);
  } finally {
    harness.restore();
  }
});

test("getUserDigest narrative is a plain fallback sentence when every section is empty", async () => {
  const harness = await installFakePool({})();
  try {
    const { getUserDigest } = await import("@/server/digest.server");
    const digest = await getUserDigest("any-token", { now: MORNING });

    expect(digest.available).toBe(true);
    expect(digest.narrative).toContain("Nothing urgent needs your attention right now.");
    expect(digest.narrative).not.toContain("open deal");
    expect(digest.narrative).not.toContain("due soon");
    // Even with nothing to report, the narrative still ends by offering to
    // help — never just trails off after the fallback sentence.
    expect(digest.narrative).toContain(
      "Is there anything I can help you with — deals, tasks, tickets, or learning?",
    );
  } finally {
    harness.restore();
  }
});

// ---- Evening briefing -----------------------------------------------------

test("getUserDigest switches to evening mode at the cutoff hour, not before", async () => {
  const harness = await installFakePool({})();
  try {
    const { getUserDigest } = await import("@/server/digest.server");

    // 16:59 is still the forward-looking morning digest.
    const beforeCutoff = await getUserDigest("any-token", {
      now: new Date("2026-08-11T16:59:00.000Z"),
    });
    expect(beforeCutoff.mode).toBe("morning");

    // 17:00 flips it.
    const atCutoff = await getUserDigest("any-token", {
      now: new Date("2026-08-11T17:00:00.000Z"),
    });
    expect(atCutoff.mode).toBe("evening");
  } finally {
    harness.restore();
  }
});

test("evening briefing reports what was completed today across tasks, deals, tickets, and calls", async () => {
  const todayMorning = "2026-08-11T08:15:00.000Z";
  const yesterday = "2026-08-10T08:15:00.000Z";

  const harness = await installFakePool({
    taskRows: [
      {
        id: "task-done-today",
        title: "Ship Q3 pricing sheet",
        status: "completed",
        priority: "high",
        completed_at: todayMorning,
      },
      {
        id: "task-done-yesterday",
        title: "Old news",
        status: "completed",
        priority: "low",
        completed_at: yesterday,
      },
      {
        id: "task-cancelled-today",
        title: "Abandoned idea",
        status: "cancelled",
        priority: "low",
        cancelled_at: todayMorning,
      },
    ],
    dealRows: [
      {
        id: "deal-won",
        account_name: "Northstar Cloud Suite",
        stage: "won",
        status: "closed",
        amount: "$1,500",
        currency_code: "USD",
        created_at: yesterday,
        updated_at: todayMorning,
      },
      {
        id: "deal-untouched",
        account_name: "Dormant Corp",
        stage: "negotiation",
        status: "open",
        amount: "$900",
        currency_code: "USD",
        created_at: yesterday,
        updated_at: yesterday,
      },
    ],
    ticketRows: [
      {
        id: "ticket-closed",
        subject: "Login loop",
        status: "closed",
        priority: "high",
        updated_at: todayMorning,
      },
    ],
    callLogRows: [
      {
        id: "call-1",
        direction: "outbound",
        to_number: "+14155552671",
        from_number: "+14155550000",
        duration_seconds: 420,
        started_at: todayMorning,
      },
    ],
  })();

  try {
    const { getUserDigest } = await import("@/server/digest.server");
    const digest = await getUserDigest("any-token", { now: EVENING });

    expect(digest.mode).toBe("evening");
    const labels = digest.completedToday.map((entry) => entry.label);

    expect(labels).toContain('Completed "Ship Q3 pricing sheet"');
    expect(labels).toContain('Cancelled "Abandoned idea"');
    expect(labels).toContain('Closed "Northstar Cloud Suite" as won');
    expect(labels).toContain('Closed ticket "Login loop"');
    expect(labels).toContain("Made a call with +14155552671 (7 min)");

    // Yesterday's work must not leak into today's briefing.
    expect(labels.join(" ")).not.toContain("Old news");
    expect(labels.join(" ")).not.toContain("Dormant Corp");
  } finally {
    harness.restore();
  }
});

test("evening briefing lists what lands tomorrow, from proposed completion dates and hard dates", async () => {
  const harness = await installFakePool({
    taskRows: [
      {
        id: "task-tomorrow",
        title: "Call Acme",
        status: "to_do",
        priority: "high",
        proposed_completion_at: "2026-08-12T00:00:00.000Z",
      },
      {
        id: "task-day-after",
        title: "Not yet",
        status: "to_do",
        priority: "low",
        proposed_completion_at: "2026-08-13T00:00:00.000Z",
      },
      {
        // Closed work never appears in tomorrow's plan even if its date is
        // tomorrow.
        id: "task-done",
        title: "Already handled",
        status: "completed",
        priority: "low",
        proposed_completion_at: "2026-08-12T00:00:00.000Z",
      },
    ],
    dealRows: [
      {
        id: "deal-tomorrow",
        account_name: "Harbor Logistics",
        stage: "negotiation",
        status: "open",
        amount: "$4,000",
        currency_code: "USD",
        proposed_completion_date: "2026-08-12",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    ],
  })();

  try {
    const { getUserDigest } = await import("@/server/digest.server");
    const digest = await getUserDigest("any-token", { now: EVENING });

    const ids = digest.tomorrow.map((entry) => entry.id).sort();
    expect(ids).toEqual(["deal-tomorrow", "task-tomorrow"]);
    expect(digest.tomorrow.every((entry) => entry.reason === "proposed_completion")).toBe(true);
    expect(digest.narrative).toContain("2 items land tomorrow");
  } finally {
    harness.restore();
  }
});

test("evening briefing answers an empty day with sarcasm, stably within the day", async () => {
  const harness = await installFakePool({})();
  try {
    const { getUserDigest } = await import("@/server/digest.server");
    const { SARCASTIC_EMPTY_LINES } = await import("@/domain/contracts/digest");

    const first = await getUserDigest("any-token", { now: EVENING });
    const second = await getUserDigest("any-token", {
      now: new Date("2026-08-11T21:45:00.000Z"),
    });

    expect(first.completedToday).toEqual([]);
    const line = SARCASTIC_EMPTY_LINES.find((candidate) => first.narrative.includes(candidate));
    expect(line).toBeDefined();

    // Reopening the dialog later the same evening must not re-roll the joke.
    expect(second.narrative).toContain(line as string);
    expect(first.narrative).toContain("Nothing is scheduled to land tomorrow.");
  } finally {
    harness.restore();
  }
});

test("morning digest carries no evening sections, so the dialog never renders a stale day", async () => {
  const harness = await installFakePool({
    taskRows: [
      {
        id: "task-done-today",
        title: "Done thing",
        status: "completed",
        priority: "low",
        completed_at: "2026-08-11T08:00:00.000Z",
      },
    ],
  })();
  try {
    const { getUserDigest } = await import("@/server/digest.server");
    const digest = await getUserDigest("any-token", { now: MORNING });

    expect(digest.mode).toBe("morning");
    expect(digest.completedToday).toEqual([]);
    expect(digest.tomorrow).toEqual([]);
  } finally {
    harness.restore();
  }
});

test("tasks due soon excludes real completed/cancelled statuses, not just the legacy spellings", async () => {
  const soon = new Date(MORNING.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const harness = await installFakePool({
    taskRows: [
      { id: "open", title: "Live work", status: "to_do", priority: "high", due_at: soon },
      {
        id: "completed",
        title: "Finished",
        status: "completed",
        priority: "high",
        due_at: soon,
      },
      {
        id: "cancelled",
        title: "Dropped",
        status: "cancelled",
        priority: "high",
        due_at: soon,
      },
    ],
  })();
  try {
    const { getUserDigest } = await import("@/server/digest.server");
    const digest = await getUserDigest("any-token", { now: MORNING });
    expect(digest.tasks.map((task) => task.id)).toEqual(["open"]);
  } finally {
    harness.restore();
  }
});

test("a task with only a proposed completion date still counts as due soon", async () => {
  const soon = new Date(MORNING.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const harness = await installFakePool({
    taskRows: [
      {
        id: "proposed-only",
        title: "Forecast work",
        status: "to_do",
        priority: "medium",
        due_at: null,
        proposed_completion_at: soon,
      },
    ],
  })();
  try {
    const { getUserDigest } = await import("@/server/digest.server");
    const digest = await getUserDigest("any-token", { now: MORNING });
    expect(digest.tasks.map((task) => task.id)).toEqual(["proposed-only"]);
  } finally {
    harness.restore();
  }
});
