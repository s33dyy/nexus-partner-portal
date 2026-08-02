import {
  type AssistantLearningSummary,
  type AssistantNewsSummary,
  type AssistantTaskSummary,
} from "@/domain/contracts/assistant";
import { EMPTY_USER_DIGEST, type UserDigest } from "@/domain/contracts/digest";
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
  return data.slice(0, 2).map((row: Record<string, unknown>) => ({
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

async function fetchOpenTicketCount(
  auth: TablePolicyAuthContext,
  capabilities: FeatureCapabilities,
): Promise<number | null> {
  if (!hasCapability(capabilities, "tickets", "read")) return null;
  const { data, error } = await queryTableWithAuthContext(
    {
      table: "support_tickets",
      operation: "select",
      filters: [{ column: "status", value: OPEN_TICKET_STATUSES, operator: "in" }],
    },
    auth,
  );
  if (error || !Array.isArray(data)) return null;
  return data.length;
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

function buildNarrative(input: {
  greeting: string;
  pipeline: { openDealCount: number; pipelineValueUsd: number } | null;
  tasks: AssistantTaskSummary[];
  openTicketCount: number | null;
  unreadNotificationCount: number;
  news: AssistantNewsSummary[];
  learning: AssistantLearningSummary[];
}): string {
  const clauses: string[] = [`${input.greeting}.`];

  if (input.pipeline && input.pipeline.openDealCount > 0) {
    const amount = input.pipeline.pipelineValueUsd.toLocaleString("en-US", {
      maximumFractionDigits: 0,
    });
    const dealWord = input.pipeline.openDealCount === 1 ? "deal" : "deals";
    clauses.push(
      `You have ${input.pipeline.openDealCount} open ${dealWord} worth $${amount} in your pipeline.`,
    );
  }

  if (input.tasks.length > 0) {
    const verb = input.tasks.length === 1 ? "task is" : "tasks are";
    clauses.push(`${input.tasks.length} ${verb} due soon.`);
  }

  if (input.openTicketCount && input.openTicketCount > 0) {
    const ticketWord = input.openTicketCount === 1 ? "ticket" : "tickets";
    clauses.push(`${input.openTicketCount} open support ${ticketWord}.`);
  }

  if (input.unreadNotificationCount > 0) {
    const notifWord = input.unreadNotificationCount === 1 ? "notification" : "notifications";
    clauses.push(`${input.unreadNotificationCount} unread ${notifWord}.`);
  }

  if (input.learning.length > 0) {
    const trackWord = input.learning.length === 1 ? "track" : "tracks";
    clauses.push(`${input.learning.length} learning ${trackWord} in progress.`);
  }

  if (input.news[0]) {
    clauses.push(`Latest from LIVEY: "${input.news[0].title}".`);
  }

  if (clauses.length === 1) {
    clauses.push("Nothing urgent needs your attention right now.");
  }

  return clauses.join(" ");
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

  const [news, pipeline, tasks, openTicketCount, learning, unreadNotificationCount] =
    await Promise.all([
      fetchNewsSection(policyAuth, capabilities),
      fetchPipelineSection(policyAuth, capabilities),
      fetchTasksDueSoonSection(policyAuth, capabilities),
      fetchOpenTicketCount(policyAuth, capabilities),
      fetchLearningInProgressSection(policyAuth, capabilities, userId),
      fetchUnreadNotificationCount(policyAuth),
    ]);

  const now = new Date();
  const firstName = authContext.profile?.full_name?.split(" ")[0] ?? null;
  const greeting = firstName ? `${timeOfDayGreeting(now)}, ${firstName}` : timeOfDayGreeting(now);
  const narrative = buildNarrative({
    greeting,
    pipeline,
    tasks,
    openTicketCount,
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
    tasks,
    openTicketCount,
    unreadNotificationCount,
    learning,
  };
}
