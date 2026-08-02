// Contracts for the in-app Assistant (chatbot). It may draft a new Deal for
// explicit confirmation, or search/list the caller's own authorised records
// across Deals, Partners, Customers, Tasks, Tickets, team members, Learning
// tracks, and the News feed — nothing else (no other writes, no approvals/
// deletions/role changes/exports). The model is used only for intent classification
// and field extraction from free text; every business-relevant answer (list
// results, draft previews) is built by server code from real database rows
// scoped through the same RBAC the caller's own UI uses, never invented by
// the model.

export type AssistantMessageRole = "user" | "assistant";

export type AssistantChatMessage = {
  role: AssistantMessageRole;
  content: string;
};

export type AssistantDealDraft = {
  accountName: string | null;
  contactName: string | null;
  product: string | null;
  quantity: number | null;
  amount: string | null;
  currencyCode: string | null;
  country: string | null;
  notes: string | null;
  // Resolved server-side (see assistant.server.ts's account/client matching
  // against the same listDropdownSourceValues search the manual "create
  // deal" form's own account/client pickers use) once accountName/
  // contactName match an existing Partner/Customer — never set by the model.
  partnerId: string | null;
  customerId: string | null;
};

export const EMPTY_ASSISTANT_DEAL_DRAFT: AssistantDealDraft = {
  accountName: null,
  contactName: null,
  product: null,
  quantity: null,
  amount: null,
  currencyCode: null,
  country: null,
  notes: null,
  partnerId: null,
  customerId: null,
};

export const REQUIRED_ASSISTANT_DEAL_FIELDS = [
  "accountName",
  "contactName",
  "product",
  "amount",
] as const;

export type AssistantIntent =
  | { type: "list_deals"; reply: string; stage: string | null; status: string | null }
  | { type: "create_deal_draft"; reply: string; draft: AssistantDealDraft }
  | { type: "list_partners"; reply: string; query: string | null }
  | { type: "list_customers"; reply: string; query: string | null }
  | { type: "list_tasks"; reply: string; query: string | null }
  | { type: "list_tickets"; reply: string; query: string | null }
  | { type: "list_users"; reply: string; query: string | null }
  | { type: "list_learning"; reply: string; query: string | null }
  | { type: "list_news"; reply: string; query: string | null }
  | { type: "none"; reply: string };

export type AssistantDealSummary = {
  id: string;
  accountName: string;
  product: string;
  stage: string;
  status: string;
  amount: string;
  currencyCode: string;
  updatedAt: string;
};

export type AssistantPartnerSummary = {
  id: string;
  companyName: string;
  tier: string;
  status: string;
  country: string;
};

export type AssistantCustomerSummary = {
  id: string;
  companyName: string;
  segment: string;
  status: string;
  region: string;
};

export type AssistantTaskSummary = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
};

export type AssistantTicketSummary = {
  id: string;
  subject: string;
  status: string;
  priority: string;
};

export type AssistantUserSummary = {
  id: string;
  fullName: string;
  email: string;
};

export type AssistantLearningSummary = {
  trackId: string;
  title: string;
  status: string;
  progressPercent: number;
};

export type AssistantNewsSummary = {
  id: string;
  title: string;
  caption: string;
  postedByName: string;
  postedByRole: string;
  updatedAt: string;
};

export type AssistantTurnResult = {
  conversationId: string;
  reply: string;
  requiresConfirmation: boolean;
  draft: AssistantDealDraft | null;
  deals: AssistantDealSummary[];
  partners: AssistantPartnerSummary[];
  customers: AssistantCustomerSummary[];
  tasks: AssistantTaskSummary[];
  tickets: AssistantTicketSummary[];
  users: AssistantUserSummary[];
  learning: AssistantLearningSummary[];
  news: AssistantNewsSummary[];
  correlationId: string;
};
