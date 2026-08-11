import twilio from "twilio";

import { pool } from "@/server/postgres.server";
import {
  findSessionFromRequest,
  resolveAuthContextForProfile,
} from "@/server/livey-service.server";
import { runAssistantTurn } from "@/server/assistant.server";
import {
  clearWizardState,
  handleWizardTurn,
  type SendInstruction,
} from "@/server/whatsapp-wizard.server";
import type { AssistantChatMessage } from "@/domain/contracts/assistant";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
const VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID ?? "";
const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM ?? "";

let clientSingleton: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    throw new Error("Twilio is not configured (missing TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN)");
  }
  if (!clientSingleton) {
    clientSingleton = twilio(ACCOUNT_SID, AUTH_TOKEN);
  }
  return clientSingleton;
}

const E164_RE = /^\+[1-9]\d{6,14}$/;

export function isValidE164(value: string): boolean {
  return E164_RE.test(value.trim());
}

// OTP delivered by SMS, not WhatsApp — decouples account-linking from the
// WhatsApp sandbox's own "join <code>" quirk, and works before the user has
// joined the sandbox at all. No local OTP-code table: Twilio Verify is
// stateful on Twilio's own side (a Verification resource keyed by phone
// number), so nothing needs to be persisted here until it's confirmed.
export async function startWhatsappVerification(phoneE164: string) {
  if (!VERIFY_SERVICE_SID) {
    throw new Error("Twilio Verify is not configured (missing TWILIO_VERIFY_SERVICE_SID)");
  }
  const client = getClient();
  return client.verify.v2
    .services(VERIFY_SERVICE_SID)
    .verifications.create({ to: phoneE164, channel: "sms" });
}

export async function checkWhatsappVerification(phoneE164: string, code: string) {
  if (!VERIFY_SERVICE_SID) {
    throw new Error("Twilio Verify is not configured (missing TWILIO_VERIFY_SERVICE_SID)");
  }
  const client = getClient();
  return client.verify.v2
    .services(VERIFY_SERVICE_SID)
    .verificationChecks.create({ to: phoneE164, code });
}

function requireWhatsappFrom(): string {
  if (!WHATSAPP_FROM) {
    throw new Error("Twilio WhatsApp sender is not configured (missing TWILIO_WHATSAPP_FROM)");
  }
  return `whatsapp:${WHATSAPP_FROM}`;
}

export async function sendWhatsappMessage(toE164: string, body: string) {
  const client = getClient();
  return client.messages.create({
    from: requireWhatsappFrom(),
    to: `whatsapp:${toE164}`,
    body,
  });
}

// ---- Main-menu interactive message (Twilio Content API) -------------------
//
// WhatsApp's native tappable list/button UI isn't sendable via plain TwiML
// or a plain messages.create({body}) — it requires a Content API "Content"
// resource (a reusable interactive-message definition) referenced by SID.
// twilio/list-picker and twilio/quick-reply are session-message content
// types, not marketing/HSM templates, so they don't need WhatsApp business
// template approval — they can be created and used immediately. Created
// lazily on first use and cached in app_settings so a redeploy reuses the
// same Content resource instead of creating a new one every time.
type MenuItem = { id: string; item: string; description: string };

const MAIN_MENU_ITEMS: MenuItem[] = [
  {
    id: "menu_deals",
    item: "Deals",
    description: "View your pipeline",
  },
  {
    id: "menu_partners",
    item: "Partners",
    description: "Search partner accounts",
  },
  {
    id: "menu_customers",
    item: "Customers",
    description: "Search customer accounts",
  },
  {
    id: "menu_tasks",
    item: "Tasks",
    description: "Your open tasks",
  },
  {
    id: "menu_tickets",
    item: "Support Tickets",
    description: "Your support tickets",
  },
  {
    id: "menu_learning",
    item: "Insight Hub",
    description: "Learning tracks & certifications",
  },
  {
    id: "menu_news",
    item: "News",
    description: "LIVEY News feed",
  },
  {
    id: "menu_create_deal",
    item: "Create a Deal",
    description: "Start a new deal",
  },
];

const MAIN_MENU_TRIGGERS = new Set(["menu", "hi", "hello", "hey", "start"]);
const MAIN_MENU_BUTTON_PAYLOAD = "main_menu";

async function getAppSetting(key: string): Promise<string | null> {
  const result = await pool.query<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = $1 LIMIT 1`,
    [key],
  );
  return result.rows[0]?.value ?? null;
}

async function setAppSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

async function createContent(body: Record<string, unknown>): Promise<string> {
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64");
  const res = await fetch("https://content.twilio.com/v1/Content", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio Content API create failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { sid: string };
  return json.sid;
}

let menuContentSidPromise: Promise<string> | null = null;

async function ensureMainMenuContentSid(): Promise<string> {
  if (!menuContentSidPromise) {
    menuContentSidPromise = (async () => {
      const cached = await getAppSetting("twilio_menu_content_sid");
      if (cached) return cached;
      const sid = await createContent({
        friendly_name: `livey_whatsapp_main_menu_${Date.now()}`,
        language: "en",
        types: {
          "twilio/list-picker": {
            body: "Please choose an option from the menu below.",
            button: "Main Menu",
            items: MAIN_MENU_ITEMS.map((m) => ({
              id: m.id,
              item: m.item,
              description: m.description,
            })),
          },
        },
      });
      await setAppSetting("twilio_menu_content_sid", sid);
      return sid;
    })().catch((err) => {
      menuContentSidPromise = null;
      throw err;
    });
  }
  return menuContentSidPromise;
}

let menuChipContentSidPromise: Promise<string> | null = null;

async function ensureMainMenuChipContentSid(): Promise<string> {
  if (!menuChipContentSidPromise) {
    menuChipContentSidPromise = (async () => {
      const cached = await getAppSetting("twilio_menu_chip_content_sid");
      if (cached) return cached;
      const sid = await createContent({
        friendly_name: `livey_whatsapp_main_menu_chip_${Date.now()}`,
        language: "en",
        types: {
          "twilio/quick-reply": {
            body: "Want anything else?",
            actions: [{ type: "QUICK_REPLY", title: "Main Menu", id: MAIN_MENU_BUTTON_PAYLOAD }],
          },
        },
      });
      await setAppSetting("twilio_menu_chip_content_sid", sid);
      return sid;
    })().catch((err) => {
      menuChipContentSidPromise = null;
      throw err;
    });
  }
  return menuChipContentSidPromise;
}

async function sendMainMenu(toE164: string): Promise<void> {
  const contentSid = await ensureMainMenuContentSid();
  const client = getClient();
  await client.messages.create({
    from: requireWhatsappFrom(),
    to: `whatsapp:${toE164}`,
    contentSid,
  });
}

async function sendMainMenuChip(toE164: string): Promise<void> {
  const contentSid = await ensureMainMenuChipContentSid();
  const client = getClient();
  await client.messages.create({
    from: requireWhatsappFrom(),
    to: `whatsapp:${toE164}`,
    contentSid,
  });
}

// ---- Dynamic account picker (create_deal_draft ambiguous-account case) ----
//
// Unlike the static main menu, each search's candidate list differs, so this
// can't reuse a single cached Content resource — a fresh ephemeral
// twilio/list-picker Content is created per prompt. WhatsApp list-picker item
// titles are capped at 24 chars, hence the truncation below. The partner id
// is embedded directly in the item id (see ACCOUNT_PICKER_ID_PREFIX handling
// in handleWhatsappWebhook) so no separate state needs to be kept between
// sending this and handling the tap.
const ACCOUNT_PICKER_ID_PREFIX = "acct_";

async function sendAccountPicker(
  toE164: string,
  body: string,
  candidates: Array<{ id: string; label: string }>,
): Promise<void> {
  const sid = await createContent({
    friendly_name: `livey_whatsapp_account_picker_${Date.now()}`,
    language: "en",
    types: {
      "twilio/list-picker": {
        body: body.slice(0, 1024),
        button: "Select",
        items: candidates.slice(0, 10).map((c) => ({
          id: `${ACCOUNT_PICKER_ID_PREFIX}${c.id}`,
          item: c.label.slice(0, 24),
        })),
      },
    },
  });
  const client = getClient();
  await client.messages.create({
    from: requireWhatsappFrom(),
    to: `whatsapp:${toE164}`,
    contentSid: sid,
  });
}

// Turns a whatsapp-wizard.server.ts SendInstruction into an actual Twilio
// send — the wizard module stays Twilio-agnostic (returns plain data), this
// is the only place that knows how to realize "list"/"quickReply" as
// ephemeral Content API resources vs. a plain messages.create({body}).
async function realizeSend(toE164: string, send: SendInstruction): Promise<void> {
  if (send.kind === "text") {
    await sendWhatsappMessage(toE164, send.body);
    return;
  }
  const client = getClient();
  if (send.kind === "list") {
    const sid = await createContent({
      friendly_name: `livey_whatsapp_wizard_list_${Date.now()}`,
      language: "en",
      types: {
        "twilio/list-picker": {
          body: send.body.slice(0, 1024),
          button: send.button,
          items: send.items.map((i) => ({
            id: i.id,
            item: i.item.slice(0, 24),
            ...(i.description ? { description: i.description.slice(0, 72) } : {}),
          })),
        },
      },
    });
    await client.messages.create({
      from: requireWhatsappFrom(),
      to: `whatsapp:${toE164}`,
      contentSid: sid,
    });
    return;
  }
  // quickReply
  const sid = await createContent({
    friendly_name: `livey_whatsapp_wizard_qr_${Date.now()}`,
    language: "en",
    types: {
      "twilio/quick-reply": {
        body: send.body.slice(0, 1024),
        actions: send.actions.map((a) => ({
          type: "QUICK_REPLY",
          title: a.title.slice(0, 20),
          id: a.id,
        })),
      },
    },
  });
  await client.messages.create({
    from: requireWhatsappFrom(),
    to: `whatsapp:${toE164}`,
    contentSid: sid,
  });
}

async function realizeSends(toE164: string, sends: SendInstruction[]): Promise<void> {
  for (const send of sends) {
    await realizeSend(toE164, send);
  }
}

// Mirrors the raw-body-first pattern in handleZohoWebhook (zoho-api.server.ts)
// — Twilio's request signature is the only auth it gives us on this route,
// so an invalid/unverifiable signature must fail closed (reject), never be
// treated as valid.
export function verifyTwilioSignature(request: Request, params: Record<string, string>): boolean {
  if (!AUTH_TOKEN) return false;
  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!signature) return false;
  const url = request.url;
  return twilio.validateRequest(AUTH_TOKEN, signature, url, params);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(message: string): Response {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
  return new Response(body, { status: 200, headers: { "Content-Type": "text/xml" } });
}

const NOT_LINKED_REPLY =
  "This WhatsApp number isn't linked to a Livey account yet. Go to Settings → WhatsApp in the app to connect it.";

// A function, not a shared const Response — server.ts's attachCorrelationHeader
// wraps every response via `new Response(response.body, ...)`, which reads
// (and locks) the body stream. A single reused Response instance across
// requests throws "Response body object should not be disturbed or locked"
// on its second use, so every call site needs its own fresh instance.
function emptyTwiml(): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

// Wired into apps/backend/src/app.ts as POST /api/integrations/whatsapp/webhook, next
// to the existing Zoho interceptor block.
export async function handleWhatsappWebhook(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  if (!verifyTwilioSignature(request, params)) {
    console.warn("[Twilio webhook] invalid signature");
    return new Response("Unauthorized", { status: 403 });
  }

  const from = (params.From ?? "").trim();
  const phoneE164 = from.replace(/^whatsapp:/i, "");
  // Interactive-reply params Twilio adds on top of Body when the user tapped
  // a list-picker item or a quick-reply button, instead of typing free text.
  let listId = (params.ListId ?? "").trim();
  let buttonPayload = (params.ButtonPayload ?? "").trim();
  let bodyText = (params.Body ?? "").trim();
  // Defensive fallback: observed live, tapping an older/no-longer-"live"
  // interactive message can arrive with ListId/ButtonPayload empty and the
  // raw internal id (e.g. "menu_create_deal") in Body instead — which, left
  // unhandled, gets misread as if the user had typed that literal string as
  // a search term. A real typed message will essentially never coincidentally
  // match one of our own internally-generated id shapes, so reclassify it
  // instead of treating it as free text.
  if (!listId && !buttonPayload && bodyText) {
    if (/^(menu_|wz_)/.test(bodyText)) {
      listId = bodyText;
      bodyText = "";
    } else if (bodyText === MAIN_MENU_BUTTON_PAYLOAD || /^wizard_/.test(bodyText)) {
      buttonPayload = bodyText;
      bodyText = "";
    }
  }

  if (!phoneE164) {
    return twiml(NOT_LINKED_REPLY);
  }

  try {
    const profileRes = await pool.query<{ id: string }>(
      `SELECT id FROM profiles WHERE whatsapp_phone_e164 = $1 AND whatsapp_verified_at IS NOT NULL LIMIT 1`,
      [phoneE164],
    );
    const profileId = profileRes.rows[0]?.id;

    if (!profileId) {
      return twiml(NOT_LINKED_REPLY);
    }

    const wantsMenu =
      buttonPayload === MAIN_MENU_BUTTON_PAYLOAD ||
      !bodyText ||
      MAIN_MENU_TRIGGERS.has(bodyText.toLowerCase());

    const resolved = await resolveAuthContextForProfile(profileId);
    const authContext = {
      session: null,
      profile: resolved.profile,
      roles: resolved.roles,
      assignment: resolved.assignment,
      activeContext: resolved.activeContext,
    };
    const conversationId = `whatsapp:${phoneE164}`;

    if (wantsMenu && !listId) {
      await clearWizardState(conversationId);
      await sendMainMenu(phoneE164);
      return emptyTwiml();
    }

    // Deterministic, LLM-free path first — a tapped menu item or an
    // in-progress guided flow (Create a Deal, browse sub-menus) is handled
    // entirely by whatsapp-wizard.server.ts's own step state, never by
    // asking a model to re-infer "what step are we on" from history.
    const wizardResult = await handleWizardTurn({
      conversationId,
      authContext,
      listId,
      buttonPayload,
      bodyText,
    });

    if (wizardResult.handled) {
      // No trailing "Main Menu" chip here, unlike the LLM fallback below —
      // every wizard step already ends in its own actionable prompt (a
      // question to answer, or a list/quick-reply to tap), and stacking a
      // "Want anything else?" chip after e.g. "What's the account name?"
      // reads as if the flow just ended. Typing "menu" or tapping the main
      // menu's own quick-reply chip (sent after non-wizard replies) still
      // escapes a flow at any point via the wantsMenu check above.
      await realizeSends(phoneE164, wizardResult.sends);
      return emptyTwiml();
    }

    // Not a wizard flow — a tapped list item whose id nothing above claimed
    // has no free-text meaning to fall back to.
    if (listId) {
      await sendMainMenu(phoneE164);
      return emptyTwiml();
    }

    // Free-text fallback: the original LLM-driven Assistant, unchanged —
    // still handles arbitrary questions, and free-typed (not tapped)
    // "create a deal" requests via its own create_deal_draft intent path.
    const historyRes = await pool.query<{ role: "user" | "assistant"; content: string }>(
      `SELECT role, content FROM assistant_messages
       WHERE channel = 'whatsapp' AND conversation_id = $1
       ORDER BY created_at DESC
       LIMIT 12`,
      [conversationId],
    );
    const history: AssistantChatMessage[] = historyRes.rows.reverse().map((row) => ({
      role: row.role,
      content: row.content,
    }));

    const result = await runAssistantTurn(authContext, {
      conversationId,
      message: bodyText,
      history,
      channel: "whatsapp",
    });

    // Switched from a single synchronous TwiML reply to two async REST
    // sends — a plain-text (or interactive list-picker) reply followed by a
    // "Main Menu" quick-reply chip (mirrors the always-available menu
    // shortcut seen in bank WhatsApp bots) — since TwiML can't carry a
    // Content API contentSid.
    if (result.accountPicker && result.accountPicker.candidates.length > 0) {
      await sendAccountPicker(
        phoneE164,
        result.reply || "A few existing accounts look similar — which one is this for?",
        result.accountPicker.candidates,
      );
    } else {
      await sendWhatsappMessage(phoneE164, result.reply || "Sorry, I couldn't process that.");
    }
    await sendMainMenuChip(phoneE164).catch((err) =>
      console.error("[Twilio webhook] failed to send main-menu chip:", err),
    );
    return emptyTwiml();
  } catch (err) {
    console.error("[Twilio webhook] handler failed:", err);
    // Never error back to Twilio for a processing miss — reply plainly and
    // return 200 so Twilio doesn't retry/alarm on transient failures.
    return twiml("Something went wrong on our end. Please try again in a moment.");
  }
}

// ---- Settings-page linking RPCs -------------------------------------------

async function requireCurrentUserId(): Promise<string> {
  const session = await findSessionFromRequest();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

// Linking itself has no capability gate — this is a personal account link,
// same as Google, available to every authenticated user regardless of role
// capabilities (unlike the platform-wide Integrations card).
export async function requestWhatsappLink(input: { phoneE164: string }) {
  const userId = await requireCurrentUserId();
  const phone = input.phoneE164.trim();
  if (!isValidE164(phone)) {
    throw new Error("Enter a valid phone number in international format, e.g. +14155552671");
  }

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM profiles WHERE whatsapp_phone_e164 = $1 AND id <> $2 LIMIT 1`,
    [phone, userId],
  );
  if (existing.rows.length > 0) {
    throw new Error("This WhatsApp number is already linked to another account");
  }

  await startWhatsappVerification(phone);
  return { ok: true as const };
}

export async function confirmWhatsappLink(input: { phoneE164: string; code: string }) {
  const userId = await requireCurrentUserId();
  const phone = input.phoneE164.trim();
  const code = input.code.trim();
  if (!isValidE164(phone) || !code) {
    throw new Error("Missing phone number or code");
  }

  const check = await checkWhatsappVerification(phone, code);
  if (check.status !== "approved") {
    throw new Error("Incorrect or expired code — request a new one and try again");
  }

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM profiles WHERE whatsapp_phone_e164 = $1 AND id <> $2 LIMIT 1`,
    [phone, userId],
  );
  if (existing.rows.length > 0) {
    throw new Error("This WhatsApp number is already linked to another account");
  }

  await pool.query(
    `UPDATE profiles SET whatsapp_phone_e164 = $1, whatsapp_verified_at = now(), updated_at = now() WHERE id = $2`,
    [phone, userId],
  );
  return { ok: true as const };
}

export async function disconnectWhatsapp() {
  const userId = await requireCurrentUserId();
  await pool.query(
    `UPDATE profiles SET whatsapp_phone_e164 = NULL, whatsapp_verified_at = NULL, updated_at = now() WHERE id = $1`,
    [userId],
  );
  return { ok: true as const };
}
