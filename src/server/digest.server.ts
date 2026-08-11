import {
  type AssistantDealSummary,
  type AssistantLearningSummary,
  type AssistantNewsSummary,
  type AssistantTaskSummary,
  type AssistantTicketSummary,
} from "@/domain/contracts/assistant";
import { EMPTY_USER_DIGEST, type UserDigest } from "@/domain/contracts/digest";
import { isOpenPipelineStage } from "@/lib/pipeline-metrics";
import { loadDashboardPipelineMetrics } from "@/server/dashboard-metrics.server";
import { getAuthContext, queryTableWithAuthContext } from "@/server/livey-service.server";
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
const CLOSED_TASK_STATUSES = new Set(["done", "canceled"]);
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
  const { data, error } = await queryTableWithAuthContext(
    {
      table: "portal_news_posts",
      operation: "select",
      filters: [],
      order: { column: "created_at", ascending: false },
    },
    auth,
  );
  if (error || !Array.isArray(data)) return [];
  return data.slice(0, 3).map((row: Record<string, unknown>) => ({
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

// A few real open deals, alongside fetchPipelineSection's exact aggregate —
// this is what lets the narrative name actual accounts instead of only
// counting them. Reuses isOpenPipelineStage (the same predicate
// loadDashboardPipelineMetrics itself uses via summarizeOpenPipeline) so
// this list can never disagree with the aggregate on what counts as "open."
// No query-level stage filter exists for "not won/lost" (QueryFilter only
// supports eq/in), so — same as fetchTasksDueSoonSection below — this
// fetches and filters in JS, matching the existing pattern in this file.
async function fetchTopOpenDealsSection(
  auth: TablePolicyAuthContext,
  capabilities: FeatureCapabilities,
): Promise<AssistantDealSummary[]> {
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
  if (error || !Array.isArray(data)) return [];
  return data
    .filter((row: Record<string, unknown>) => isOpenPipelineStage(String(row.stage ?? "")))
    .slice(0, 3)
    .map((row: Record<string, unknown>) => ({
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

async function fetchTasksDueSoonSection(
  auth: TablePolicyAuthContext,
  capabilities: FeatureCapabilities,
): Promise<AssistantTaskSummary[]> {
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
  if (error || !Array.isArray(data)) return [];

  // No date-range query operator exists (QueryFilter.operator is "eq" | "in"
  // only) — "due soon" genuinely has to be filtered in JS after fetching.
  const horizon = Date.now() + TASK_DUE_SOON_DAYS * 24 * 60 * 60 * 1000;
  return data
    .filter((row: Record<string, unknown>) => {
      if (CLOSED_TASK_STATUSES.has(String(row.status ?? ""))) return false;
      if (!row.due_at) return false;
      const dueMs = new Date(String(row.due_at)).getTime();
      return Number.isFinite(dueMs) && dueMs <= horizon;
    })
    .slice(0, 20)
    .map((row: Record<string, unknown>) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      status: String(row.status ?? ""),
      priority: String(row.priority ?? ""),
      dueAt: row.due_at ? String(row.due_at) : null,
    }));
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

function timeOfDayGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
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
export async function getUserDigest(token?: string): Promise<UserDigest> {
  const authContext = await getAuthContext(token);
  const userId = authContext.session?.user.id ?? null;

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

  const [news, pipeline, deals, tasks, tickets, learning, unreadNotificationCount] =
    await Promise.all([
      fetchNewsSection(policyAuth, capabilities),
      fetchPipelineSection(policyAuth, capabilities),
      fetchTopOpenDealsSection(policyAuth, capabilities),
      fetchTasksDueSoonSection(policyAuth, capabilities),
      fetchOpenTicketsSection(policyAuth, capabilities),
      fetchLearningInProgressSection(policyAuth, capabilities, userId),
      fetchUnreadNotificationCount(policyAuth),
    ]);

  const now = new Date();
  const firstName = authContext.profile?.full_name?.split(" ")[0] ?? null;
  const greeting = firstName ? `${timeOfDayGreeting(now)}, ${firstName}` : timeOfDayGreeting(now);
  const narrative = buildNarrative({
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
  };
}
