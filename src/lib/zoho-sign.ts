/**
 * Zoho Sign API client — Indian data centre (.in)
 *
 * Handles token refresh, sends agreements, fetches envelope status,
 * and generates embedded signing URLs.
 *
 * All functions are server-only (never import from the browser bundle).
 */
import "dotenv/config";

import { pool } from "@/server/postgres.server";

// ─── Config ─────────────────────────────────────────────────────────────────

const ACCOUNTS_URL = process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.in";
const API_URL = process.env.ZOHO_SIGN_API_URL ?? "https://sign.zoho.in";
const CLIENT_ID = process.env.ZOHO_SIGN_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.ZOHO_SIGN_CLIENT_SECRET ?? "";
export const REDIRECT_URI =
  process.env.ZOHO_SIGN_REDIRECT_URI ??
  "https://systemforgelabs.xyz/api/integrations/zoho-sign/callback";

// Simple HTML agreement used when no Zoho template ID is configured
const DUMMY_AGREEMENT_HTML = `
<html><body style="font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 20px">
<h1 style="font-size:24px">LIVEY Partner Agreement</h1>
<p><strong>Effective Date:</strong> {{date}}</p>
<hr/>
<p>This Partner Agreement ("Agreement") is entered into between <strong>LIVEY Technologies</strong>
("Company") and the undersigned partner entity ("Partner").</p>
<h2 style="font-size:18px">1. Appointment</h2>
<p>The Company appoints Partner as a non-exclusive reseller/referral partner for LIVEY products
and services in the territory agreed upon.</p>
<h2 style="font-size:18px">2. Partner Obligations</h2>
<p>Partner shall (a) actively promote LIVEY products; (b) maintain qualified sales and technical
staff; (c) comply with LIVEY's brand and marketing guidelines.</p>
<h2 style="font-size:18px">3. Compensation</h2>
<p>Partner will receive commission as per the tier schedule communicated separately by LIVEY.</p>
<h2 style="font-size:18px">4. Term &amp; Termination</h2>
<p>This Agreement is valid for one (1) year and automatically renews unless terminated with 30
days' written notice by either party.</p>
<h2 style="font-size:18px">5. Confidentiality</h2>
<p>Both parties agree to keep each other's proprietary information confidential.</p>
<h2 style="font-size:18px">6. Governing Law</h2>
<p>This Agreement is governed by the laws of India.</p>
<br/><br/>
<p>By signing below, Partner agrees to all terms and conditions above.</p>
<br/>
<p>____________________________<br/>Partner Signature<br/>Name: ___________________<br/>Date: ___________________</p>
</body></html>
`;

// ─── Token management ────────────────────────────────────────────────────────

type TokenRow = {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  api_domain: string;
};

async function loadTokens(): Promise<TokenRow | null> {
  const result = await pool.query<TokenRow>(
    `SELECT id, access_token, refresh_token, expires_at, api_domain
     FROM public.zoho_sign_tokens
     ORDER BY created_at DESC LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

async function saveTokens(opts: {
  accessToken: string;
  refreshToken?: string;
  expiresInSec: number;
  apiDomain?: string;
  existingId?: string;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + opts.expiresInSec * 1000).toISOString();
  if (opts.existingId) {
    await pool.query(
      `UPDATE public.zoho_sign_tokens
       SET access_token=$1, expires_at=$2, api_domain=$3, updated_at=now()
       WHERE id=$4`,
      [opts.accessToken, expiresAt, opts.apiDomain ?? API_URL, opts.existingId],
    );
  } else {
    if (!opts.refreshToken) throw new Error("refresh_token required for initial token save");
    await pool.query(
      `INSERT INTO public.zoho_sign_tokens (access_token, refresh_token, expires_at, api_domain)
       VALUES ($1, $2, $3, $4)`,
      [opts.accessToken, opts.refreshToken, expiresAt, opts.apiDomain ?? API_URL],
    );
  }
}

/** Exchange an authorization code for access + refresh tokens and persist them. */
export async function exchangeAuthCode(code: string): Promise<void> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code,
  });
  const res = await fetch(`${ACCOUNTS_URL}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    api_domain?: string;
    error?: string;
  };
  if (!res.ok || data.error || !data.access_token)
    throw new Error(`Zoho token exchange failed: ${JSON.stringify(data)}`);

  // Delete any old token row before inserting new one
  await pool.query(`DELETE FROM public.zoho_sign_tokens`);
  await saveTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token!,
    expiresInSec: data.expires_in ?? 3600,
    apiDomain: data.api_domain,
  });
}

/** Return a valid access token, refreshing if needed. */
export async function getValidAccessToken(): Promise<{ token: string; apiDomain: string }> {
  const row = await loadTokens();
  if (!row) throw new Error("Zoho Sign not connected. Visit /api/integrations/zoho-sign/connect");

  const bufferMs = 60 * 1000; // refresh 1 min before expiry
  const isExpired = new Date(row.expires_at).getTime() - bufferMs < Date.now();

  if (!isExpired) return { token: row.access_token, apiDomain: row.api_domain };

  // Refresh
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const res = await fetch(`${ACCOUNTS_URL}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    api_domain?: string;
    error?: string;
  };
  if (!res.ok || data.error || !data.access_token)
    throw new Error(`Zoho token refresh failed: ${JSON.stringify(data)}`);

  await saveTokens({
    accessToken: data.access_token,
    expiresInSec: data.expires_in ?? 3600,
    apiDomain: data.api_domain ?? row.api_domain,
    existingId: row.id,
  });
  return { token: data.access_token, apiDomain: data.api_domain ?? row.api_domain };
}

/** Check whether Zoho Sign is connected (token stored). */
export async function isZohoSignConnected(): Promise<boolean> {
  try {
    const row = await loadTokens();
    return !!row;
  } catch {
    return false;
  }
}

// ─── Agreement API calls ──────────────────────────────────────────────────────

export type SendAgreementResult = {
  requestId: string;
  signingUrl: string | null;
};

/** Create a signing request in Zoho Sign and return the request ID + signing URL. */
export async function sendAgreement(opts: {
  partnerEmail: string;
  partnerName: string;
  partnerCompany: string;
}): Promise<SendAgreementResult> {
  const { token } = await getValidAccessToken();

  // Zoho Sign API always uses sign.zoho.in for India DC (not the token's api_domain)
  const apiDomain = process.env.ZOHO_SIGN_API_URL ?? "https://sign.zoho.in";

  const templateId = process.env.ZOHO_SIGN_TEMPLATE_ID;

  let requestId: string;
  let signingUrl: string | null = null;

  if (templateId) {
    // Use a pre-built Zoho Sign template
    const payload = {
      templates: {
        field_data: {
          field_text_data: {
            "Partner Name": opts.partnerName,
            "Partner Company": opts.partnerCompany,
            Date: new Date().toLocaleDateString("en-IN"),
          },
        },
        actions: [
          {
            recipient_name: opts.partnerName,
            recipient_email: opts.partnerEmail,
            action_type: "SIGN",
            private_notes: "Please review and sign the LIVEY Partner Agreement.",
            signing_order: 1,
            verify_recipient: false,
          },
        ],
        notes: "LIVEY Partner Agreement — please sign at your earliest convenience.",
      },
    };

    const res = await fetch(
      `${apiDomain}/api/v1/templates/${templateId}/createdocument`,
      {
        method: "POST",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    const data = (await res.json()) as {
      requests?: { request_id?: string };
      status?: string;
      message?: string;
    };
    if (!res.ok || !data.requests?.request_id)
      throw new Error(`Zoho Sign template request failed: ${JSON.stringify(data)}`);
    requestId = data.requests.request_id;
  } else {
    // No template — create document from HTML content
    const agreementHtml = DUMMY_AGREEMENT_HTML.replace(
      "{{date}}",
      new Date().toLocaleDateString("en-IN"),
    );
    const htmlBlob = new Blob([agreementHtml], { type: "text/html" });

    // Step 1: upload the document
    const formData = new FormData();
    formData.append("file", htmlBlob, "partner-agreement.html");

    const uploadRes = await fetch(`${apiDomain}/api/v1/documents`, {
      method: "POST",
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
      body: formData,
    });
    const uploadData = (await uploadRes.json()) as {
      documents?: { document_ids?: Array<{ document_id?: string }> };
      message?: string;
    };
    if (!uploadRes.ok || !uploadData.documents?.document_ids?.[0]?.document_id)
      throw new Error(`Zoho Sign document upload failed: ${JSON.stringify(uploadData)}`);
    const docId = uploadData.documents.document_ids[0].document_id!;

    // Step 2: create a signing request
    // NOTE: Zoho Sign API has a known bug where `document_order` validation fails
    // even when correctly provided (error code 9008). The template path avoids this.
    const requestPayload = {
      requests: {
        request_name: `LIVEY Partner Agreement — ${opts.partnerCompany}`,
        actions: [
          {
            recipient_name: opts.partnerName,
            recipient_email: opts.partnerEmail,
            action_type: "SIGN",
            private_notes: "Please review and sign the LIVEY Partner Agreement.",
            signing_order: 1,
            verify_recipient: false,
            fields: {
              text_fields: [],
              signature_fields: [
                {
                  field_name: "Signature",
                  field_type_name: "Signature",
                  document_id: docId,
                  abs_width: 200,
                  abs_height: 40,
                  x_coord: 100,
                  y_coord: 600,
                  page_no: 1,
                },
              ],
            },
          },
        ],
        notes: "LIVEY Partner Agreement — please sign at your earliest convenience.",
        expiration_days: 30,
        is_sequential: true,
        reminder_period: 3,
        document_ids: [{ document_id: docId }],
        // document_order causes Zoho API bug (code 9008) - omit and let API infer
      },
    };

    const reqRes = await fetch(`${apiDomain}/api/v1/requests`, {
      method: "POST",
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });
    const reqData = (await reqRes.json()) as {
      requests?: { request_id?: string };
      message?: string;
      code?: number;
      error_param?: string;
    };
    if (!reqRes.ok || !reqData.requests?.request_id) {
      // Zoho API bug: document_order validation fails with code 9008 even when correctly provided
      if (reqData.code === 9008 && reqData.error_param === "document_order") {
        throw new Error(
          "Zoho Sign API bug: document_order validation fails (code 9008). " +
            "Workaround: Set ZOHO_SIGN_TEMPLATE_ID in environment to use a pre-built Zoho Sign template, " +
            "which uses a different API endpoint that avoids this bug. " +
            `Original error: ${reqData.message}`,
        );
      }
      throw new Error(`Zoho Sign request creation failed: ${JSON.stringify(reqData)}`);
    }
    requestId = reqData.requests.request_id;
  }

  // Try to fetch the embedded signing URL
  try {
    const urlRes = await fetch(
      `${apiDomain}/api/v1/requests/${requestId}/embeddedurl`,
      {
        method: "POST",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient_email: opts.partnerEmail,
        }),
      },
    );
    const urlData = (await urlRes.json()) as { sign_url?: string };
    signingUrl = urlData.sign_url ?? null;
  } catch {
    // Signing URL is optional — partner can use the emailed link
    signingUrl = null;
  }

  return { requestId, signingUrl };
}

/** Get the current status of a Zoho Sign request. */
export async function getRequestStatus(requestId: string): Promise<string> {
  const { token } = await getValidAccessToken();

  // Zoho Sign API always uses sign.zoho.in for India DC
  const apiDomain = process.env.ZOHO_SIGN_API_URL ?? "https://sign.zoho.in";

  const res = await fetch(`${apiDomain}/api/v1/requests/${requestId}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const data = (await res.json()) as {
    requests?: { request_status?: string };
  };
  return data.requests?.request_status ?? "unknown";
}

/** Verify Zoho Sign webhook HMAC signature. */
export function verifyZohoWebhookSignature(
  payload: string,
  receivedSignature: string,
): boolean {
  const webhookSecret = process.env.ZOHO_SIGN_WEBHOOK_SECRET;
  if (!webhookSecret) return true; // skip verification if not configured
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  const expected = createHmac("sha256", webhookSecret)
    .update(payload)
    .digest("hex");
  return expected === receivedSignature;
}
