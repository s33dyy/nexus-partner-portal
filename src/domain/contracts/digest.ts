// Contract for the login/daily digest — a brief, RBAC-scoped summary of what
// the caller needs to know (news, pipeline, tasks due, tickets, learning,
// notifications), shown once per day and readable aloud via the voice
// controls in daily-digest-dialog.tsx. Every field is built server-side from
// real, capability-gated queries (see digest.server.ts) — the narrative is a
// deterministic template, never model-generated, so it can never state a
// fact that isn't backed by one of the structured fields alongside it.

import type {
  AssistantLearningSummary,
  AssistantNewsSummary,
  AssistantTaskSummary,
} from "@/domain/contracts/assistant";

export type UserDigest = {
  available: boolean;
  greeting: string;
  narrative: string;
  generatedAt: string;
  news: AssistantNewsSummary[];
  pipeline: { openDealCount: number; pipelineValueUsd: number } | null;
  tasks: AssistantTaskSummary[];
  openTicketCount: number | null;
  unreadNotificationCount: number;
  learning: AssistantLearningSummary[];
};

export const EMPTY_USER_DIGEST: UserDigest = {
  available: false,
  greeting: "",
  narrative: "",
  generatedAt: "",
  news: [],
  pipeline: null,
  tasks: [],
  openTicketCount: null,
  unreadNotificationCount: 0,
  learning: [],
};
