import { createAPIFileRoute } from "@tanstack/react-start/api";
import { exchangeAuthCode } from "@/lib/zoho-sign";

/**
 * GET /api/integrations/zoho-sign/callback
 *
 * Handles the Zoho OAuth redirect, exchanges the authorization code for
 * access + refresh tokens, and stores them in the DB.
 */
export const Route = createAPIFileRoute("/api/integrations/zoho-sign/callback")({
  GET: async ({ request }) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");

    // Validate state from cookie
    const cookieHeader = request.headers.get("cookie") ?? "";
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const [k, ...v] = c.trim().split("=");
        return [k.trim(), v.join("=")];
      }),
    );
    const savedState = cookies["zoho_oauth_state"];

    if (!code) {
      return new Response("Zoho did not return an authorization code", { status: 400 });
    }
    if (!returnedState || !savedState || returnedState !== savedState) {
      return new Response("Invalid OAuth state — possible CSRF", { status: 400 });
    }

    try {
      await exchangeAuthCode(code);
    } catch (err) {
      console.error("[ZohoSign callback] token exchange failed:", err);
      const msg = err instanceof Error ? err.message : "Token exchange failed";
      const redirectUrl = new URL("/settings", request.url);
      redirectUrl.searchParams.set("zohoSignError", msg);
      return new Response(null, {
        status: 302,
        headers: {
          Location: redirectUrl.toString(),
          "Set-Cookie": `zoho_oauth_state=; Path=/; Max-Age=0`,
        },
      });
    }

    // Clear state cookie and redirect to settings
    const successUrl = new URL("/settings", request.url);
    successUrl.searchParams.set("zohoSignConnected", "1");
    return new Response(null, {
      status: 302,
      headers: {
        Location: successUrl.toString(),
        "Set-Cookie": `zoho_oauth_state=; Path=/; Max-Age=0`,
      },
    });
  },
});
