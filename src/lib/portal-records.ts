import { WORLD_CURRENCY_CODES } from "@/domain/contracts/world-geography";

export const DEAL_STAGE_ORDER = [
  "sourced",
  "demo",
  "testing",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;

export type DealStage = (typeof DEAL_STAGE_ORDER)[number];

// Every ISO 4217 currency in use by a governed WORLD_COUNTRIES entry. The FX
// quote provider (src/server/fx-rates.server.ts) accepts any 3-letter code,
// so this list isn't a technical limit — it's the full set of currencies a
// deal's country could plausibly transact in.
export const DEAL_CURRENCY_OPTIONS: readonly string[] = WORLD_CURRENCY_CODES;

export type DealCurrencyCode = string;

export type DealRecord = {
  id: string;
  account_name: string;
  customer_id: string | null;
  contact_name: string;
  poc_profile_id: string | null;
  owner_name: string;
  country: string;
  region: string;
  product: string;
  stage: DealStage;
  status: string;
  quantity: number;
  amount: string;
  currency_code: string;
  amount_value: number | null;
  amount_usd: number | null;
  fx_rate: number | null;
  fx_provider: string | null;
  fx_rate_fetched_at: string | null;
  customer_budget: string | null;
  probability: number;
  possible_close_date: string | null;
  // The owner's forecast for when this deal actually completes. Distinct from
  // close_date (the committed close) and possible_close_date (the probable
  // close used for pipeline weighting) — reminders fire off this one.
  proposed_completion_date: string | null;
  close_date: string;
  source: string;
  last_touch: string;
  notes: string;
  user_id: string | null;
  partner_id: string | null;
  is_hidden_to_team: boolean;
  reward_rate_percent: number;
  commercial_approved: boolean;
  version: number;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export type DealCollaboratorRecord = {
  id: string;
  deal_id: string;
  user_id: string;
  split_percent: number;
  sort_order: number;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export type CustomerRecord = {
  id: string;
  company_name: string;
  account_owner: string;
  country?: string | null;
  region: string;
  segment: string;
  health_score: number;
  mrr: string;
  renewal_date: string;
  status: string;
  next_step: string;
  last_touch: string;
  domain?: string | null;
  phone?: string | null;
  tax_registration_id?: string | null;
  provider_customer_id?: string | null;
  address?: string | null;
  origin?: string | null;
  duplicate_review_status?: string | null;
  master_customer_id?: string | null;
  merged_into_customer_id?: string | null;
  merged_at?: string | null;
  merge_reason?: string | null;
  external_ids?: unknown;
  user_id: string | null;
  partner_id: string | null;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export type CustomerParticipantRecord = {
  id: string;
  customer_id: string;
  partner_id: string | null;
  participant_type: string;
  source: string;
  actor_id: string | null;
  participant_user_id: string | null;
  reason: string;
  valid_from: string;
  valid_to: string | null;
  provenance: unknown;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export type DealParticipantRecord = {
  id: string;
  deal_id: string;
  partner_id: string | null;
  participant_type: string;
  source: string;
  actor_id: string | null;
  participant_user_id: string | null;
  reason: string;
  valid_from: string;
  valid_to: string | null;
  provenance: unknown;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export type CustomerMergeEventRecord = {
  id: string;
  partner_id: string | null;
  surviving_customer_id: string;
  merged_customer_id: string;
  redirect_customer_id: string | null;
  before_state: unknown;
  after_state: unknown;
  external_id_snapshot: unknown;
  scope_restrictions: unknown;
  reason: string;
  actor_id: string | null;
  is_seed: boolean;
  created_at: string;
};

export type CustomerActivityRecord = {
  id: string;
  customer_id: string;
  partner_id: string | null;
  actor_id: string | null;
  actor_name: string;
  summary: string;
  next_step: string | null;
  created_at: string;
};

export type CatalogItemRecord = {
  id: string;
  sku: string;
  product_name: string;
  category: string;
  partner_tier: string;
  list_price: string;
  margin: string;
  stock: number;
  availability: string;
  benefits: string;
  catalog_kind?: string | null;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export type AuditEventRecord = {
  id: string;
  actor_name: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_name: string;
  outcome: string;
  details: string;
  severity: string;
  created_at: string;
  is_seed: boolean;
};

export type TeamMemberRecord = {
  id: string;
  company_name: string;
  full_name: string;
  email: string;
  role_title: string;
  portal_role: string;
  responsibility: string;
  status: string;
  last_active: string;
  phone: string;
  permissions: string[];
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export type SupportTicketRecord = {
  id: string;
  human_id: string;
  partner_id: string | null;
  created_by: string | null;
  created_by_name: string;
  subject: string;
  description: string;
  product_sku?: string | null;
  serial_number?: string | null;
  status: string;
  priority: string;
  assignee_name: string | null;
  response_due_at: string | null;
  resolve_due_at: string | null;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export type SupportTicketCommentRecord = {
  id: string;
  ticket_id: string;
  author_id: string | null;
  author_name: string;
  author_role: string;
  body: string;
  is_internal: boolean;
  is_seed: boolean;
  created_at: string;
};

export type GlobalSearchResultItem = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

export type GlobalSearchResult = {
  group: "Deals" | "Partners" | "Product Catalog";
  items: GlobalSearchResultItem[];
};

/** Won and Lost are outcomes, not steps — nothing advances out of them. */
export function isTerminalDealStage(stage: DealStage): boolean {
  return stage === "won" || stage === "lost";
}

/**
 * True where "move forward" is really "close this deal", so the UI must ask
 * Won or Lost instead of stepping.
 *
 * Negotiation is the last open stage: product.md §9.15 makes Won require an
 * outcome date and a PO Upload-Now-or-Submit-Later choice, and says "Ordinary
 * Lost is available only from Negotiation". The server agrees from two
 * directions — FORWARD_NEXT_STAGE has no entry for negotiation (so an ordinary
 * forward move out of it is refused), and nextAuthorisedActions only offers
 * deal.mark_won when the stage is negotiation.
 */
export function requiresOutcomeChoice(stage: DealStage): boolean {
  return stage === "negotiation";
}

export function nextDealStage(stage: DealStage): DealStage {
  // A terminal stage returns itself, meaning "no forward move available".
  // Without this, "won" would step to "lost" purely because lost follows won
  // in DEAL_STAGE_ORDER. The server already refuses that — its
  // FORWARD_NEXT_STAGE map (deal-commands.server.ts) skips any hop whose
  // source or target is terminal — so callers were only ever able to turn
  // that into a failed command, never a real move. Mirroring the server here
  // lets the UI hide the action instead of offering one that cannot succeed.
  if (isTerminalDealStage(stage)) return stage;
  const index = DEAL_STAGE_ORDER.indexOf(stage);
  return index >= 0 && index < DEAL_STAGE_ORDER.length - 1 ? DEAL_STAGE_ORDER[index + 1] : stage;
}

export function nextDealStatus(currentStatus: string, stage: DealStage): string {
  if (stage === "won" || stage === "lost") {
    return stage;
  }
  return currentStatus;
}

// 9e: the set of stages moveDealStageBackward (deal-commands.server.ts)
// would actually accept as a target from the given current stage — every
// earlier non-terminal stage. Mirrors that command's own isBackwardMove
// check exactly (including its "a terminal `from` stage is never a valid
// backward move, regardless of target" rule) so the UI never offers a move
// the server would reject.
export function getValidBackwardStages(stage: DealStage): DealStage[] {
  // Reopening a closed deal returns it to Negotiation and nowhere else.
  // product.md names Negotiation as the destination twice ("moves Deal
  // backward to Negotiation with reason"), and a Won dropped straight to
  // Sourced would discard the qualified/proposal/negotiation history the
  // §9.10 dialog exists to reason about. Whether THIS deal may reopen is the
  // server's call — moveDealStageBackward refuses once the win has released
  // reward points — so this only describes the shape of the move.
  if (isTerminalDealStage(stage)) return ["negotiation"];
  const index = DEAL_STAGE_ORDER.indexOf(stage);
  if (index <= 0) return [];
  return DEAL_STAGE_ORDER.slice(0, index).filter(
    (candidate) => candidate !== "won" && candidate !== "lost",
  );
}

export function parseDealAmount(amount: string | number): number {
  const numeric =
    typeof amount === "number" ? amount : Number.parseFloat(String(amount).replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function normalizeDealCurrencyCode(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase();
  return normalized || "USD";
}

export function isDealCurrencyCode(value: string): value is DealCurrencyCode {
  return (DEAL_CURRENCY_OPTIONS as readonly string[]).includes(value);
}

export function getDealUsdAmount(input: Pick<DealRecord, "amount" | "amount_usd">): number {
  const explicitAmount = Number(input.amount_usd);
  if (Number.isFinite(explicitAmount) && explicitAmount > 0) {
    return explicitAmount;
  }
  return parseDealAmount(input.amount);
}

export function requiresSuperAdminApproval(amount: string | number): boolean {
  return parseDealAmount(amount) > 5000;
}
