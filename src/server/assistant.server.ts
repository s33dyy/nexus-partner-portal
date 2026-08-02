import { randomUUID } from "node:crypto";

import {
  EMPTY_ASSISTANT_DEAL_DRAFT,
  REQUIRED_ASSISTANT_DEAL_FIELDS,
  type AssistantChatMessage,
  type AssistantCustomerSummary,
  type AssistantDealDraft,
  type AssistantDealSummary,
  type AssistantIntent,
  type AssistantLearningSummary,
  type AssistantPartnerSummary,
  type AssistantTaskSummary,
  type AssistantTicketSummary,
  type AssistantTurnResult,
  type AssistantUserSummary,
} from "@/domain/contracts/assistant";
import type { CommandExecutionResult } from "@/domain/contracts/commands";
import { ROLE_KEY_LABELS } from "@/domain/contracts/features";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { createDeal, resolveDealCommandActor } from "@/server/deal-commands.server";
import { listDropdownSourceValues } from "@/server/dropdown-sources.server";
import { getAuthContext, queryTable } from "@/server/livey-service.server";
import { runChatCompletion, type ChatCompletionResult } from "@/server/openrouter.server";
import { pool } from "@/server/postgres.server";
import { hasCapability, loadRoleCapabilities } from "@/server/rbac-policy.server";

// Every read below goes through queryTable() (the same RBAC-scoped path the
// rest of the app's pages use — table-policy.server.ts applies identical
// partner/ownership/geography scoping regardless of caller) or, for people
// search, listDropdownSourceValues() (the exact function the manual UI's own
// POC/account/client pickers call). Nothing here queries the database
// directly — the Assistant can never see more than the calling user's own
// UI already shows them, by construction rather than by a second policy
// implementation that could drift from the first.
const LIST_INTENT_TYPES = [
  "list_partners",
  "list_customers",
  "list_tasks",
  "list_tickets",
  "list_users",
  "list_learning",
] as const;
type ListIntentType = (typeof LIST_INTENT_TYPES)[number];

const SYSTEM_PROMPT = `You are the LIVEY PAM CRM Assistant. You help with:
(1) drafting a brand-new sales Deal from what the user tells you, for their explicit confirmation before anything is saved;
(2) searching or listing the user's own authorised Deals, Partners, Customers, Tasks, Support tickets, team members, and Insight Hub / Learning tracks.
Refuse anything else (any write other than drafting a Deal, approvals, role or permission changes, exports, deletions, unrelated chit-chat) by explaining this limitation in "reply".

Respond with ONLY a single minified JSON object, no markdown fences, no commentary outside the JSON, matching exactly this shape:
{"type":"list_deals"|"create_deal_draft"|"list_partners"|"list_customers"|"list_tasks"|"list_tickets"|"list_users"|"list_learning"|"none","reply":"short natural-language message for the user","stage":string|null,"status":string|null,"query":string|null,"draft":{"accountName":string|null,"contactName":string|null,"product":string|null,"quantity":number|null,"amount":string|null,"currencyCode":string|null,"country":string|null,"notes":string|null}|null}

Rules:
- Use "list_deals" when the user wants to see, count, or ask about their existing deals. Set "stage" to a pipeline stage keyword if mentioned (sourced, demo, testing, qualified, proposal, negotiation, approved, won, lost), else null. Set "status" similarly (e.g. "submitted", "approved"), else null.
- Use "create_deal_draft" when the user wants to create/register/log a new deal. Extract only fields the user actually gave into "draft" — leave anything unknown as null, never invent values. "reply" asks a short, specific question about the next missing required field (account/company name, contact/client name, product, and amount are all required), or says "Ready to create this deal — please confirm." once every required field has been given across the conversation.
- Use "list_partners" to search/list/show/count Partner accounts (resellers/distributors) — including phrasings like "list all partners", "how many partners", "show partner accounts". Use "list_customers" for Customers (end accounts, same phrasings). Use "list_tasks" for the user's Tasks. Use "list_tickets" for Support tickets. Use "list_users" to search for a colleague/team member by name. Use "list_learning" for Insight Hub tracks and the user's own learning progress/certificates. Any request to see, list, count, search, or ask about records of one of these kinds ALWAYS uses the matching list_* type, never "none" or "list_deals". For every one of these, set "query" to whatever search term the user gave (a name or keyword), or null if they just want everything in their scope. "reply" is a short one-sentence intro only ("Here are your partners.") — never put record names, companies, people, or counts in "reply" for these types; the actual list is attached separately by the system from real data, and repeating or guessing at it in "reply" would risk showing the user fabricated results.
- Use "none" for genuine greetings, out-of-scope requests (approvals, role/permission changes, exports, deletions), refusals, small talk, or a question about the current user's own identity (name, role, email, company/account — answer these directly and accurately from the "You are currently assisting" block below, never from memory or a guess). Other than that identity block, this path has no database access — "reply" must NEVER include a specific record name, company, person, count, date, or any other business fact you were not directly given. If a request sounds like it wants specific records of any kind, classify it as the closest matching list_* type above instead of "none", even if you are unsure — never fall back to "none" and improvise a data-shaped answer.
- Never claim to have created, changed, or deleted anything yourself — only the system creates a deal, and only after the user explicitly confirms a shown preview.`;

/** Every conversation is scoped to exactly one signed-in caller — sendAssistantMessage
 * resolves authContext fresh from the request's own session on every turn, never a
 * shared/global context — so this always reflects "the user's own instance," matching
 * the same identity every read/write in this file is already scoped by. Without this,
 * the model had no way to answer even "who am I" accurately and would either deflect
 * or (worse) guess. Kept deliberately minimal — just enough to answer identity
 * questions, not a dump of the full profile/assignment row. */
function buildIdentityContext(input: {
  fullName: string | null;
  email: string | null;
  roleKey: string | null;
  companyName: string | null;
}): string {
  const roleLabel = input.roleKey
    ? (ROLE_KEY_LABELS[input.roleKey as keyof typeof ROLE_KEY_LABELS] ?? input.roleKey)
    : "Unknown";
  const lines = [
    `You are currently assisting: ${input.fullName ?? "Unknown"}`,
    `Email: ${input.email ?? "Unknown"}`,
    `Role: ${roleLabel}`,
  ];
  if (input.companyName) lines.push(`Company/account: ${input.companyName}`);
  return lines.join("\n");
}

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
    // The model never resolves these — see resolveAccountOrClientMatch,
    // called from sendAssistantMessage after intent parsing.
    partnerId: null,
    customerId: null,
  };
}

function isListIntentType(value: unknown): value is ListIntentType {
  return typeof value === "string" && (LIST_INTENT_TYPES as readonly string[]).includes(value);
}

export function parseIntent(content: string): AssistantIntent {
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

  if (isListIntentType(parsed.type)) {
    const query = typeof parsed.query === "string" ? parsed.query.trim() || null : null;
    return { type: parsed.type, reply, query };
  }

  return {
    type: "none",
    reply:
      reply ||
      "I can help with Deals, Partners, Customers, Tasks, Tickets, Learning, and your team — what would you like to do?",
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

function matchesQuery(value: string, query: string | null): boolean {
  if (!query) return true;
  return value.toLowerCase().includes(query.toLowerCase());
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

async function fetchScopedPartners(searchTerm: string | null): Promise<AssistantPartnerSummary[]> {
  const { data, error } = await queryTable({
    table: "partners",
    operation: "select",
    filters: [],
    order: { column: "updated_at", ascending: false },
  });
  if (error || !Array.isArray(data)) return [];

  return data
    .filter((row: Record<string, unknown>) =>
      matchesQuery(String(row.company_name ?? ""), searchTerm),
    )
    .slice(0, 20)
    .map((row: Record<string, unknown>) => ({
      id: String(row.id),
      companyName: String(row.company_name ?? ""),
      tier: String(row.tier ?? ""),
      status: String(row.status ?? ""),
      country: String(row.country ?? ""),
    }));
}

async function fetchScopedCustomers(
  searchTerm: string | null,
): Promise<AssistantCustomerSummary[]> {
  const { data, error } = await queryTable({
    table: "portal_customers",
    operation: "select",
    filters: [],
    order: { column: "updated_at", ascending: false },
  });
  if (error || !Array.isArray(data)) return [];

  return data
    .filter((row: Record<string, unknown>) =>
      matchesQuery(String(row.company_name ?? ""), searchTerm),
    )
    .slice(0, 20)
    .map((row: Record<string, unknown>) => ({
      id: String(row.id),
      companyName: String(row.company_name ?? ""),
      segment: String(row.segment ?? ""),
      status: String(row.status ?? ""),
      region: String(row.region ?? ""),
    }));
}

async function fetchScopedTasks(searchTerm: string | null): Promise<AssistantTaskSummary[]> {
  const { data, error } = await queryTable({
    table: "tasks",
    operation: "select",
    filters: [],
    order: { column: "updated_at", ascending: false },
  });
  if (error || !Array.isArray(data)) return [];

  return data
    .filter((row: Record<string, unknown>) => matchesQuery(String(row.title ?? ""), searchTerm))
    .slice(0, 20)
    .map((row: Record<string, unknown>) => ({
      id: String(row.id),
      title: String(row.title ?? ""),
      status: String(row.status ?? ""),
      priority: String(row.priority ?? ""),
      dueAt: row.due_at ? String(row.due_at) : null,
    }));
}

async function fetchScopedTickets(searchTerm: string | null): Promise<AssistantTicketSummary[]> {
  const { data, error } = await queryTable({
    table: "support_tickets",
    operation: "select",
    filters: [],
    order: { column: "updated_at", ascending: false },
  });
  if (error || !Array.isArray(data)) return [];

  return data
    .filter((row: Record<string, unknown>) => matchesQuery(String(row.subject ?? ""), searchTerm))
    .slice(0, 20)
    .map((row: Record<string, unknown>) => ({
      id: String(row.id),
      subject: String(row.subject ?? ""),
      status: String(row.status ?? ""),
      priority: String(row.priority ?? ""),
    }));
}

async function fetchScopedUsers(searchTerm: string | null): Promise<AssistantUserSummary[]> {
  const rows = await listDropdownSourceValues({ source: "poc", q: searchTerm ?? undefined });
  return rows.slice(0, 20).map((row) => ({
    id: row.id,
    fullName: row.label,
    email: row.description ?? "",
  }));
}

async function fetchScopedLearning(
  searchTerm: string | null,
  userId: string,
): Promise<AssistantLearningSummary[]> {
  const { data: trackData, error: trackError } = await queryTable({
    table: "learning_tracks",
    operation: "select",
    filters: [{ column: "is_published", value: true, operator: "eq" }],
    order: { column: "created_at", ascending: true },
  });
  if (trackError || !Array.isArray(trackData)) return [];

  const { data: enrollData } = await queryTable({
    table: "learning_enrollments",
    operation: "select",
    filters: [{ column: "user_id", value: userId, operator: "eq" }],
  });
  const enrollmentByTrack = new Map(
    (Array.isArray(enrollData) ? enrollData : []).map((row: Record<string, unknown>) => [
      String(row.track_id),
      row,
    ]),
  );

  return trackData
    .filter((row: Record<string, unknown>) => matchesQuery(String(row.title ?? ""), searchTerm))
    .slice(0, 20)
    .map((row: Record<string, unknown>) => {
      const enrollment = enrollmentByTrack.get(String(row.id));
      return {
        trackId: String(row.id),
        title: String(row.title ?? ""),
        status: enrollment ? String(enrollment.status ?? "in_progress") : "not_enrolled",
        progressPercent: enrollment ? Number(enrollment.progress_percent ?? 0) : 0,
      };
    });
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

function formatPartnersSummary(partners: AssistantPartnerSummary[]): string {
  if (partners.length === 0) return "No matching partners found in your current scope.";
  return partners
    .map((p) => `• ${p.companyName} — ${p.tier || "no tier"} — ${p.status} — ${p.country}`)
    .join("\n");
}

function formatCustomersSummary(customers: AssistantCustomerSummary[]): string {
  if (customers.length === 0) return "No matching customers found in your current scope.";
  return customers
    .map((c) => `• ${c.companyName} — ${c.segment || "unsegmented"} — ${c.status} — ${c.region}`)
    .join("\n");
}

function formatTasksSummary(tasks: AssistantTaskSummary[]): string {
  if (tasks.length === 0) return "No matching tasks found in your current scope.";
  return tasks
    .map(
      (t) =>
        `• ${t.title} — ${t.status}/${t.priority}${t.dueAt ? ` — due ${new Date(t.dueAt).toLocaleDateString()}` : ""}`,
    )
    .join("\n");
}

function formatTicketsSummary(tickets: AssistantTicketSummary[]): string {
  if (tickets.length === 0) return "No matching support tickets found in your current scope.";
  return tickets.map((t) => `• ${t.subject} — ${t.status}/${t.priority}`).join("\n");
}

function formatUsersSummary(users: AssistantUserSummary[]): string {
  if (users.length === 0) return "No matching team members found.";
  return users.map((u) => `• ${u.fullName}${u.email ? ` — ${u.email}` : ""}`).join("\n");
}

function formatLearningSummary(tracks: AssistantLearningSummary[]): string {
  if (tracks.length === 0) return "No learning tracks available yet.";
  return tracks
    .map((t) => `• ${t.title} — ${t.status.replace(/_/g, " ")} (${t.progressPercent}%)`)
    .join("\n");
}

function formatDraftPreview(draft: AssistantDealDraft): string {
  return [
    `Account: ${draft.accountName}${draft.partnerId ? " (existing account)" : ""}`,
    `Contact: ${draft.contactName}${draft.customerId ? " (existing client)" : ""}`,
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

type AccountMatch =
  | { kind: "match"; id: string; label: string }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "none" };

/** Mirrors what deals.tsx's own Account/Client LookupCombobox fields already
 * do (dropdown-sources.server.ts's "account"/"client" search) — this is the
 * literal "search existing records instead of always creating new" behavior:
 * an exact (case-insensitive) name match links the draft to the real
 * Partner/Customer row instead of leaving it as an unlinked free-text name. */
async function resolveAccountOrClientMatch(
  source: "account" | "client",
  name: string,
): Promise<AccountMatch> {
  const rows = await listDropdownSourceValues({ source, q: name });
  if (rows.length === 0) return { kind: "none" };

  const normalized = name.trim().toLowerCase();
  const exact = rows.filter((row) => row.label.trim().toLowerCase() === normalized);
  if (exact.length === 1) return { kind: "match", id: exact[0].id, label: exact[0].label };
  if (rows.length === 1) return { kind: "match", id: rows[0].id, label: rows[0].label };
  return { kind: "ambiguous", candidates: rows.slice(0, 5).map((row) => row.label) };
}

async function resolveDraftLinks(
  draft: AssistantDealDraft,
): Promise<{ draft: AssistantDealDraft; note: string | null }> {
  let resolved = draft;
  const notes: string[] = [];

  if (resolved.accountName && !resolved.partnerId) {
    const match = await resolveAccountOrClientMatch("account", resolved.accountName);
    if (match.kind === "match") {
      resolved = { ...resolved, partnerId: match.id, accountName: match.label };
      notes.push(`Using existing account "${match.label}".`);
    } else if (match.kind === "ambiguous") {
      notes.push(
        `A few existing accounts look similar: ${match.candidates.join(", ")}. Tell me which one, or say "new" to create "${resolved.accountName}" as a new account.`,
      );
    }
  }

  if (resolved.contactName && !resolved.customerId) {
    const match = await resolveAccountOrClientMatch("client", resolved.contactName);
    if (match.kind === "match") {
      resolved = { ...resolved, customerId: match.id, contactName: match.label };
      notes.push(`Using existing client "${match.label}".`);
    } else if (match.kind === "ambiguous") {
      notes.push(
        `A few existing clients look similar: ${match.candidates.join(", ")}. Tell me which one, or say "new" to create "${resolved.contactName}" as new.`,
      );
    }
  }

  return { draft: resolved, note: notes.length > 0 ? notes.join(" ") : null };
}

const EMPTY_LIST_RESULTS = {
  deals: [] as AssistantDealSummary[],
  partners: [] as AssistantPartnerSummary[],
  customers: [] as AssistantCustomerSummary[],
  tasks: [] as AssistantTaskSummary[],
  tickets: [] as AssistantTicketSummary[],
  users: [] as AssistantUserSummary[],
  learning: [] as AssistantLearningSummary[],
};

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
    correlationId,
    ...EMPTY_LIST_RESULTS,
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

  const capabilities = await loadRoleCapabilities(authContext.assignment?.roleKey ?? null);

  if (!hasCapability(capabilities, "assistant", "read")) {
    const reply = "Your role doesn't have access to the Assistant.";
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
      outcome: "refused_no_capability",
      model: null,
      correlationId,
    });
    return { ...empty, reply };
  }

  const identityContext = buildIdentityContext({
    fullName: authContext.profile?.full_name ?? null,
    email: authContext.profile?.email ?? null,
    roleKey: authContext.assignment?.roleKey ?? null,
    companyName: authContext.profile?.company_name ?? null,
  });

  let completion: ChatCompletionResult;
  try {
    completion = await runChatCompletion({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: identityContext },
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

  if (intent.type === "list_deals" && !hasCapability(capabilities, "deals", "read")) {
    const reply = "Your role doesn't have permission to view deals through the Assistant.";
    await logAssistantMessage({
      conversationId,
      userId,
      assignmentId,
      role: "assistant",
      content: reply,
      proposedAction: "list_deals",
      actionPayload: null,
      retrievedDealIds: [],
      confirmed: null,
      outcome: "refused_no_capability",
      model: completion.model,
      correlationId,
    });
    return { ...empty, reply };
  }

  if (intent.type === "create_deal_draft" && !hasCapability(capabilities, "deals", "create")) {
    const reply = "Your role doesn't have permission to create deals through the Assistant.";
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
      outcome: "refused_no_capability",
      model: completion.model,
      correlationId,
    });
    return { ...empty, reply };
  }

  // list_partners/list_customers/list_tasks/list_tickets/list_learning each
  // sit behind the same feature capability the equivalent page does;
  // list_users has no gate, matching the ungated person-search picker
  // (LookupCombobox source="poc") every role already uses on Deal/
  // participant-tagging forms today.
  if (
    intent.type === "list_partners" ||
    intent.type === "list_customers" ||
    intent.type === "list_tasks" ||
    intent.type === "list_tickets" ||
    intent.type === "list_learning"
  ) {
    const featureKey =
      intent.type === "list_partners"
        ? "partners"
        : intent.type === "list_customers"
          ? "customers"
          : intent.type === "list_tasks"
            ? "tasks"
            : intent.type === "list_tickets"
              ? "tickets"
              : "learning";
    if (!hasCapability(capabilities, featureKey, "read")) {
      const reply = `Your role doesn't have permission to view ${featureKey} through the Assistant.`;
      await logAssistantMessage({
        conversationId,
        userId,
        assignmentId,
        role: "assistant",
        content: reply,
        proposedAction: intent.type,
        actionPayload: { query: intent.query },
        retrievedDealIds: [],
        confirmed: null,
        outcome: "refused_no_capability",
        model: completion.model,
        correlationId,
      });
      return { ...empty, reply };
    }
  }

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

  if (intent.type === "list_partners") {
    const partners = await fetchScopedPartners(intent.query);
    const reply = [intent.reply, formatPartnersSummary(partners)].filter(Boolean).join("\n\n");
    await logAssistantMessage({
      conversationId,
      userId,
      assignmentId,
      role: "assistant",
      content: reply,
      proposedAction: "list_partners",
      actionPayload: { query: intent.query },
      retrievedDealIds: [],
      confirmed: null,
      outcome: "answered",
      model: completion.model,
      correlationId,
    });
    return { ...empty, reply, partners };
  }

  if (intent.type === "list_customers") {
    const customers = await fetchScopedCustomers(intent.query);
    const reply = [intent.reply, formatCustomersSummary(customers)].filter(Boolean).join("\n\n");
    await logAssistantMessage({
      conversationId,
      userId,
      assignmentId,
      role: "assistant",
      content: reply,
      proposedAction: "list_customers",
      actionPayload: { query: intent.query },
      retrievedDealIds: [],
      confirmed: null,
      outcome: "answered",
      model: completion.model,
      correlationId,
    });
    return { ...empty, reply, customers };
  }

  if (intent.type === "list_tasks") {
    const tasks = await fetchScopedTasks(intent.query);
    const reply = [intent.reply, formatTasksSummary(tasks)].filter(Boolean).join("\n\n");
    await logAssistantMessage({
      conversationId,
      userId,
      assignmentId,
      role: "assistant",
      content: reply,
      proposedAction: "list_tasks",
      actionPayload: { query: intent.query },
      retrievedDealIds: [],
      confirmed: null,
      outcome: "answered",
      model: completion.model,
      correlationId,
    });
    return { ...empty, reply, tasks };
  }

  if (intent.type === "list_tickets") {
    const tickets = await fetchScopedTickets(intent.query);
    const reply = [intent.reply, formatTicketsSummary(tickets)].filter(Boolean).join("\n\n");
    await logAssistantMessage({
      conversationId,
      userId,
      assignmentId,
      role: "assistant",
      content: reply,
      proposedAction: "list_tickets",
      actionPayload: { query: intent.query },
      retrievedDealIds: [],
      confirmed: null,
      outcome: "answered",
      model: completion.model,
      correlationId,
    });
    return { ...empty, reply, tickets };
  }

  if (intent.type === "list_users") {
    const users = await fetchScopedUsers(intent.query);
    const reply = [intent.reply, formatUsersSummary(users)].filter(Boolean).join("\n\n");
    await logAssistantMessage({
      conversationId,
      userId,
      assignmentId,
      role: "assistant",
      content: reply,
      proposedAction: "list_users",
      actionPayload: { query: intent.query },
      retrievedDealIds: [],
      confirmed: null,
      outcome: "answered",
      model: completion.model,
      correlationId,
    });
    return { ...empty, reply, users };
  }

  if (intent.type === "list_learning") {
    const learning = await fetchScopedLearning(intent.query, userId);
    const reply = [intent.reply, formatLearningSummary(learning)].filter(Boolean).join("\n\n");
    await logAssistantMessage({
      conversationId,
      userId,
      assignmentId,
      role: "assistant",
      content: reply,
      proposedAction: "list_learning",
      actionPayload: { query: intent.query },
      retrievedDealIds: [],
      confirmed: null,
      outcome: "answered",
      model: completion.model,
      correlationId,
    });
    return { ...empty, reply, learning };
  }

  if (intent.type === "create_deal_draft") {
    const { draft, note } = await resolveDraftLinks(intent.draft);
    const missing = missingDraftFields(draft);

    if (missing.length > 0) {
      const reply = [note, intent.reply || `I still need: ${missing.join(", ")}.`]
        .filter(Boolean)
        .join("\n\n");
      await logAssistantMessage({
        conversationId,
        userId,
        assignmentId,
        role: "assistant",
        content: reply,
        proposedAction: "create_deal_draft",
        actionPayload: draft,
        retrievedDealIds: [],
        confirmed: null,
        outcome: "draft_incomplete",
        model: completion.model,
        correlationId,
      });
      return { ...empty, reply, draft };
    }

    const reply = [note, `${formatDraftPreview(draft)}\n\nConfirm to create this deal.`]
      .filter(Boolean)
      .join("\n\n");
    await logAssistantMessage({
      conversationId,
      userId,
      assignmentId,
      role: "assistant",
      content: reply,
      proposedAction: "create_deal_draft",
      actionPayload: draft,
      retrievedDealIds: [],
      confirmed: null,
      outcome: "draft_ready",
      model: completion.model,
      correlationId,
    });
    return { ...empty, reply, draft, requiresConfirmation: true };
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

  const capabilities = await loadRoleCapabilities(authContext.assignment?.roleKey ?? null);
  if (!hasCapability(capabilities, "deals", "create")) {
    const reply = "Your role doesn't have permission to create deals through the Assistant.";
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
      outcome: "refused_no_capability",
      model: null,
      correlationId,
    });
    return {
      reply,
      result: {
        ok: false,
        failure: {
          code: "POLICY_DENIED",
          message: "Access denied",
          subjectId: null,
          reason: "Role lacks deals.create capability",
          retryable: false,
          mayRevealRecordExistence: false,
        },
        correlationId,
      },
      correlationId,
    };
  }

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
      partnerId: draft.partnerId ?? null,
      customerId: draft.customerId ?? null,
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
