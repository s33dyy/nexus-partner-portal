import {
  type AssistantDealSummary,
  type AssistantLearningSummary,
  type AssistantNewsSummary,
  type AssistantTaskSummary,
  type AssistantTicketSummary,
} from "@/domain/contracts/assistant";
import {
  DIGEST_EVENING_HOUR,
  EMPTY_USER_DIGEST,
  pickSarcasticLine,
  type DigestActivityEntry,
  type DigestMode,
  type DigestUpcomingEntry,
  type UserDigest,
} from "@/domain/contracts/digest";
import { toCalendarDate } from "@/domain/contracts/reminders";
import { isOpenPipelineStage } from "@/lib/pipeline-metrics";
import {
  shiftCalendarDate,
  zonedCalendarDate,
  zonedDayRange,
  zonedHour,
} from "@/server/app-time.server";
import { loadDashboardPipelineMetrics } from "@/server/dashboard-metrics.server";
import { getAuthContext, queryTableWithAuthContext } from "@/server/livey-service.server";
import { fetchNewsPostsForViewer } from "@/server/news-audience.server";
import {
  hasCapability,
  loadRoleCapabilities,
  type FeatureCapabilities,
} from "@/server/rbac-policy.server";
import type { TablePolicyAuthContext } from "@/server/table-policy.server";

// Every section below takes the SAME pre-built TablePolicyAuthContext and
// calls queryTableWithAuthContext() directly, never the top-level
// queryTable() the chat Assistant's fetchScoped* functions use — queryTable()
// resolves getAuthContext() fresh internally (multiple uncached DB round
// trips), which is fine for a chat turn that fetches one entity, but would
// mean 5-6 hidden re-resolutions on the one page load where latency matters
// most. getUserDigest() resolves auth exactly once and fans it out.

const TASK_DUE_SOON_DAYS = 3;
// The real statuses are "completed"/"cancelled" (see TASK_STATUSES in
// task-commands.server.ts). This set previously held "done"/"canceled",
// neither of which a task row can ever hold, so the "tasks due soon" section
// silently included finished and cancelled work. The two legacy spellings
// are kept so any pre-Phase-2 seed row still filters correctly.
const CLOSED_TASK_STATUSES = new Set(["completed", "cancelled", "done", "canceled"]);
const CLOSED_TICKET_STATUSES = ["closed"];
const OPEN_TICKET_STATUSES = [
  "open",
  "triaged",
  "waiting_on_partner",
  "waiting_on_livey",
  "reopened",
];

async function fetchNewsSection(
  auth: TablePolicyAuthContext,
  capabilities: FeatureCapabilities,
): Promise<AssistantNewsSummary[]> {
  if (!hasCapability(capabilities, "news", "read")) return [];
  // Audience-aware: the briefing must not surface a post the reader is not in
  // the audience for. See server/news-audience.server.ts.
  const rows = await fetchNewsPostsForViewer(auth);
  return rows.slice(0, 3).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    title: String(row.title ?? ""),
    caption: String(row.caption ?? ""),
    postedByName: String(row.posted_by_name ?? ""),
    postedByRole: String(row.posted_by_role ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

async function fetchPipelineSection(
  auth: TablePolicyAuthContext,
  capabilities: FeatureCapabilities,
): Promise<{ openDealCount: number; pipelineValueUsd: number } | null> {
  if (!hasCapability(capabilities, "deals", "read")) return null;
  const result = await loadDashboardPipelineMetrics({ auth, selectedRegion: "all" });
  if (!result.ok) return null;
  return {
    openDealCount: result.metrics.openDealCount,
    pipelineValueUsd: result.metrics.pipelineValueUsd,
  };
}

type Row = Record<string, unknown>;

// Deals and tasks are each fetched ONCE and then sliced several different
// ways (open pipeline, due soon, finished today, landing tomorrow). Before
// the evening sections existed each of those was its own round trip; now
// that there are four of them per entity, re-querying would have meant eight
// scoped reads on the one page load where latency matters most.
async function fetchScopedDeals(
  auth: TablePolicyAuthContext,
  capabilities: FeatureCapabilities,
): Promise<Row[]> {
  if (!hasCapability(capabilities, "deals", "read")) return [];
  const { data, error } = await queryTableWithAuthContext(
    {
      table: "portal_deals",
      operation: "select",
      filters: [],
      order: { column: "updated_at", ascending: false },
    },
    auth,
  );
  return error || !Array.isArray(data) ? [] : (data as Row[]);
}

async function fetchScopedTasks(
  auth: TablePolicyAuthContext,
  capabilities: FeatureCapabilities,
): Promise<Row[]> {
  if (!hasCapability(capabilities, "tasks", "read")) return [];
  const { data, error } = await queryTableWithAuthContext(
    {
      table: "tasks",
      operation: "select",
      filters: [],
      order: { column: "due_at", ascending: true },
    },
    auth,
  );
  return error || !Array.isArray(data) ? [] : (data as Row[]);
}

// A few real open deals, alongside fetchPipelineSection's exact aggregate —
// this is what lets the narrative name actual accounts instead of only
// counting them. Reuses isOpenPipelineStage (the same predicate
// loadDashboardPipelineMetrics itself uses via summarizeOpenPipeline) so
// this list can never disagree with the aggregate on what counts as "open."
// No query-level stage filter exists for "not won/lost" (QueryFilter only
// supports eq/in), so — same as selectTasksDueSoon below — the filtering
// happens in JS, matching the existing pattern in this file.
function selectTopOpenDeals(deals: Row[]): AssistantDealSummary[] {
  return deals
    .filter((row) => isOpenPipelineStage(String(row.stage ?? "")))
    .slice(0, 3)
    .map((row) => ({
      id: String(row.id),
      accountName: String(row.account_name ?? ""),
      product: String(row.product ?? ""),
      stage: String(row.stage ?? ""),
      status: String(row.status ?? ""),
      amount: String(row.amount ?? ""),
      currencyCode: String(row.currency_code ?? "USD"),
      updatedAt: String(row.updated_at ?? ""),
    }));
}

function selectTasksDueSoon(tasks: Row[], now: Date): AssistantTaskSummary[] {
  // No date-range query operator exists (QueryFilter.operator is "eq" | "in"
  // only) — "due soon" genuinely has to be filtered in JS after fetching.
  const horizon = now.getTime() + TASK_DUE_SOON_DAYS * 24 * 60 * 60 * 1000;
  return tasks
    .filter((row) => {
      if (CLOSED_TASK_STATUSES.has(String(row.status ?? ""))) return false;
      // A proposed completion date counts as "coming up" the same way a hard
      // due date does — it's the owner's own forecast, and the whole point
      // of asking for one is that it's the date they'll be measured on.
      const candidate = row.due_at ?? row.proposed_completion_at;
      if (!candidate) return false;
      const dueMs = new Date(String(candidate)).getTime();
      return Number.isFinite(dueMs) && dueMs <= horizon;
    })
    .slice(0, 20)
    .map((row) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      status: String(row.status ?? ""),
      priority: String(row.priority ?? ""),
      dueAt: row.due_at ? String(row.due_at) : null,
    }));
}

// ---- Evening sections -----------------------------------------------------
//
// "What did I get done today" is built entirely from the caller's own
// already-policy-scoped records — a task whose completed_at landed today, a
// deal that reached won/lost today, a call they handled. It deliberately does
// NOT read domain_activity_events, which would be the obvious source: that
// table spans every subject type with no single owning column, and
// table-policy.server.ts consequently restricts it to super_admin. Widening
// it to build a digest would have meant inventing a per-subject read scope
// for every subject type it covers — a much larger change than this feature
// justifies, and exactly the kind of policy-layer shortcut the Phase 1 audit
// flagged.
//
// The cost of that choice is that a mid-pipeline stage advance doesn't appear
// as its own line (portal_deals records the current stage, not when it last
// changed) — such deals surface as "Worked on <account>" via updated_at
// instead of a specific "moved to Negotiation", which is honest about what
// the row actually proves.

type DayWindow = { startUtc: Date; endUtc: Date };

function fallsWithin(value: unknown, window: DayWindow | null): boolean {
  if (!value || !window) return false;
  const ms = new Date(String(value)).getTime();
  return Number.isFinite(ms) && ms >= window.startUtc.getTime() && ms < window.endUtc.getTime();
}

function selectCompletedTasksToday(tasks: Row[], today: DayWindow | null): DigestActivityEntry[] {
  const entries: DigestActivityEntry[] = [];
  for (const row of tasks) {
    const title = String(row.title ?? "Untitled task");
    if (fallsWithin(row.completed_at, today)) {
      entries.push({
        id: `task-done-${String(row.id)}`,
        kind: "task",
        label: `Completed "${title}"`,
        occurredAt: String(row.completed_at),
      });
    } else if (fallsWithin(row.cancelled_at, today)) {
      entries.push({
        id: `task-cancelled-${String(row.id)}`,
        kind: "task",
        label: `Cancelled "${title}"`,
        occurredAt: String(row.cancelled_at),
      });
    }
  }
  return entries;
}

function selectDealActivityToday(deals: Row[], today: DayWindow | null): DigestActivityEntry[] {
  const entries: DigestActivityEntry[] = [];
  for (const row of deals) {
    const account = String(row.account_name ?? "an account");
    const stage = String(row.stage ?? "");
    const createdToday = fallsWithin(row.created_at, today);
    const touchedToday = fallsWithin(row.updated_at, today);
    if (!createdToday && !touchedToday) continue;

    if (createdToday) {
      entries.push({
        id: `deal-created-${String(row.id)}`,
        kind: "deal",
        label: `Registered deal "${account}"`,
        occurredAt: String(row.created_at),
      });
      continue;
    }
    if (stage === "won" || stage === "lost") {
      entries.push({
        id: `deal-${stage}-${String(row.id)}`,
        kind: "deal",
        label: `Closed "${account}" as ${stage}`,
        occurredAt: String(row.updated_at),
      });
      continue;
    }
    entries.push({
      id: `deal-touched-${String(row.id)}`,
      kind: "deal",
      label: `Worked on "${account}"${stage ? ` (now at ${stage.replace(/_/g, " ")})` : ""}`,
      occurredAt: String(row.updated_at),
    });
  }
  return entries;
}

async function fetchClosedTicketsToday(
  auth: TablePolicyAuthContext,
  capabilities: FeatureCapabilities,
  today: DayWindow | null,
): Promise<DigestActivityEntry[]> {
  if (!hasCapability(capabilities, "tickets", "read")) return [];
  const { data, error } = await queryTableWithAuthContext(
    {
      table: "support_tickets",
      operation: "select",
      filters: [{ column: "status", value: CLOSED_TICKET_STATUSES, operator: "in" }],
    },
    auth,
  );
  if (error || !Array.isArray(data)) return [];
  return (data as Row[])
    .filter((row) => fallsWithin(row.updated_at, today))
    .map((row) => ({
      id: `ticket-closed-${String(row.id)}`,
      kind: "ticket" as const,
      label: `Closed ticket "${String(row.subject ?? "Untitled")}"`,
      occurredAt: String(row.updated_at),
    }));
}

async function fetchCallsToday(
  auth: TablePolicyAuthContext,
  capabilities: FeatureCapabilities,
  today: DayWindow | null,
): Promise<DigestActivityEntry[]> {
  if (!hasCapability(capabilities, "calls", "read")) return [];
  const { data, error } = await queryTableWithAuthContext(
    { table: "call_logs", operation: "select", filters: [] },
    auth,
  );
  if (error || !Array.isArray(data)) return [];
  return (data as Row[])
    .filter((row) => fallsWithin(row.started_at ?? row.created_at, today))
    .map((row) => {
      const direction = String(row.direction ?? "") === "inbound" ? "Took" : "Made";
      const counterpart = String(
        (String(row.direction ?? "") === "inbound" ? row.from_number : row.to_number) ?? "",
      );
      const seconds = Number(row.duration_seconds ?? 0);
      const duration =
        Number.isFinite(seconds) && seconds > 0 ? ` (${Math.round(seconds / 60)} min)` : "";
      return {
        id: `call-${String(row.id)}`,
        kind: "call" as const,
        label: `${direction} a call${counterpart ? ` with ${counterpart}` : ""}${duration}`,
        occurredAt: String(row.started_at ?? row.created_at ?? ""),
      };
    });
}

function selectTomorrow(tasks: Row[], deals: Row[], tomorrow: string): DigestUpcomingEntry[] {
  const entries: DigestUpcomingEntry[] = [];

  for (const row of tasks) {
    if (CLOSED_TASK_STATUSES.has(String(row.status ?? ""))) continue;
    const proposed = calendarDateOf(row.proposed_completion_at);
    const due = calendarDateOf(row.due_at);
    // A task with both dates on tomorrow appears once, attributed to the
    // owner's own forecast rather than the imposed deadline.
    if (proposed === tomorrow || due === tomorrow) {
      entries.push({
        id: String(row.id),
        kind: "task",
        title: String(row.title ?? "Untitled task"),
        reason: proposed === tomorrow ? "proposed_completion" : "due",
      });
    }
  }

  for (const row of deals) {
    if (!isOpenPipelineStage(String(row.stage ?? ""))) continue;
    const proposed = calendarDateOf(row.proposed_completion_date);
    const close = calendarDateOf(row.close_date);
    if (proposed === tomorrow || close === tomorrow) {
      entries.push({
        id: String(row.id),
        kind: "deal",
        title: String(row.account_name ?? "Untitled deal"),
        reason: proposed === tomorrow ? "proposed_completion" : "due",
      });
    }
  }

  return entries.slice(0, 20);
}

// Uses the reminder contract's own normalizer rather than a second
// implementation, so "is this landing tomorrow?" in the briefing and "is a
// reminder owed?" in the sweep can never disagree about which calendar day a
// stored value belongs to.
function calendarDateOf(value: unknown): string | null {
  if (value instanceof Date) return toCalendarDate(value);
  if (typeof value === "string") return toCalendarDate(value);
  return null;
}

async function fetchOpenTicketsSection(
  auth: TablePolicyAuthContext,
  capabilities: FeatureCapabilities,
): Promise<AssistantTicketSummary[]> {
  if (!hasCapability(capabilities, "tickets", "read")) return [];
  const { data, error } = await queryTableWithAuthContext(
    {
      table: "support_tickets",
      operation: "select",
      filters: [{ column: "status", value: OPEN_TICKET_STATUSES, operator: "in" }],
    },
    auth,
  );
  if (error || !Array.isArray(data)) return [];
  return data.slice(0, 20).map((row: Record<string, unknown>) => ({
    id: String(row.id),
    subject: String(row.subject ?? ""),
    status: String(row.status ?? ""),
    priority: String(row.priority ?? ""),
  }));
}

async function fetchLearningInProgressSection(
  auth: TablePolicyAuthContext,
  capabilities: FeatureCapabilities,
  userId: string,
): Promise<AssistantLearningSummary[]> {
  if (!hasCapability(capabilities, "learning", "read")) return [];
  const { data: trackData, error: trackError } = await queryTableWithAuthContext(
    {
      table: "learning_tracks",
      operation: "select",
      filters: [{ column: "is_published", value: true, operator: "eq" }],
      order: { column: "created_at", ascending: true },
    },
    auth,
  );
  if (trackError || !Array.isArray(trackData)) return [];

  const { data: enrollData } = await queryTableWithAuthContext(
    {
      table: "learning_enrollments",
      operation: "select",
      filters: [{ column: "user_id", value: userId, operator: "eq" }],
    },
    auth,
  );
  const enrollmentByTrack = new Map(
    (Array.isArray(enrollData) ? enrollData : []).map((row: Record<string, unknown>) => [
      String(row.track_id),
      row,
    ]),
  );

  return trackData
    .map((row: Record<string, unknown>) => {
      const enrollment = enrollmentByTrack.get(String(row.id));
      const progressPercent = enrollment ? Number(enrollment.progress_percent ?? 0) : 0;
      if (!enrollment || progressPercent <= 0 || progressPercent >= 100) return null;
      return {
        trackId: String(row.id),
        title: String(row.title ?? ""),
        status: String(enrollment.status ?? "in_progress"),
        progressPercent,
      };
    })
    .filter((entry): entry is AssistantLearningSummary => entry !== null)
    .slice(0, 20);
}

async function fetchUnreadNotificationCount(auth: TablePolicyAuthContext): Promise<number> {
  // Not in TABLE_FEATURE_MAP — reading your own notifications needs no
  // separate feature capability, matching app-shell.tsx's own ungated
  // unread-count query.
  const { data, error } = await queryTableWithAuthContext(
    {
      table: "notifications",
      operation: "select",
      filters: [{ column: "read", value: false, operator: "eq" }],
    },
    auth,
  );
  if (error || !Array.isArray(data)) return 0;
  return data.length;
}

// Reads the hour in the business timezone (APP_TIMEZONE), not the server's.
// A UTC container previously greeted an India-based user with "Good evening"
// at 11:30pm their time and "Good morning" through their entire afternoon.
function timeOfDayGreeting(date: Date): string {
  const hour = zonedHour(date);
  if (hour < 12) return "Good morning";
  if (hour < DIGEST_EVENING_HOUR) return "Good afternoon";
  return "Good evening";
}

// "Acme Corp", "Acme Corp and Beta Inc", or "Acme Corp, Beta Inc, and Gamma
// LLC" — standard prose list joining, used everywhere the narrative names
// more than one real record in a single sentence.
function joinNames(names: string[]): string {
  const filtered = names.filter(Boolean);
  if (filtered.length === 0) return "";
  if (filtered.length === 1) return filtered[0];
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(", ")}, and ${filtered[filtered.length - 1]}`;
}

// A single closing question, always present, so every briefing ends by
// offering a concrete next step instead of just trailing off — mirrors the
// same standing "always end with a CTA" behavior added to the chat
// Assistant's own SYSTEM_PROMPT. Picks the most urgent non-empty section
// deterministically (never model-generated, so it can never promise
// something outside the Assistant's real capabilities).
function pickClosingQuestion(input: {
  tasks: AssistantTaskSummary[];
  tickets: AssistantTicketSummary[];
  deals: AssistantDealSummary[];
  learning: AssistantLearningSummary[];
}): string {
  if (input.tasks.length > 0) return "Want me to walk you through your tasks due soon?";
  if (input.tickets.length > 0) return "Should I pull up your open support tickets?";
  if (input.deals.length > 0) return "Want me to open your pipeline?";
  if (input.learning.length > 0) return "Want a nudge on finishing your learning track?";
  return "Is there anything I can help you with — deals, tasks, tickets, or learning?";
}

// The evening's closing question points at tomorrow rather than at a backlog
// — the whole premise of an evening briefing is that the day is over.
function pickEveningClosingQuestion(input: {
  tomorrow: DigestUpcomingEntry[];
  completedToday: DigestActivityEntry[];
}): string {
  if (input.tomorrow.length > 0) return "Want me to walk you through tomorrow?";
  if (input.completedToday.length > 0) return "Want to line something up for tomorrow?";
  return "Want to set a proposed completion date on something so tomorrow has a shape?";
}

export function buildEveningNarrative(input: {
  greeting: string;
  completedToday: DigestActivityEntry[];
  tomorrow: DigestUpcomingEntry[];
  sarcasmSeed: string;
}): string {
  const content: string[] = [];

  if (input.completedToday.length === 0) {
    // The requested "motivational sarcasm" — see SARCASTIC_EMPTY_LINES for
    // why the tone is nudge-not-reprimand, and pickSarcasticLine for why the
    // choice is seeded rather than random.
    content.push(pickSarcasticLine(input.sarcasmSeed));
  } else {
    const count = input.completedToday.length;
    const thingWord = count === 1 ? "thing" : "things";
    const highlights = joinNames(input.completedToday.slice(0, 3).map((entry) => entry.label));
    content.push(`You logged ${count} ${thingWord} today: ${highlights}.`);
  }

  if (input.tomorrow.length > 0) {
    const count = input.tomorrow.length;
    const itemWord = count === 1 ? "item lands" : "items land";
    const names = joinNames(input.tomorrow.slice(0, 3).map((entry) => `"${entry.title}"`));
    content.push(`${count} ${itemWord} tomorrow: ${names}.`);
  } else {
    content.push("Nothing is scheduled to land tomorrow.");
  }

  return `${input.greeting}. ${content.join(" ")} ${pickEveningClosingQuestion(input)}`;
}

function buildNarrative(input: {
  greeting: string;
  pipeline: { openDealCount: number; pipelineValueUsd: number } | null;
  deals: AssistantDealSummary[];
  tasks: AssistantTaskSummary[];
  tickets: AssistantTicketSummary[];
  unreadNotificationCount: number;
  news: AssistantNewsSummary[];
  learning: AssistantLearningSummary[];
}): string {
  const content: string[] = [];

  if (input.pipeline && input.pipeline.openDealCount > 0) {
    const amount = input.pipeline.pipelineValueUsd.toLocaleString("en-US", {
      maximumFractionDigits: 0,
    });
    const dealWord = input.pipeline.openDealCount === 1 ? "deal" : "deals";
    const names = joinNames(input.deals.slice(0, 2).map((deal) => deal.accountName));
    const namesClause = names ? ` — including ${names}` : "";
    content.push(
      `You have ${input.pipeline.openDealCount} open ${dealWord} worth $${amount} in your pipeline${namesClause}.`,
    );
  }

  if (input.tasks.length > 0) {
    const verb = input.tasks.length === 1 ? "task needs" : "tasks need";
    const names = joinNames(input.tasks.slice(0, 2).map((task) => `"${task.title}"`));
    content.push(`${input.tasks.length} ${verb} your attention soon: ${names}.`);
  }

  if (input.tickets.length > 0) {
    const ticketWord = input.tickets.length === 1 ? "ticket" : "tickets";
    const names = joinNames(input.tickets.slice(0, 2).map((ticket) => `"${ticket.subject}"`));
    content.push(`You have ${input.tickets.length} open support ${ticketWord}: ${names}.`);
  }

  if (input.unreadNotificationCount > 0) {
    const notifWord = input.unreadNotificationCount === 1 ? "notification" : "notifications";
    content.push(`${input.unreadNotificationCount} unread ${notifWord} waiting for you.`);
  }

  if (input.learning.length > 0) {
    const names = joinNames(
      input.learning.slice(0, 2).map((track) => `"${track.title}" (${track.progressPercent}%)`),
    );
    content.push(`You're partway through ${names}.`);
  }

  if (input.news.length > 0) {
    const headlines = joinNames(input.news.slice(0, 2).map((post) => `"${post.title}"`));
    content.push(`Latest from LIVEY: ${headlines}.`);
  }

  const body =
    content.length > 0 ? content.join(" ") : "Nothing urgent needs your attention right now.";
  return `${input.greeting}. ${body} ${pickClosingQuestion(input)}`;
}

// Optional `token` mirrors getAuthContext()'s own signature — the real
// caller (integrations/local/digest.ts) always omits it and resolves the
// session from the request cookie, exactly like sendAssistantMessage()
// does. Tests pass an explicit token so they can drive this function the
// same proven way livey-service.server.test.ts already drives
// getAuthContext() itself, without needing to mock the cookie/request layer.
export async function getUserDigest(
  token?: string,
  // Injectable clock so a test can drive the morning and evening branches
  // without waiting for 5pm or mutating the system time.
  options?: { now?: Date },
): Promise<UserDigest> {
  const authContext = await getAuthContext(token);
  return buildDigest(authContext, authContext.session?.user.id ?? null, options);
}

/**
 * The same digest, for a user who is not making the request.
 *
 * The daily digest email has no session to resolve — it runs on a schedule,
 * for every eligible recipient at once. It reuses the WhatsApp webhook's
 * existing session-less path (resolveAuthContextForProfile) rather than
 * inventing a second way to establish who someone is, so the email is scoped
 * by exactly the same capability and policy checks as the in-app dialog. A
 * recipient can never be emailed a fact the UI would have hidden from them.
 */
export async function getUserDigestForUser(
  userId: string,
  options?: { now?: Date },
): Promise<UserDigest> {
  const { resolveAuthContextForProfile } = await import("@/server/livey-service.server");
  const resolved = await resolveAuthContextForProfile(userId);
  return buildDigest(resolved, userId, options);
}

type DigestAuth = Pick<
  Awaited<ReturnType<typeof getAuthContext>>,
  "profile" | "roles" | "assignment" | "activeContext"
>;

async function buildDigest(
  authContext: DigestAuth,
  userId: string | null,
  options?: { now?: Date },
): Promise<UserDigest> {
  if (!userId || !authContext.activeContext) {
    return { ...EMPTY_USER_DIGEST };
  }

  const capabilities = await loadRoleCapabilities(authContext.assignment?.roleKey ?? null);
  if (!hasCapability(capabilities, "assistant", "read")) {
    return { ...EMPTY_USER_DIGEST };
  }

  const policyAuth: TablePolicyAuthContext = {
    userId,
    roles: authContext.roles,
    partnerId: authContext.profile?.partner_id ?? null,
    companyName: authContext.profile?.company_name ?? null,
    hasGovernedContext: Boolean(authContext.activeContext),
    governedRoleKey: authContext.assignment?.roleKey ?? null,
    geographyCeilingNodeId: authContext.assignment?.geographyCeilingNodeId ?? null,
  };

  const now = options?.now ?? new Date();
  const mode: DigestMode = zonedHour(now) >= DIGEST_EVENING_HOUR ? "evening" : "morning";
  const today = zonedCalendarDate(now);
  const todayWindow = zonedDayRange(today);
  const tomorrow = shiftCalendarDate(today, 1);

  const [
    news,
    pipeline,
    dealRows,
    taskRows,
    tickets,
    learning,
    unreadNotificationCount,
    closedTickets,
    calls,
  ] = await Promise.all([
    fetchNewsSection(policyAuth, capabilities),
    fetchPipelineSection(policyAuth, capabilities),
    fetchScopedDeals(policyAuth, capabilities),
    fetchScopedTasks(policyAuth, capabilities),
    fetchOpenTicketsSection(policyAuth, capabilities),
    fetchLearningInProgressSection(policyAuth, capabilities, userId),
    fetchUnreadNotificationCount(policyAuth),
    // Only the evening briefing reads these, so the morning path doesn't pay
    // for two extra scoped queries it will never render.
    mode === "evening"
      ? fetchClosedTicketsToday(policyAuth, capabilities, todayWindow)
      : Promise.resolve([]),
    mode === "evening"
      ? fetchCallsToday(policyAuth, capabilities, todayWindow)
      : Promise.resolve([]),
  ]);

  const deals = selectTopOpenDeals(dealRows);
  const tasks = selectTasksDueSoon(taskRows, now);

  const completedToday =
    mode === "evening"
      ? [
          ...selectCompletedTasksToday(taskRows, todayWindow),
          ...selectDealActivityToday(dealRows, todayWindow),
          ...closedTickets,
          ...calls,
        ]
          .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
          .slice(0, 20)
      : [];
  const upcomingTomorrow = mode === "evening" ? selectTomorrow(taskRows, dealRows, tomorrow) : [];

  const firstName = authContext.profile?.full_name?.split(" ")[0] ?? null;
  const greeting = firstName ? `${timeOfDayGreeting(now)}, ${firstName}` : timeOfDayGreeting(now);
  const narrative =
    mode === "evening"
      ? buildEveningNarrative({
          greeting,
          completedToday,
          tomorrow: upcomingTomorrow,
          // Seeded per user per day: the same joke all evening, a different
          // one tomorrow.
          sarcasmSeed: `${userId}:${today}`,
        })
      : buildNarrative({
          greeting,
          pipeline,
          deals,
          tasks,
          tickets,
          unreadNotificationCount,
          news,
          learning,
        });

  return {
    available: true,
    mode,
    greeting,
    narrative,
    generatedAt: now.toISOString(),
    news,
    pipeline,
    deals,
    tasks,
    tickets,
    unreadNotificationCount,
    learning,
    completedToday,
    tomorrow: upcomingTomorrow,
  };
}
