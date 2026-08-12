import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  handleZohoConnect,
  handleZohoCallback,
  handleZohoWebhook,
  handleZohoSendAgreement,
  handleZohoResyncAgreement,
  handleZohoSignUrl,
} from "./server/zoho-api.server";
import { handleGoogleConnect, handleGoogleCallback } from "./server/google-oauth.server";
import { handleWhatsappWebhook } from "./server/twilio.server";
import {
  handleVoiceIncoming,
  handleVoiceOutgoing,
  handleVoiceStatusCallback,
} from "./server/twilio-voice.server";
import { handleReminderJobRequest, startBackgroundJobs } from "./server/scheduler.server";
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/domain/contracts/telemetry";

// Module scope, not inside fetch(): the reminder interval should start once
// when the server process boots, not be re-checked on every request. The
// function is itself idempotent, so a hot-reloaded module in dev is harmless.
startBackgroundJobs();

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      const correlationId = normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER));

      // Manual API route interceptors since TanStack Start doesn't support them well here
      if (url.pathname === "/api/integrations/zoho-sign/connect") {
        return attachCorrelationHeader(await handleZohoConnect(request), correlationId);
      }
      if (url.pathname === "/api/integrations/zoho-sign/callback") {
        return attachCorrelationHeader(await handleZohoCallback(request), correlationId);
      }
      if (url.pathname === "/api/integrations/zoho-sign/webhook") {
        return attachCorrelationHeader(await handleZohoWebhook(request), correlationId);
      }
      if (url.pathname === "/api/integrations/zoho-sign/send-agreement") {
        return attachCorrelationHeader(await handleZohoSendAgreement(request), correlationId);
      }
      if (url.pathname === "/api/integrations/zoho-sign/resync-agreement") {
        return attachCorrelationHeader(await handleZohoResyncAgreement(request), correlationId);
      }
      if (url.pathname === "/api/integrations/zoho-sign/sign-url") {
        return attachCorrelationHeader(await handleZohoSignUrl(request), correlationId);
      }
      if (url.pathname === "/api/auth/google/connect") {
        return attachCorrelationHeader(await handleGoogleConnect(request), correlationId);
      }
      if (url.pathname === "/api/auth/google/callback") {
        return attachCorrelationHeader(await handleGoogleCallback(request), correlationId);
      }
      if (url.pathname === "/api/integrations/whatsapp/webhook" && request.method === "POST") {
        return attachCorrelationHeader(await handleWhatsappWebhook(request), correlationId);
      }
      if (url.pathname === "/api/integrations/twilio/voice/incoming" && request.method === "POST") {
        return attachCorrelationHeader(await handleVoiceIncoming(request), correlationId);
      }
      if (url.pathname === "/api/integrations/twilio/voice/outgoing" && request.method === "POST") {
        return attachCorrelationHeader(await handleVoiceOutgoing(request), correlationId);
      }
      if (url.pathname === "/api/integrations/twilio/voice/status" && request.method === "POST") {
        return attachCorrelationHeader(await handleVoiceStatusCallback(request), correlationId);
      }
      if (url.pathname === "/api/jobs/reminders" && request.method === "POST") {
        return attachCorrelationHeader(await handleReminderJobRequest(request), correlationId);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return attachCorrelationHeader(
        await normalizeCatastrophicSsrResponse(response),
        correlationId,
      );
    } catch (error) {
      console.error(error);
      // Return JSON for API routes, HTML for others
      const url = new URL(request.url);
      const correlationId = normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER));
      if (url.pathname.startsWith("/api/")) {
        return attachCorrelationHeader(
          new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
          correlationId,
        );
      }
      return attachCorrelationHeader(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        correlationId,
      );
    }
  },
};

function attachCorrelationHeader(response: Response, correlationId: string) {
  const headers = new Headers(response.headers);
  headers.set(CORRELATION_ID_HEADER, correlationId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
