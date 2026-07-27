export const DEAL_STAGE_ORDER = [
  "sourced",
  "demo",
  "testing",
  "qualified",
  "proposal",
  "negotiation",
  "approved",
  "won",
  "lost",
] as const;

export type DealStage = (typeof DEAL_STAGE_ORDER)[number];

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
  customer_budget: string | null;
  probability: number;
  possible_close_date: string | null;
  close_date: string;
  source: string;
  last_touch: string;
  notes: string;
  user_id: string | null;
  partner_id: string | null;
  is_hidden_to_team: boolean;
  reward_rate_percent: number;
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
  region: string;
  segment: string;
  health_score: number;
  mrr: string;
  renewal_date: string;
  status: string;
  next_step: string;
  last_touch: string;
  user_id: string | null;
  partner_id: string | null;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
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
  partner_id: string | null;
  created_by: string | null;
  created_by_name: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assignee_name: string | null;
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
  group: "Deals" | "Partners" | "Catalog";
  items: GlobalSearchResultItem[];
};

export function nextDealStage(stage: DealStage): DealStage {
  const index = DEAL_STAGE_ORDER.indexOf(stage);
  return index >= 0 && index < DEAL_STAGE_ORDER.length - 1 ? DEAL_STAGE_ORDER[index + 1] : stage;
}

export function nextDealStatus(currentStatus: string, stage: DealStage): string {
  if (stage === "won" || stage === "lost") {
    return stage;
  }
  return currentStatus;
}

export function parseDealAmount(amount: string | number): number {
  const numeric =
    typeof amount === "number" ? amount : Number.parseFloat(String(amount).replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function requiresSuperAdminApproval(amount: string | number): boolean {
  return parseDealAmount(amount) >= 5000;
}
