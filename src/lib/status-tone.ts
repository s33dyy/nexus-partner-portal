import type { BadgeProps } from "@/components/ui/badge";

export type StatusTone = NonNullable<BadgeProps["tone"]>;

/**
 * Maps this app's status vocabulary to a semantic Badge tone.
 *
 * Every screen renders status pills — deal stages, ticket states, approval
 * outcomes, audit severities, partner statuses — and before this each route
 * picked a shadcn `variant` by eye. The result was that "won", "rejected",
 * "super_admin" and "high priority" could all render as the same solid
 * indigo, and anything vaguely negative became a loud solid red. A reader
 * scanning a table learned nothing from the colour.
 *
 * One table, so a status means the same colour on every screen.
 *
 * Matching is exact-first, then substring, both on a normalised key
 * (lowercased, spaces and hyphens folded to underscores) — the same concept
 * appears in the data as "in_progress", "In Progress" and "in-progress"
 * depending on which module wrote the row.
 */
const EXACT: Record<string, StatusTone> = {
  // --- terminal good ---
  won: "success",
  approved: "success",
  active: "success",
  completed: "success",
  complete: "success",
  done: "success",
  resolved: "success",
  closed: "success",
  signed: "success",
  verified: "success",
  connected: "success",
  fulfilled: "success",
  certified: "success",
  published: "success",
  passed: "success",
  healthy: "success",

  // --- terminal bad ---
  lost: "danger",
  rejected: "danger",
  failed: "danger",
  cancelled: "danger",
  canceled: "danger",
  revoked: "danger",
  suspended: "danger",
  blocked: "danger",
  expired: "danger",
  overdue: "danger",
  breached: "danger",
  disconnected: "danger",
  error: "danger",
  high: "danger",
  urgent: "danger",
  critical: "danger",

  // --- waiting on someone ---
  pending: "warning",
  submitted: "warning",
  under_review: "warning",
  in_review: "warning",
  review: "warning",
  waiting: "warning",
  requested: "warning",
  reopen_requested: "warning",
  need_more_info: "warning",
  partial_approval: "warning",
  pending_agreement: "warning",
  signed_pending_review: "warning",
  draft: "warning",
  medium: "warning",
  at_risk: "warning",

  // --- in flight ---
  in_progress: "info",
  open: "info",
  triaged: "info",
  negotiation: "info",
  proposal: "info",
  qualified: "info",
  testing: "info",
  accepted: "info",
  reopened: "info",
  scheduled: "info",
  processing: "info",

  // --- neutral / informational ---
  low: "neutral",
  to_do: "neutral",
  todo: "neutral",
  new: "neutral",
  sourced: "neutral",
  demo: "neutral",
  inactive: "neutral",
  invited: "neutral",
  paused: "neutral",
  archived: "neutral",
  retired: "neutral",
  none: "neutral",
  unknown: "neutral",
};

// Checked in order, so "waiting_on_partner" resolves before a bare "partner"
// substring could ever match something else.
const CONTAINS: Array<[string, StatusTone]> = [
  ["reject", "danger"],
  ["fail", "danger"],
  ["cancel", "danger"],
  ["revoke", "danger"],
  ["block", "danger"],
  ["breach", "danger"],
  ["overdue", "danger"],
  ["expire", "danger"],
  ["lost", "danger"],
  ["wait", "warning"],
  ["pending", "warning"],
  ["review", "warning"],
  ["partial", "warning"],
  ["draft", "warning"],
  ["risk", "warning"],
  ["progress", "info"],
  ["open", "info"],
  ["approve", "success"],
  ["complete", "success"],
  ["active", "success"],
  ["won", "success"],
  ["sign", "success"],
];

export function normalizeStatusKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * @param fallback tone to use when the value isn't recognised. Defaults to
 * "neutral" — an unknown status should read as unremarkable metadata, never
 * borrow the visual weight of a real success or failure.
 */
export function resolveStatusTone(
  value: string | null | undefined,
  fallback: StatusTone = "neutral",
): StatusTone {
  if (!value) return fallback;
  const key = normalizeStatusKey(value);
  if (key in EXACT) return EXACT[key];
  for (const [needle, tone] of CONTAINS) {
    if (key.includes(needle)) return tone;
  }
  return fallback;
}

/**
 * Deal stages, coloured as a funnel rather than by generic status matching.
 *
 * resolveStatusTone() would map most of these correctly on its own, but the
 * pipeline reads better when the mid-funnel stages escalate deliberately
 * (info -> brand -> warning) instead of every open stage sharing one colour.
 * Kept here rather than private to a route so Deals, Pipeline and the board
 * can never drift apart on what "negotiation" looks like.
 */
export const DEAL_STAGE_TONE: Record<string, StatusTone> = {
  sourced: "neutral",
  demo: "info",
  testing: "info",
  qualified: "brand",
  proposal: "brand",
  negotiation: "warning",
  approved: "brand",
  won: "success",
  lost: "danger",
};

export function resolveDealStageTone(stage: string | null | undefined): StatusTone {
  if (!stage) return "neutral";
  return DEAL_STAGE_TONE[normalizeStatusKey(stage)] ?? resolveStatusTone(stage);
}
