import twilio from "twilio";

import { pool } from "@/server/postgres.server";
import {
  findSessionFromRequest,
  resolveAuthContextForProfile,
} from "@/server/livey-service.server";
import { runAssistantTurn } from "@/server/assistant.server";
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

// Used only for out-of-band sends — the primary inbound-reply path responds
// to Twilio synchronously via TwiML in handleWhatsappWebhook below.
export async function sendWhatsappMessage(toE164: string, body: string) {
  if (!WHATSAPP_FROM) {
    throw new Error("Twilio WhatsApp sender is not configured (missing TWILIO_WHATSAPP_FROM)");
  }
  const client = getClient();
  return client.messages.create({
    from: `whatsapp:${WHATSAPP_FROM}`,
    to: `whatsapp:${toE164}`,
    body,
  });
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

// Wired into src/server.ts as POST /api/integrations/whatsapp/webhook, next
// to the existing Zoho interceptor block.
export async function handleWhatsappWebhook(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  if (!verifyTwilioSignature(request, params)) {
    console.warn("[Twilio webhook] invalid signature");
    return new Response("Unauthorized", { status: 403 });
  }

  const from = (params.From ?? "").trim();
  const bodyText = (params.Body ?? "").trim();
  const phoneE164 = from.replace(/^whatsapp:/i, "");

  if (!phoneE164 || !bodyText) {
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

    const resolved = await resolveAuthContextForProfile(profileId);
    const authContext = {
      session: null,
      profile: resolved.profile,
      roles: resolved.roles,
      assignment: resolved.assignment,
      activeContext: resolved.activeContext,
    };

    const conversationId = `whatsapp:${phoneE164}`;

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

    return twiml(result.reply || "Sorry, I couldn't process that.");
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
