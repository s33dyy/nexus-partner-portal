// Contracts for the in-app Assistant (chatbot). Scope is deliberately narrow:
// it may draft a new Deal for explicit confirmation, or answer questions
// about/list the caller's own authorised Deals — nothing else. The model is
// used only for intent classification and field extraction from free text;
// every business-relevant answer (deal lists, draft previews) is built by
// server code from real database rows, never invented by the model.

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

export type AssistantTurnResult = {
  conversationId: string;
  reply: string;
  requiresConfirmation: boolean;
  draft: AssistantDealDraft | null;
  deals: AssistantDealSummary[];
  correlationId: string;
};
