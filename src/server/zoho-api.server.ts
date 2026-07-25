import { randomBytes } from "node:crypto";
import { exchangeAuthCode, verifyZohoWebhookSignature, sendAgreement, REDIRECT_URI } from "@/lib/zoho-sign";
import { pool } from "@/server/postgres.server";

const CLIENT_ID = process.env.ZOHO_SIGN_CLIENT_ID ?? "";
const ACCOUNTS_URL = process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.in";

export async function handleZohoConnect(request: Request) {
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

  return new Response(null, {
    status: 302,
    headers: {
      Location: redirectTo,
      "Set-Cookie": `zoho_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`,
    },
  });
}

export async function handleZohoCallback(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

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

  const successUrl = new URL("/settings", request.url);
  successUrl.searchParams.set("zohoSignConnected", "1");
  return new Response(null, {
    status: 302,
    headers: {
      Location: successUrl.toString(),
      "Set-Cookie": `zoho_oauth_state=; Path=/; Max-Age=0`,
    },
  });
}

export async function handleZohoWebhook(request: Request) {
  const rawBody = await request.text();

  const signature = request.headers.get("x-zoho-sign-signature") ?? "";
  if (!verifyZohoWebhookSignature(rawBody, signature)) {
    console.warn("[ZohoSign webhook] invalid signature");
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const requestId = payload.requests?.request_id;
  const status = payload.requests?.request_status;

  console.log(`[ZohoSign webhook] requestId=${requestId} status=${status}`);

  if (!requestId) {
    return new Response("OK — no request_id", { status: 200 });
  }

  if (status === "completed") {
    try {
      const partnerRes = await pool.query<{ id: string; owner_user_id: string }>(
        `SELECT id, owner_user_id FROM public.partners WHERE agreement_envelope_id = $1 LIMIT 1`,
        [requestId],
      );
      const partner = partnerRes.rows[0];

      if (partner) {
        await pool.query(
          `UPDATE public.partners
           SET status = 'approved',
               agreement_signed_at = now(),
               updated_at = now()
           WHERE id = $1`,
          [partner.id],
        );
        await pool.query(
          `UPDATE public.profiles
           SET partner_status = 'approved',
               updated_at = now()
           WHERE partner_id = $1`,
          [partner.id],
        );
        console.log(
          `[ZohoSign webhook] Partner ${partner.id} approved after signing (requestId=${requestId})`,
        );
      } else {
        console.warn(`[ZohoSign webhook] No partner found for requestId=${requestId}`);
      }
    } catch (err) {
      console.error("[ZohoSign webhook] DB update failed:", err);
      return new Response("Internal error", { status: 500 });
    }
  }

  return new Response("OK", { status: 200 });
}

export async function handleZohoSendAgreement(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { partnerId, partnerEmail, partnerName, partnerCompany } = body;
  if (!partnerId || !partnerEmail) {
    return new Response(JSON.stringify({ error: "partnerId and partnerEmail are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const result = await sendAgreement({ partnerEmail, partnerName, partnerCompany });

    await pool.query(
      `UPDATE public.partners
       SET agreement_envelope_id = $1,
           agreement_sent_at = now(),
           agreement_provider = 'zohosign',
           status = 'pending_agreement',
           updated_at = now()
       WHERE id = $2`,
      [result.requestId, partnerId],
    );

    await pool.query(
      `UPDATE public.profiles
       SET partner_status = 'pending_agreement',
           updated_at = now()
       WHERE partner_id = $1`,
      [partnerId],
    );

    return new Response(
      JSON.stringify({
        success: true,
        requestId: result.requestId,
        signingUrl: result.signingUrl,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[ZohoSign send-agreement] error:", err);
    const msg = err instanceof Error ? err.message : "Failed to send agreement";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
