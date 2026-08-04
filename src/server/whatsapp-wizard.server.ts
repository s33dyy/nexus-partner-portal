// Deterministic, LLM-free multi-step flows for the WhatsApp channel — a
// tappable menu path through the same governed reads/writes the free-text
// Assistant uses (fetchScoped*, resolveAccountOrClientMatch, createDeal),
// but with server-tracked step state instead of asking a cheap auto-selected
// model to correctly re-infer "what step are we on" from conversation
// history every turn. That inference is exactly what was flaking on real
// WhatsApp traffic (see: account-name loop that never advanced past a
// misheard correction) — a real state machine can't misunderstand its own
// state the way a language model re-reading transcript can.
import { EMPTY_ASSISTANT_DEAL_DRAFT, type AssistantDealDraft } from "@/domain/contracts/assistant";
import {
  confirmDealDraft,
  fetchScopedCustomers,
  fetchScopedDeals,
  fetchScopedLearning,
  fetchScopedNews,
  fetchScopedPartners,
  fetchScopedTasks,
  fetchScopedTickets,
  formatCustomersSummary,
  formatDealsSummary,
  formatLearningSummary,
  formatNewsSummary,
  formatPartnersSummary,
  formatTasksSummary,
  formatTicketsSummary,
  resolveAccountOrClientMatch,
  toDropdownCallerAuth,
  toTablePolicyAuthContext,
} from "@/server/assistant.server";
import type { FeatureKey } from "@/domain/contracts/features";
import type { AuthContext } from "@/server/livey-service.server";
import { pool } from "@/server/postgres.server";
import { hasCapability, loadRoleCapabilities } from "@/server/rbac-policy.server";

export type SendInstruction =
  | { kind: "text"; body: string }
  | {
      kind: "list";
      body: string;
      button: string;
      items: Array<{ id: string; item: string; description?: string }>;
    }
  | { kind: "quickReply"; body: string; actions: Array<{ id: string; title: string }> };

type WizardFlow =
  | "create_deal"
  | "browse_deals"
  | "browse_partners"
  | "browse_customers"
  | "browse_tasks"
  | "browse_tickets"
  | "browse_learning"
  | "browse_news";

type CreateDealStep =
  | "account"
  | "contact"
  | "product"
  | "quantity"
  | "amount"
  | "extra"
  | "confirm";

type WizardState = {
  flow: WizardFlow;
  step: string;
  data: Record<string, unknown>;
};

const MENU_ID_TO_FLOW: Record<string, WizardFlow> = {
  menu_deals: "browse_deals",
  menu_partners: "browse_partners",
  menu_customers: "browse_customers",
  menu_tasks: "browse_tasks",
  menu_tickets: "browse_tickets",
  menu_learning: "browse_learning",
  menu_news: "browse_news",
  menu_create_deal: "create_deal",
};

const CANCEL_WORDS = new Set(["cancel", "stop", "quit", "exit"]);
const SKIP_WORDS = new Set(["skip", "none", "no", "n/a"]);
const ACCOUNT_PICK_PREFIX = "wz_acct_";
const CONTACT_PICK_PREFIX = "wz_cust_";
const NEW_ACCOUNT_ID = "wz_new_account";
const NEW_CONTACT_ID = "wz_new_contact";
const STAGE_PICK_PREFIX = "wz_stage_";

async function getWizardState(conversationId: string): Promise<WizardState | null> {
  const res = await pool.query<{ flow: WizardFlow; step: string; data: Record<string, unknown> }>(
    `SELECT flow, step, data FROM whatsapp_wizard_state WHERE conversation_id = $1 LIMIT 1`,
    [conversationId],
  );
  const row = res.rows[0];
  return row ? { flow: row.flow, step: row.step, data: row.data ?? {} } : null;
}

async function setWizardState(
  conversationId: string,
  flow: WizardFlow,
  step: string,
  data: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `INSERT INTO whatsapp_wizard_state (conversation_id, flow, step, data, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (conversation_id) DO UPDATE
       SET flow = EXCLUDED.flow, step = EXCLUDED.step, data = EXCLUDED.data, updated_at = now()`,
    [conversationId, flow, step, JSON.stringify(data)],
  );
}

export async function clearWizardState(conversationId: string): Promise<void> {
  await pool.query(`DELETE FROM whatsapp_wizard_state WHERE conversation_id = $1`, [
    conversationId,
  ]);
}

type TurnInput = {
  conversationId: string;
  authContext: AuthContext;
  listId: string;
  buttonPayload: string;
  bodyText: string;
};

export async function handleWizardTurn(
  input: TurnInput,
): Promise<{ handled: boolean; sends: SendInstruction[] }> {
  const state = await getWizardState(input.conversationId);

  if (
    state &&
    (input.buttonPayload === "wizard_cancel" || CANCEL_WORDS.has(input.bodyText.toLowerCase()))
  ) {
    await clearWizardState(input.conversationId);
    return { handled: true, sends: [{ kind: "text", body: "Cancelled." }] };
  }

  if (!state) {
    const flow = input.listId ? MENU_ID_TO_FLOW[input.listId] : undefined;
    if (!flow) return { handled: false, sends: [] };
    return startFlow(flow, input);
  }

  if (state.flow === "create_deal") {
    return stepCreateDeal(state, input);
  }
  // The only browse_* flow with more than one step: browse_deals' "stage"
  // step, waiting for a wz_stage_* tap. Every other browse_* flow answers
  // immediately on start and never leaves state behind to resume here.
  if (
    state.flow === "browse_deals" &&
    state.step === "stage" &&
    input.listId.startsWith(STAGE_PICK_PREFIX)
  ) {
    const stage = input.listId.slice(STAGE_PICK_PREFIX.length);
    return runBrowseFlow("browse_deals", input, stage);
  }
  await clearWizardState(input.conversationId);
  return { handled: false, sends: [] };
}

async function startFlow(
  flow: WizardFlow,
  input: TurnInput,
): Promise<{ handled: boolean; sends: SendInstruction[] }> {
  if (flow === "create_deal") {
    return startCreateDeal(input);
  }
  return runBrowseFlow(flow, input);
}

// ---- Browsing flows ---------------------------------------------------

const BROWSE_FEATURE_KEY: Record<Exclude<WizardFlow, "create_deal">, FeatureKey> = {
  browse_deals: "deals",
  browse_partners: "partners",
  browse_customers: "customers",
  browse_tasks: "tasks",
  browse_tickets: "tickets",
  browse_learning: "learning",
  browse_news: "news",
};

async function runBrowseFlow(
  flow: Exclude<WizardFlow, "create_deal">,
  input: TurnInput,
  stageFilter?: string,
): Promise<{ handled: boolean; sends: SendInstruction[] }> {
  const { authContext } = input;
  const capabilities = await loadRoleCapabilities(authContext.assignment?.roleKey ?? null);
  const featureKey = BROWSE_FEATURE_KEY[flow];
  if (!hasCapability(capabilities, featureKey, "read")) {
    return {
      handled: true,
      sends: [{ kind: "text", body: `Your role doesn't have permission to view ${featureKey}.` }],
    };
  }

  // Deals get one extra deterministic step — pick a pipeline stage to
  // filter by, or "All" — since it's the highest-value, highest-volume
  // record type. Every other type is a single immediate fetch.
  if (flow === "browse_deals" && stageFilter === undefined) {
    await setWizardState(input.conversationId, "browse_deals", "stage", {});
    return {
      handled: true,
      sends: [
        {
          kind: "list",
          body: "Filter deals by stage, or pick All.",
          button: "Select",
          items: [
            { id: `${STAGE_PICK_PREFIX}all`, item: "All" },
            { id: `${STAGE_PICK_PREFIX}sourced`, item: "Sourced" },
            { id: `${STAGE_PICK_PREFIX}demo`, item: "Demo" },
            { id: `${STAGE_PICK_PREFIX}qualified`, item: "Qualified" },
            { id: `${STAGE_PICK_PREFIX}proposal`, item: "Proposal" },
            { id: `${STAGE_PICK_PREFIX}negotiation`, item: "Negotiation" },
            { id: `${STAGE_PICK_PREFIX}won`, item: "Won" },
            { id: `${STAGE_PICK_PREFIX}lost`, item: "Lost" },
          ],
        },
      ],
    };
  }

  await clearWizardState(input.conversationId);
  const policyCtx = toTablePolicyAuthContext(authContext);

  let body: string;
  switch (flow) {
    case "browse_deals": {
      const stage = stageFilter && stageFilter !== "all" ? stageFilter : null;
      const deals = await fetchScopedDeals({ stage, status: null }, [], policyCtx);
      body = formatDealsSummary(deals);
      break;
    }
    case "browse_partners":
      body = formatPartnersSummary(await fetchScopedPartners(null, [], policyCtx));
      break;
    case "browse_customers":
      body = formatCustomersSummary(await fetchScopedCustomers(null, [], policyCtx));
      break;
    case "browse_tasks":
      body = formatTasksSummary(await fetchScopedTasks(null, [], policyCtx));
      break;
    case "browse_tickets":
      body = formatTicketsSummary(await fetchScopedTickets(null, [], policyCtx));
      break;
    case "browse_learning": {
      const userId = authContext.session?.user.id ?? authContext.profile?.id ?? "";
      body = formatLearningSummary(await fetchScopedLearning(null, userId, [], policyCtx));
      break;
    }
    case "browse_news":
      body = formatNewsSummary(await fetchScopedNews(null, [], policyCtx));
      break;
  }
  return { handled: true, sends: [{ kind: "text", body }] };
}

// ---- Create-a-deal flow -------------------------------------------------

function isPartnerScoped(authContext: AuthContext): {
  partnerId: string | null;
  companyName: string | null;
} {
  return {
    partnerId: authContext.profile?.partner_id ?? null,
    companyName: authContext.profile?.company_name ?? null,
  };
}

async function startCreateDeal(
  input: TurnInput,
): Promise<{ handled: boolean; sends: SendInstruction[] }> {
  const capabilities = await loadRoleCapabilities(input.authContext.assignment?.roleKey ?? null);
  if (!hasCapability(capabilities, "deals", "create")) {
    return {
      handled: true,
      sends: [{ kind: "text", body: "Your role doesn't have permission to create deals." }],
    };
  }

  const scope = isPartnerScoped(input.authContext);
  const draft: AssistantDealDraft = { ...EMPTY_ASSISTANT_DEAL_DRAFT };

  if (scope.partnerId) {
    draft.partnerId = scope.partnerId;
    draft.accountName = scope.companyName;
    await setWizardState(input.conversationId, "create_deal", "contact" satisfies CreateDealStep, {
      draft,
    });
    return {
      handled: true,
      sends: [
        {
          kind: "text",
          body: `Using your account, ${scope.companyName}. What's the contact or client name for this deal?`,
        },
      ],
    };
  }

  await setWizardState(input.conversationId, "create_deal", "account" satisfies CreateDealStep, {
    draft,
  });
  return {
    handled: true,
    sends: [{ kind: "text", body: "What's the account or company name for this deal?" }],
  };
}

async function stepCreateDeal(
  state: WizardState,
  input: TurnInput,
): Promise<{ handled: boolean; sends: SendInstruction[] }> {
  const step = state.step as CreateDealStep;
  const draft = (state.data.draft as AssistantDealDraft) ?? { ...EMPTY_ASSISTANT_DEAL_DRAFT };
  const dropdownAuth = toDropdownCallerAuth(input.authContext);
  const { conversationId } = input;

  const advance = async (
    nextStep: CreateDealStep,
    nextDraft: AssistantDealDraft,
    prompt: string,
  ) => {
    await setWizardState(conversationId, "create_deal", nextStep, { draft: nextDraft });
    return { handled: true, sends: [{ kind: "text", body: prompt } as SendInstruction] };
  };

  if (step === "account") {
    if (input.listId === NEW_ACCOUNT_ID) {
      return advance("contact", draft, "What's the contact or client name for this deal?");
    }
    if (input.listId.startsWith(ACCOUNT_PICK_PREFIX)) {
      const partnerId = input.listId.slice(ACCOUNT_PICK_PREFIX.length);
      const partnerRes = await pool.query<{ company_name: string }>(
        `SELECT company_name FROM partners WHERE id = $1 LIMIT 1`,
        [partnerId],
      );
      const companyName = partnerRes.rows[0]?.company_name;
      if (companyName) {
        const nextDraft = { ...draft, partnerId, accountName: companyName };
        return advance(
          "contact",
          nextDraft,
          `Using account "${companyName}". What's the contact or client name for this deal?`,
        );
      }
    }
    const name = input.bodyText.trim();
    if (!name) {
      return {
        handled: true,
        sends: [{ kind: "text", body: "What's the account or company name for this deal?" }],
      };
    }
    const match = await resolveAccountOrClientMatch("account", name, dropdownAuth);
    if (match.kind === "match") {
      const nextDraft = { ...draft, partnerId: match.id, accountName: match.label };
      return advance(
        "contact",
        nextDraft,
        `Using existing account "${match.label}". What's the contact or client name for this deal?`,
      );
    }
    if (match.kind === "ambiguous") {
      await setWizardState(conversationId, "create_deal", "account", { draft });
      return {
        handled: true,
        sends: [
          {
            kind: "list",
            body: `A few existing accounts match "${name}" — pick one, or "New account" to create it.`,
            button: "Select",
            items: [
              ...match.candidates
                .slice(0, 9)
                .map((c) => ({ id: `${ACCOUNT_PICK_PREFIX}${c.id}`, item: c.label.slice(0, 24) })),
              { id: NEW_ACCOUNT_ID, item: "New account", description: `Create "${name}"` },
            ],
          },
        ],
      };
    }
    const nextDraft = { ...draft, accountName: name };
    return advance(
      "contact",
      nextDraft,
      `No existing account found — I'll create "${name}" as new. What's the contact or client name for this deal?`,
    );
  }

  if (step === "contact") {
    if (input.listId === NEW_CONTACT_ID) {
      return advance("product", draft, "What product is this deal for?");
    }
    if (input.listId.startsWith(CONTACT_PICK_PREFIX)) {
      const customerId = input.listId.slice(CONTACT_PICK_PREFIX.length);
      const custRes = await pool.query<{ company_name: string }>(
        `SELECT company_name FROM portal_customers WHERE id = $1 LIMIT 1`,
        [customerId],
      );
      const companyName = custRes.rows[0]?.company_name;
      if (companyName) {
        const nextDraft = { ...draft, customerId, contactName: companyName };
        return advance(
          "product",
          nextDraft,
          `Using client "${companyName}". What product is this deal for?`,
        );
      }
    }
    const name = input.bodyText.trim();
    if (!name) {
      return {
        handled: true,
        sends: [{ kind: "text", body: "What's the contact or client name for this deal?" }],
      };
    }
    const match = await resolveAccountOrClientMatch("client", name, dropdownAuth);
    if (match.kind === "match") {
      const nextDraft = { ...draft, customerId: match.id, contactName: match.label };
      return advance(
        "product",
        nextDraft,
        `Using existing client "${match.label}". What product is this deal for?`,
      );
    }
    if (match.kind === "ambiguous") {
      await setWizardState(conversationId, "create_deal", "contact", { draft });
      return {
        handled: true,
        sends: [
          {
            kind: "list",
            body: `A few existing clients match "${name}" — pick one, or "New client" to create it.`,
            button: "Select",
            items: [
              ...match.candidates
                .slice(0, 9)
                .map((c) => ({ id: `${CONTACT_PICK_PREFIX}${c.id}`, item: c.label.slice(0, 24) })),
              { id: NEW_CONTACT_ID, item: "New client", description: `Create "${name}"` },
            ],
          },
        ],
      };
    }
    const nextDraft = { ...draft, contactName: name };
    return advance(
      "product",
      nextDraft,
      `No existing client found — I'll use "${name}" as new. What product is this deal for?`,
    );
  }

  if (step === "product") {
    const product = input.bodyText.trim();
    if (!product) {
      return { handled: true, sends: [{ kind: "text", body: "What product is this deal for?" }] };
    }
    const nextDraft = { ...draft, product };
    return advance("quantity", nextDraft, 'How many units? Reply a number, or "skip" for 1.');
  }

  if (step === "quantity") {
    const text = input.bodyText.trim().toLowerCase();
    let quantity = 1;
    if (!SKIP_WORDS.has(text)) {
      const parsed = Number.parseInt(text, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return {
          handled: true,
          sends: [{ kind: "text", body: 'Enter a number, or "skip" for 1.' }],
        };
      }
      quantity = parsed;
    }
    const nextDraft = { ...draft, quantity };
    return advance("amount", nextDraft, 'What\'s the deal amount? e.g. "25000" or "25000 EUR".');
  }

  if (step === "amount") {
    const text = input.bodyText.trim();
    const match = text.match(/^([\d,.]+)\s*([A-Za-z]{3})?$/);
    if (!match) {
      return {
        handled: true,
        sends: [{ kind: "text", body: 'Enter an amount, e.g. "25000" or "25000 EUR".' }],
      };
    }
    const amount = match[1].replace(/,/g, "");
    const currencyCode = match[2] ? match[2].toUpperCase() : (draft.currencyCode ?? "USD");
    const nextDraft = { ...draft, amount, currencyCode };
    return advance("extra", nextDraft, 'Any notes or country to add? Reply with them, or "skip".');
  }

  if (step === "extra") {
    const text = input.bodyText.trim();
    const nextDraft = SKIP_WORDS.has(text.toLowerCase()) ? draft : { ...draft, notes: text };
    await setWizardState(conversationId, "create_deal", "confirm", { draft: nextDraft });
    const preview = [
      `Account: ${nextDraft.accountName}`,
      `Contact: ${nextDraft.contactName}`,
      `Product: ${nextDraft.product}`,
      nextDraft.quantity ? `Quantity: ${nextDraft.quantity}` : null,
      `Amount: ${nextDraft.currencyCode ?? "USD"} ${nextDraft.amount}`,
      nextDraft.notes ? `Notes: ${nextDraft.notes}` : null,
    ]
      .filter((l): l is string => Boolean(l))
      .join("\n");
    return {
      handled: true,
      sends: [
        {
          kind: "quickReply",
          body: `${preview}\n\nConfirm to create this deal?`,
          actions: [
            { id: "wizard_confirm_deal", title: "Confirm" },
            { id: "wizard_cancel", title: "Cancel" },
          ],
        },
      ],
    };
  }

  if (step === "confirm") {
    if (input.buttonPayload !== "wizard_confirm_deal") {
      return {
        handled: true,
        sends: [
          { kind: "text", body: 'Tap "Confirm" to create the deal, or "Cancel" to discard it.' },
        ],
      };
    }
    await clearWizardState(conversationId);
    const { result } = await confirmDealDraft(input.authContext, { conversationId, draft });
    const body = result.ok
      ? `Created the deal for ${draft.accountName}. You can find it in Pipeline.`
      : `Couldn't create that deal: ${result.failure.message}`;
    return { handled: true, sends: [{ kind: "text", body }] };
  }

  // Unknown step — reset rather than get stuck.
  await clearWizardState(conversationId);
  return { handled: false, sends: [] };
}
