// Contract for the login/daily digest — a brief, RBAC-scoped summary of what
// the caller needs to know (news, pipeline, tasks due, tickets, learning,
// notifications), shown once per day and readable aloud via the voice
// controls in daily-digest-dialog.tsx. Every field is built server-side from
// real, capability-gated queries (see digest.server.ts) — the narrative is a
// deterministic template, never model-generated, so it can never state a
// fact that isn't backed by one of the structured fields alongside it.
//
// The digest has two modes. In the MORNING it looks forward: open pipeline,
// tasks due soon, open tickets. In the EVENING it looks back at what the
// caller actually got done today and forward to just tomorrow — a different
// question, so a different set of fields, on the same contract.

import type {
  AssistantDealSummary,
  AssistantLearningSummary,
  AssistantNewsSummary,
  AssistantTaskSummary,
  AssistantTicketSummary,
} from "@/domain/contracts/assistant";

export type DigestMode = "morning" | "evening";

/**
 * One thing the caller did today.
 *
 * Deliberately derived from the caller's own already-policy-scoped records
 * (a task with completed_at set today, a deal that reached won/lost today,
 * a call they handled) rather than from domain_activity_events — that table
 * is super-admin-only through the generic query path, and widening it to
 * build a digest would have meant inventing a new per-subject read scope for
 * every subject type it spans.
 */
export type DigestActivityEntry = {
  id: string;
  kind: "task" | "deal" | "ticket" | "call";
  /** Ready-to-read sentence fragment: `Completed "Ship Q3 pricing sheet"`. */
  label: string;
  /** ISO timestamp the activity happened at, for ordering. */
  occurredAt: string;
};

/** One thing landing tomorrow. */
export type DigestUpcomingEntry = {
  id: string;
  kind: "task" | "deal";
  title: string;
  /** Which date drove this: the owner's forecast, or a hard deadline. */
  reason: "proposed_completion" | "due";
};

export type UserDigest = {
  available: boolean;
  mode: DigestMode;
  greeting: string;
  narrative: string;
  generatedAt: string;
  news: AssistantNewsSummary[];
  pipeline: { openDealCount: number; pipelineValueUsd: number } | null;
  // A few real open deals (by value), alongside the pipeline aggregate
  // above — the aggregate carries the exact totals, this carries names for
  // the narrative to reference specifically rather than only counting.
  deals: AssistantDealSummary[];
  tasks: AssistantTaskSummary[];
  tickets: AssistantTicketSummary[];
  unreadNotificationCount: number;
  learning: AssistantLearningSummary[];
  // Evening-only sections. Always present (empty in the morning) so the
  // dialog never has to branch on undefined.
  completedToday: DigestActivityEntry[];
  tomorrow: DigestUpcomingEntry[];
};

export const EMPTY_USER_DIGEST: UserDigest = {
  available: false,
  mode: "morning",
  greeting: "",
  narrative: "",
  generatedAt: "",
  news: [],
  pipeline: null,
  deals: [],
  tasks: [],
  tickets: [],
  unreadNotificationCount: 0,
  learning: [],
  completedToday: [],
  tomorrow: [],
};

/**
 * Hour (0-23, local to the viewer's server) at or after which the digest
 * switches to looking back rather than forward.
 */
export const DIGEST_EVENING_HOUR = 17;

export function resolveDigestMode(date: Date): DigestMode {
  return date.getHours() >= DIGEST_EVENING_HOUR ? "evening" : "morning";
}

/**
 * What the evening briefing says when the caller logged precisely nothing.
 *
 * The brief asked for "motivational sarcasm", which is a narrow target: the
 * line has to land as a nudge from a colleague, not a reprimand from a
 * manager. Every one of these ends pointed at tomorrow rather than dwelling
 * on today, and none of them insult the reader's effort or competence —
 * a real user having a genuinely bad day will read this, and it should still
 * be something they'd smile at.
 *
 * Selection is deterministic (see pickSarcasticLine): a digest that re-rolled
 * its joke every time the dialog reopened would read as broken, and
 * Math.random() in a server render would also break SSR hydration.
 */
export const SARCASTIC_EMPTY_LINES: readonly string[] = [
  "Your activity log for today is spotless. Suspiciously spotless.",
  "Nothing logged today — either you've reached inbox nirvana, or the pipeline is quietly plotting against you.",
  "Today's highlight reel is a blank screen. Tomorrow's has room for a plot twist.",
  "Zero entries today. Bold strategy. Let's see how it plays out tomorrow.",
  "The CRM checked in on you today and found nothing but tumbleweed. It's not angry, just disappointed.",
  "No moves logged today. The deals didn't close themselves — you can check, we looked.",
  "You logged nothing today, which is technically a perfect record. Let's ruin it tomorrow.",
];

/**
 * Picks a line stably for a given user and day, so it stays the same across
 * reopens of the dialog but changes tomorrow. Not cryptographic — it only
 * needs to spread evenly and be reproducible.
 */
export function pickSarcasticLine(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  const bucket = Math.abs(hash) % SARCASTIC_EMPTY_LINES.length;
  return SARCASTIC_EMPTY_LINES[bucket];
}
