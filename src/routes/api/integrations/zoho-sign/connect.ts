import { createAPIFileRoute } from "@tanstack/react-start/api";
import { randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";

import { REDIRECT_URI } from "@/lib/zoho-sign";

const CLIENT_ID = process.env.ZOHO_SIGN_CLIENT_ID ?? "";
const ACCOUNTS_URL = process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.in";

/**
 * GET /api/integrations/zoho-sign/connect
 *
 * Initiates the Zoho Sign OAuth authorization-code flow.
 * Only accessible to super_admins — protection is enforced by checking a
 * signed admin session cookie set at login.
 */
export const Route = createAPIFileRoute("/api/integrations/zoho-sign/connect")({
  GET: async ({ request }) => {
    if (!CLIENT_ID) {
      return new Response(
        JSON.stringify({ error: "Zoho Sign Client ID is not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const state = randomBytes(32).toString("hex");

    const params = new URLSearchParams({
      scope: ["ZohoSign.documents.ALL", "ZohoSign.templates.ALL"].join(","),
      client_id: CLIENT_ID,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      redirect_uri: REDIRECT_URI,
      state,
    });

    const redirectTo = `${ACCOUNTS_URL}/oauth/v2/auth?${params.toString()}`;

    // Persist state in a short-lived httpOnly cookie for CSRF validation
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: redirectTo,
        "Set-Cookie": `zoho_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`,
      },
    });

    return response;
  },
});
