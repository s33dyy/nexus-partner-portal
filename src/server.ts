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
      
      // Manual API route interceptors since TanStack Start doesn't support them well here
      if (url.pathname === "/api/integrations/zoho-sign/connect") {
        return await handleZohoConnect(request);
      }
      if (url.pathname === "/api/integrations/zoho-sign/callback") {
        return await handleZohoCallback(request);
      }
      if (url.pathname === "/api/integrations/zoho-sign/webhook") {
        return await handleZohoWebhook(request);
      }
      if (url.pathname === "/api/integrations/zoho-sign/send-agreement") {
        return await handleZohoSendAgreement(request);
      }
      if (url.pathname === "/api/integrations/zoho-sign/resync-agreement") {
        return await handleZohoResyncAgreement(request);
      }
      if (url.pathname === "/api/integrations/zoho-sign/sign-url") {
        return await handleZohoSignUrl(request);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      // Return JSON for API routes, HTML for others
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) {
        return new Response(JSON.stringify({ error: "Internal server error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
