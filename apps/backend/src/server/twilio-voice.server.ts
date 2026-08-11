import twilio from "twilio";

import type { CrudOperation } from "@/domain/contracts/features";
import { pool } from "@/server/postgres.server";
import {
  findSessionFromRequest,
  resolveAuthContextForProfile,
} from "@/server/livey-service.server";
import { hasCapability, loadRoleCapabilities } from "@/server/rbac-policy.server";
import { isValidE164, verifyTwilioSignature } from "@/server/twilio.server";

// Call Center Phase 1: Voice calling (Twilio Voice + browser softphone).
// Mirrors the module-level-client / raw-body-first-webhook / signature-
// verification pattern already established in twilio.server.ts (the
// WhatsApp integration) rather than introducing a new one. Signature
// verification is literally the same function (imported, not duplicated) —
// Voice webhooks are signed with the same main Account SID/Auth Token as
// the WhatsApp webhook, even though Voice Access Tokens for the browser
// SDK are minted with a separate API Key/Secret pair below.
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const VOICE_NUMBER = process.env.TWILIO_VOICE_NUMBER ?? "";
const TWIML_APP_SID = process.env.TWILIO_TWIML_APP_SID ?? "";
const VOICE_API_KEY_SID = process.env.TWILIO_VOICE_API_KEY_SID ?? "";
const VOICE_API_KEY_SECRET = process.env.TWILIO_VOICE_API_KEY_SECRET ?? "";

// Twilio's own CallStatus values (https://www.twilio.com/docs/voice/twiml#callstatus-values),
// matching the free-text comment on call_logs.status in db/schema.sql.
const CALL_LOG_STATUSES = new Set([
  "queued",
  "ringing",
  "in-progress",
  "completed",
  "busy",
  "failed",
  "no-answer",
  "canceled",
]);
const TERMINAL_CALL_STATUSES = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);

// Only super_admin/livey_support ever have any "calls" capability (see the
// role_permissions seed in db/schema.sql) — this is who gets rung on an
// inbound call, and the only roles resolveOnDutyAgents() ever considers.
const RINGABLE_ROLE_KEYS = ["super_admin", "livey_support"];

// ---- Access control ---------------------------------------------------
//
// A raw pool.query webhook write never goes through this — only the four
// authenticated RPCs below do. Mirrors rbac-policy.server.ts's own
// documented invariant: super_admin bypasses the role_permissions matrix
// entirely rather than requiring an explicit row for it.
async function requireCallsCapability(operation: CrudOperation): Promise<{ userId: string }> {
  const session = await findSessionFromRequest();
  if (!session) {
    throw new Error("Unauthorized");
  }

  const resolved = await resolveAuthContextForProfile(session.user.id);
  const isSuperAdmin = resolved.roles.includes("super_admin");
  if (!isSuperAdmin) {
    const capabilities = await loadRoleCapabilities(resolved.assignment?.roleKey ?? null);
    if (!hasCapability(capabilities, "calls", operation)) {
      throw new Error("Access denied");
    }
  }

  return { userId: session.user.id };
}

// ---- Voice Access Token (browser softphone) ----------------------------
//
// Called by the softphone panel on mount and refreshed before expiry.
// identity = profile id — the same id used as the <Client> name in the
// ring-group TwiML built by handleVoiceIncoming, and parsed back out of
// the "client:<identity>" From param in handleVoiceOutgoing.
export async function mintVoiceAccessToken(): Promise<{ token: string; identity: string }> {
  const { userId } = await requireCallsCapability("read");

  if (!ACCOUNT_SID || !VOICE_API_KEY_SID || !VOICE_API_KEY_SECRET || !TWIML_APP_SID) {
    throw new Error(
      "Voice calling is not configured (missing TWILIO_VOICE_API_KEY_SID/TWILIO_VOICE_API_KEY_SECRET/TWILIO_TWIML_APP_SID)",
    );
  }

  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(ACCOUNT_SID, VOICE_API_KEY_SID, VOICE_API_KEY_SECRET, {
    identity: userId,
    ttl: 3600,
  });
  token.addGrant(
    new AccessToken.VoiceGrant({
      outgoingApplicationSid: TWIML_APP_SID,
      incomingAllow: true,
    }),
  );

  return { token: token.toJwt(), identity: userId };
}

// ---- TwiML webhooks -----------------------------------------------------
//
// A function, not a shared const Response — server.ts's attachCorrelationHeader
// wraps every response via `new Response(response.body, ...)`, which reads
// (and locks) the body stream. A single reused Response instance across
// requests throws "Response body object should not be disturbed or locked"
// on its second use, so every call site below builds its own fresh
// VoiceResponse and Response instance (see twilio.server.ts's emptyTwiml
// for the identical fix applied to the WhatsApp integration).
function voiceTwiml(
  build: (response: InstanceType<typeof twilio.twiml.VoiceResponse>) => void,
): Response {
  const response = new twilio.twiml.VoiceResponse();
  build(response);
  return new Response(response.toString(), {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

async function resolveOnDutyAgentIds(): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT DISTINCT p.id
     FROM profiles p
     JOIN assignments a ON a.user_id = p.id
     WHERE p.call_ready = true
       AND a.status = 'active'
       AND a.role_key = ANY($1::text[])`,
    [RINGABLE_ROLE_KEYS],
  );
  return rows.map((row) => row.id);
}

// Wired into apps/backend/src/app.ts as POST /api/integrations/twilio/voice/incoming
// — the Voice webhook URL configured on the TwiML Application in Console
// for calls to TWILIO_VOICE_NUMBER. Twilio rings every nested <Client> noun
// inside a single <Dial> simultaneously (a "ring group"), not a queue —
// the first agent to answer gets the call, the others stop ringing.
export async function handleVoiceIncoming(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  if (!verifyTwilioSignature(request, params)) {
    console.warn("[Twilio Voice webhook] invalid signature (incoming)");
    return new Response("Unauthorized", { status: 403 });
  }

  const callSid = (params.CallSid ?? "").trim();
  const from = (params.From ?? "").trim();
  const to = (params.To ?? "").trim();

  if (callSid) {
    await pool
      .query(
        `INSERT INTO call_logs (twilio_call_sid, direction, from_number, to_number, status)
         VALUES ($1, 'inbound', $2, $3, 'ringing')
         ON CONFLICT (twilio_call_sid) DO NOTHING`,
        [callSid, from, to],
      )
      .catch((err) => console.error("[Twilio Voice webhook] failed to log inbound call:", err));
  }

  const agentIds = await resolveOnDutyAgentIds();

  if (agentIds.length === 0) {
    return voiceTwiml((response) => {
      response.say(
        "Thanks for calling LIVEY. No one is available to take your call right now. Please try again shortly.",
      );
      response.hangup();
    });
  }

  return voiceTwiml((response) => {
    const dial = response.dial({ timeout: 30 });
    for (const agentId of agentIds) {
      dial.client(agentId);
    }
  });
}

// Wired into apps/backend/src/app.ts as POST /api/integrations/twilio/voice/outgoing
// — the browser SDK's device.connect({ params: { To } }) hits this (via
// the TwiML Application's Voice URL) to place an outbound call. Twilio
// sends the calling agent's Client identity as From="client:<identity>".
export async function handleVoiceOutgoing(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  if (!verifyTwilioSignature(request, params)) {
    console.warn("[Twilio Voice webhook] invalid signature (outgoing)");
    return new Response("Unauthorized", { status: 403 });
  }

  const callSid = (params.CallSid ?? "").trim();
  const to = (params.To ?? "").trim();
  const fromClient = (params.From ?? "").trim();
  const agentUserId = fromClient.replace(/^client:/i, "").trim() || null;

  if (!VOICE_NUMBER) {
    return voiceTwiml((response) => {
      response.say("Outbound calling isn't configured yet. Please contact your administrator.");
      response.hangup();
    });
  }

  if (!to || !isValidE164(to)) {
    return voiceTwiml((response) => {
      response.say("That number isn't valid. Please hang up and try again.");
      response.hangup();
    });
  }

  if (callSid) {
    await pool
      .query(
        `INSERT INTO call_logs (twilio_call_sid, direction, from_number, to_number, agent_user_id, status)
         VALUES ($1, 'outbound', $2, $3, $4, 'ringing')
         ON CONFLICT (twilio_call_sid) DO NOTHING`,
        [callSid, VOICE_NUMBER, to, agentUserId],
      )
      .catch((err) => console.error("[Twilio Voice webhook] failed to log outbound call:", err));
  }

  return voiceTwiml((response) => {
    const dial = response.dial({ callerId: VOICE_NUMBER });
    dial.number(to);
  });
}

// Wired into apps/backend/src/app.ts as POST /api/integrations/twilio/voice/status —
// registered in Console as the TwiML Application's (or number's) call
// status callback URL. Not a TwiML response — any 200 satisfies Twilio, so
// this returns a plain empty body rather than XML.
export async function handleVoiceStatusCallback(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  if (!verifyTwilioSignature(request, params)) {
    console.warn("[Twilio Voice webhook] invalid signature (status)");
    return new Response("Unauthorized", { status: 403 });
  }

  const callSid = (params.CallSid ?? "").trim();
  if (!callSid) {
    return new Response(null, { status: 200 });
  }

  const rawStatus = (params.CallStatus ?? "").trim();
  const status = CALL_LOG_STATUSES.has(rawStatus) ? rawStatus : null;
  const isTerminal = status ? TERMINAL_CALL_STATUSES.has(status) : false;
  const durationSeconds = params.CallDuration ? Number.parseInt(params.CallDuration, 10) : null;
  const recordingUrl = (params.RecordingUrl ?? "").trim() || null;

  await pool
    .query(
      `UPDATE call_logs SET
         status = COALESCE($2, status),
         started_at = CASE WHEN $2 = 'in-progress' AND started_at IS NULL THEN now() ELSE started_at END,
         ended_at = CASE WHEN $3 THEN COALESCE(ended_at, now()) ELSE ended_at END,
         duration_seconds = COALESCE($4, duration_seconds),
         recording_url = COALESCE($5, recording_url),
         updated_at = now()
       WHERE twilio_call_sid = $1`,
      [
        callSid,
        status,
        isTerminal,
        Number.isFinite(durationSeconds) ? durationSeconds : null,
        recordingUrl,
      ],
    )
    .catch((err) => console.error("[Twilio Voice webhook] failed to update call status:", err));

  return new Response(null, { status: 200 });
}

// ---- Softphone panel RPCs ------------------------------------------------

// Takes the Twilio Call SID rather than the call_logs row id: the browser
// SDK's Call object never receives our internal call_logs.id (the
// incoming/outgoing webhooks that create the row run server-to-server, not
// reachable from the browser) — call.parameters.CallSid is what's actually
// available client-side for both directions. Also doubles as "claim this
// call": handleVoiceIncoming's ring-group insert deliberately leaves
// agent_user_id NULL (it doesn't know who will pick up), so the first
// disposition-set after an inbound call attributes it to whichever on-duty
// agent actually answered — outbound rows already have agent_user_id set
// at creation (parsed from the "client:<identity>" From param), so the
// COALESCE below is a no-op there and the ownership check still applies.
export async function setCallDisposition(input: {
  twilioCallSid: string;
  disposition: string;
}): Promise<{ ok: true }> {
  const { userId } = await requireCallsCapability("update");
  const resolved = await resolveAuthContextForProfile(userId);
  const isSuperAdmin = resolved.roles.includes("super_admin");

  const disposition = input.disposition.trim();
  const twilioCallSid = input.twilioCallSid.trim();
  if (!disposition) {
    throw new Error("Disposition is required");
  }
  if (!twilioCallSid) {
    throw new Error("Missing call");
  }

  const result = isSuperAdmin
    ? await pool.query(
        `UPDATE call_logs SET disposition = $1, updated_at = now()
         WHERE twilio_call_sid = $2 RETURNING id`,
        [disposition, twilioCallSid],
      )
    : await pool.query(
        `UPDATE call_logs SET
           disposition = $1,
           agent_user_id = COALESCE(agent_user_id, $3),
           updated_at = now()
         WHERE twilio_call_sid = $2 AND (agent_user_id = $3 OR agent_user_id IS NULL)
         RETURNING id`,
        [disposition, twilioCallSid, userId],
      );

  if (result.rowCount === 0) {
    throw new Error("Call not found or access denied");
  }

  return { ok: true };
}

export async function setCallReady(input: { ready: boolean }): Promise<{
  ok: true;
  ready: boolean;
}> {
  const { userId } = await requireCallsCapability("read");
  await pool.query(`UPDATE profiles SET call_ready = $1, updated_at = now() WHERE id = $2`, [
    input.ready,
    userId,
  ]);
  return { ok: true, ready: input.ready };
}
