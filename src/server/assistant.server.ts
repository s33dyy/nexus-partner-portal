import { randomUUID } from "node:crypto";

import {
  EMPTY_ASSISTANT_DEAL_DRAFT,
  REQUIRED_ASSISTANT_DEAL_FIELDS,
  type AssistantChatMessage,
  type AssistantDealDraft,
  type AssistantDealSummary,
  type AssistantIntent,
  type AssistantTurnResult,
} from "@/domain/contracts/assistant";
import type { CommandExecutionResult } from "@/domain/contracts/commands";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { createDeal, resolveDealCommandActor } from "@/server/deal-commands.server";
import { getAuthContext, queryTable } from "@/server/livey-service.server";
import { runChatCompletion, type ChatCompletionResult } from "@/server/openrouter.server";
import { pool } from "@/server/postgres.server";

// The assistant is scoped to exactly two capabilities: drafting a new Deal
// for explicit confirmation, and describing/listing the caller's own
// authorised Deals. The model only classifies intent and extracts fields
// from free text — every deal list and draft preview shown to the user is
// built by this server code from real database rows, never invented by the
// model (blueprint §12.3/§12.4: retrieval and previews are server-side and
// authorised, the model never fabricates record content).
const SYSTEM_PROMPT = `You are the LIVEY PAM CRM Assistant. You ONLY help with two things:
(1) drafting a brand-new sales Deal from what the user tells you, for their explicit confirmation before anything is saved, and
(2) describing or listing the user's own existing Deals.
Refuse anything else (other CRM objects, deleting anything, approvals, role changes, exports, unrelated chit-chat) by explaining this limitation in "reply".

Respond with ONLY a single minified JSON object, no markdown fences, no commentary outside the JSON, matching exactly this shape:
{"type":"list_deals"|"create_deal_draft"|"none","reply":"short natural-language message for the user","stage":string|null,"status":string|null,"draft":{"accountName":string|null,"contactName":string|null,"product":string|null,"quantity":number|null,"amount":string|null,"currencyCode":string|null,"country":string|null,"notes":string|null}|null}

Rules:
- Use "list_deals" when the user wants to see, count, or ask about their existing deals. Set "stage" to a pipeline stage keyword if mentioned (sourced, demo, testing, qualified, proposal, negotiation, approved, won, lost), else null. Set "status" similarly (e.g. "submitted", "approved"), else null. "reply" is a short one-sentence intro only — the deal list itself is attached separately by the system.
- Use "create_deal_draft" when the user wants to create/register/log a new deal. Extract only fields the user actually gave into "draft" — leave anything unknown as null, never invent values. "reply" asks a short, specific question about the next missing required field (account/company name, contact/client name, product, and amount are all required), or says "Ready to create this deal — please confirm." once every required field has been given across the conversation.
- Use "none" for anything else — greetings, out-of-scope requests, refusals, or clarifications not covered above. "reply" is your full natural-language answer.
- Never claim to have created, changed, or deleted anything yourself — only the system creates a deal, and only after the user explicitly confirms a shown preview.`;

function parseModelJson(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    const value = JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function coerceDraft(value: unknown): AssistantDealDraft {
  if (typeof value !== "object" || value === null) return { ...EMPTY_ASSISTANT_DEAL_DRAFT };
  const raw = value as Record<string, unknown>;
  const str = (key: string) =>
    typeof raw[key] === "string" && raw[key] ? (raw[key] as string) : null;
  const num = (key: string) =>
    typeof raw[key] === "number" && Number.isFinite(raw[key]) ? (raw[key] as number) : null;
  return {
    accountName: str("accountName"),
    contactName: str("contactName"),
    product: str("product"),
    quantity: num("quantity"),
    amount: str("amount"),
    currencyCode: str("currencyCode"),
    country: str("country"),
    notes: str("notes"),
  };
}

function parseIntent(content: string): AssistantIntent {
  const parsed = parseModelJson(content);
  if (!parsed) {
    const fallback = content.trim().slice(0, 2000);
    return { type: "none", reply: fallback || "I didn't understand that — could you rephrase?" };
  }

  const reply = typeof parsed.reply === "string" ? parsed.reply.slice(0, 2000) : "";

  if (parsed.type === "list_deals") {
    return {
      type: "list_deals",
      reply,
      stage: typeof parsed.stage === "string" ? parsed.stage.trim().toLowerCase() || null : null,
      status: typeof parsed.status === "string" ? parsed.status.trim().toLowerCase() || null : null,
    };
  }

  if (parsed.type === "create_deal_draft") {
    return { type: "create_deal_draft", reply, draft: coerceDraft(parsed.draft) };
  }

  return {
    type: "none",
    reply: reply || "I can help you create or view deals — what would you like to do?",
  };
}

async function logAssistantMessage(entry: {
  conversationId: string;
  userId: string | null;
  assignmentId: string | null;
  role: "user" | "assistant";
  content: string;
  proposedAction: string | null;
  actionPayload: Record<string, unknown> | null;
  retrievedDealIds: string[];
  confirmed: boolean | null;
  outcome: string | null;
  model: string | null;
  correlationId: string;
}) {
  await pool.query(
    `INSERT INTO assistant_messages (
       conversation_id, user_id, assignment_id, role, content, proposed_action,
       action_payload, retrieved_deal_ids, confirmed, outcome, model, correlation_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      entry.conversationId,
      entry.userId,
      entry.assignmentId,
      entry.role,
      entry.content,
      entry.proposedAction,
      entry.actionPayload ? JSON.stringify(entry.actionPayload) : null,
      entry.retrievedDealIds,
      entry.confirmed,
      entry.outcome,
      entry.model,
      entry.correlationId,
    ],
  );
}

async function fetchScopedDeals(filters: {
  stage: string | null;
  status: string | null;
}): Promise<AssistantDealSummary[]> {
  const queryFilters: Array<{ column: string; value: unknown; operator: "eq" }> = [];
  if (filters.stage) queryFilters.push({ column: "stage", value: filters.stage, operator: "eq" });
  if (filters.status)
    queryFilters.push({ column: "status", value: filters.status, operator: "eq" });

  const { data, error } = await queryTable({
    table: "portal_deals",
    operation: "select",
    filters: queryFilters,
    order: { column: "updated_at", ascending: false },
  });

  if (error || !Array.isArray(data)) return [];

  return data.slice(0, 20).map((row: Record<string, unknown>) => ({
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

function formatDealsSummary(deals: AssistantDealSummary[]): string {
  if (deals.length === 0) return "No matching deals found in your current scope.";
  return deals
    .map(
      (deal) =>
        `• ${deal.accountName} — ${deal.product} — ${deal.stage}/${deal.status} — ${deal.currencyCode} ${deal.amount}`,
    )
    .join("\n");
}

function formatDraftPreview(draft: AssistantDealDraft): string {
  return [
    `Account: ${draft.accountName}`,
    `Contact: ${draft.contactName}`,
    `Product: ${draft.product}`,
    draft.quantity ? `Quantity: ${draft.quantity}` : null,
    `Amount: ${draft.currencyCode ?? "USD"} ${draft.amount}`,
    draft.country ? `Country: ${draft.country}` : null,
    draft.notes ? `Notes: ${draft.notes}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function missingDraftFields(draft: AssistantDealDraft): string[] {
  return REQUIRED_ASSISTANT_DEAL_FIELDS.filter((field) => !draft[field]?.toString().trim());
}

export async function sendAssistantMessage(input: {
  conversationId?: string | null;
  message: string;
  history: AssistantChatMessage[];
}): Promise<AssistantTurnResult> {
  const correlationId = createCorrelationId();
  const conversationId = input.conversationId ?? randomUUID();
  const authContext = await getAuthContext();
  const userId = authContext.session?.user.id ?? null;
  const assignmentId = authContext.assignment?.assignmentId ?? null;
  const message = input.message.trim();

  const empty: AssistantTurnResult = {
    conversationId,
    reply: "",
    requiresConfirmation: false,
    draft: null,
    deals: [],
    correlationId,
  };

  if (!message) {
    return { ...empty, reply: "Type a message to get started." };
  }

  await logAssistantMessage({
    conversationId,
    userId,
    assignmentId,
    role: "user",
    content: message,
    proposedAction: null,
    actionPayload: null,
    retrievedDealIds: [],
    confirmed: null,
    outcome: null,
    model: null,
    correlationId,
  });

  if (!userId || !authContext.activeContext) {
    const reply = "Sign in with an active assignment to use the assistant.";
    await logAssistantMessage({
      conversationId,
      userId,
      assignmentId,
      role: "assistant",
      content: reply,
      proposedAction: null,
      actionPayload: null,
      retrievedDealIds: [],
      confirmed: null,
      outcome: "refused_no_context",
      model: null,
      correlationId,
    });
    return { ...empty, reply };
  }

  let completion: ChatCompletionResult;
  try {
    completion = await runChatCompletion({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...input.history.slice(-12),
        { role: "user", content: message },
      ],
    });
  } catch {
    const reply = "The assistant is temporarily unavailable. Please try again shortly.";
    await logAssistantMessage({
      conversationId,
      userId,
      assignmentId,
      role: "assistant",
      content: reply,
      proposedAction: null,
      actionPayload: null,
      retrievedDealIds: [],
      confirmed: null,
      outcome: "error",
      model: null,
      correlationId,
    });
    return { ...empty, reply };
  }

  const intent = parseIntent(completion.content);

  if (intent.type === "list_deals") {
    const deals = await fetchScopedDeals({ stage: intent.stage, status: intent.status });
    const reply = [intent.reply, formatDealsSummary(deals)].filter(Boolean).join("\n\n");
    await logAssistantMessage({
      conversationId,
      userId,
      assignmentId,
      role: "assistant",
      content: reply,
      proposedAction: "list_deals",
      actionPayload: { stage: intent.stage, status: intent.status },
      retrievedDealIds: deals.map((deal) => deal.id),
      confirmed: null,
      outcome: "answered",
      model: completion.model,
      correlationId,
    });
    return { ...empty, reply, deals };
  }

  if (intent.type === "create_deal_draft") {
    const missing = missingDraftFields(intent.draft);
    if (missing.length > 0) {
      const reply = intent.reply || `I still need: ${missing.join(", ")}.`;
      await logAssistantMessage({
        conversationId,
        userId,
        assignmentId,
        role: "assistant",
        content: reply,
        proposedAction: "create_deal_draft",
        actionPayload: intent.draft,
        retrievedDealIds: [],
        confirmed: null,
        outcome: "draft_incomplete",
        model: completion.model,
        correlationId,
      });
      return { ...empty, reply, draft: intent.draft };
    }

    const reply = `${formatDraftPreview(intent.draft)}\n\nConfirm to create this deal.`;
    await logAssistantMessage({
      conversationId,
      userId,
      assignmentId,
      role: "assistant",
      content: reply,
      proposedAction: "create_deal_draft",
      actionPayload: intent.draft,
      retrievedDealIds: [],
      confirmed: null,
      outcome: "draft_ready",
      model: completion.model,
      correlationId,
    });
    return { ...empty, reply, draft: intent.draft, requiresConfirmation: true };
  }

  await logAssistantMessage({
    conversationId,
    userId,
    assignmentId,
    role: "assistant",
    content: intent.reply,
    proposedAction: null,
    actionPayload: null,
    retrievedDealIds: [],
    confirmed: null,
    outcome: "answered",
    model: completion.model,
    correlationId,
  });
  return { ...empty, reply: intent.reply };
}

export async function confirmAssistantDeal(input: {
  conversationId: string;
  draft: AssistantDealDraft;
}): Promise<{ reply: string; result: CommandExecutionResult; correlationId: string }> {
  const correlationId = createCorrelationId();
  const authContext = await getAuthContext();
  const userId = authContext.session?.user.id ?? null;
  const assignmentId = authContext.assignment?.assignmentId ?? null;

  const actorResult = resolveDealCommandActor({
    userId,
    assignment: authContext.assignment,
    activeContext: authContext.activeContext,
  });

  if (!actorResult.ok) {
    const reply = "Your session no longer has an active assignment — sign in again to continue.";
    await logAssistantMessage({
      conversationId: input.conversationId,
      userId,
      assignmentId,
      role: "assistant",
      content: reply,
      proposedAction: "create_deal_draft",
      actionPayload: input.draft,
      retrievedDealIds: [],
      confirmed: true,
      outcome: "error",
      model: null,
      correlationId,
    });
    return {
      reply,
      result: { ok: false, failure: actorResult.failure, correlationId },
      correlationId,
    };
  }

  const draft = input.draft;
  const result = await createDeal({
    actor: actorResult.actor,
    data: {
      accountName: draft.accountName ?? "",
      contactName: draft.contactName ?? "",
      product: draft.product ?? "",
      quantity: draft.quantity ?? 1,
      amount: draft.amount ?? "",
      currencyCode: draft.currencyCode ?? "USD",
      country: draft.country ?? null,
      notes: draft.notes ?? null,
      source: "assistant",
    },
  });

  const reply = result.ok
    ? `Created the deal for ${draft.accountName}. You can find it in Pipeline.`
    : `Couldn't create that deal: ${result.failure.message}`;

  await logAssistantMessage({
    conversationId: input.conversationId,
    userId,
    assignmentId,
    role: "assistant",
    content: reply,
    proposedAction: "create_deal_draft",
    actionPayload: draft,
    retrievedDealIds: result.ok ? [result.subjectId] : [],
    confirmed: true,
    outcome: result.ok ? "deal_created" : "error",
    model: null,
    correlationId,
  });

  return { reply, result, correlationId };
}
