import { randomBytes } from "node:crypto";
import {
  buildPartnerAgreementSourceFilePath,
  exchangeAuthCode,
  getRequestStatus,
  sendAgreement,
  verifyZohoWebhookSignature,
  REDIRECT_URI,
} from "@/lib/zoho-sign";
import { removeDocumentBlobs, uploadDocumentBlob } from "@/server/livey-service.server";
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
        await markPartnerSignedPendingReview(partner.id);
        console.log(
          `[ZohoSign webhook] Partner ${partner.id} moved to signed_pending_review (requestId=${requestId})`,
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

export function parseZohoSendAgreementFormData(formData: FormData) {
  const partnerId = String(formData.get("partnerId") ?? "").trim();
  const partnerEmail = String(formData.get("partnerEmail") ?? "").trim();
  const partnerName = String(formData.get("partnerName") ?? "").trim();
  const partnerCompany = String(formData.get("partnerCompany") ?? "").trim();
  const uploadedBy = String(formData.get("uploadedBy") ?? "").trim() || null;
  const fileValue = formData.get("agreementFile") ?? formData.get("file");

  if (!partnerId) throw new Error("partnerId is required");
  if (!partnerEmail) throw new Error("partnerEmail is required");
  if (!partnerName) throw new Error("partnerName is required");
  if (!partnerCompany) throw new Error("partnerCompany is required");
  if (!(fileValue instanceof File)) {
    throw new Error("A PDF file upload is required");
  }
  const isPdf =
    fileValue.type === "application/pdf" || fileValue.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    throw new Error("The uploaded agreement file must be a PDF");
  }

  return {
    partnerId,
    partnerEmail,
    partnerName,
    partnerCompany,
    uploadedBy,
    agreementFile: fileValue,
  };
}

async function markPartnerSignedPendingReview(partnerId: string) {
  await pool.query(
    `UPDATE public.partners
     SET status = 'signed_pending_review',
         agreement_signed_at = COALESCE(agreement_signed_at, now()),
         updated_at = now()
     WHERE id = $1
       AND status <> 'approved'`,
    [partnerId],
  );
  await pool.query(
    `UPDATE public.profiles
     SET partner_status = 'signed_pending_review',
         updated_at = now()
     WHERE partner_id = $1
       AND partner_status <> 'approved'`,
    [partnerId],
  );
}

async function storeSourceAgreementUpload(input: {
  partnerId: string;
  uploadedBy: string;
  file: File;
}) {
  const sourceFilePath = buildPartnerAgreementSourceFilePath(input.partnerId);
  const uploadedBlob = await uploadDocumentBlob({
    bucket: "partner-documents",
    filePath: sourceFilePath,
    fileName: input.file.name || "agreement.pdf",
    mimeType: input.file.type || "application/pdf",
    file: input.file,
    isSeed: false,
  });
  const storedFilePath = uploadedBlob.path;

  await pool.query(
    `DELETE FROM public.partner_documents
     WHERE partner_id = $1 AND doc_type = 'agreement_source'`,
    [input.partnerId],
  );

  await pool.query(
    `INSERT INTO public.partner_documents (
       partner_id,
       uploaded_by,
       doc_type,
       file_name,
       file_path,
       mime_type,
       size_bytes,
       is_seed
     )
     VALUES ($1, $2, 'agreement_source', $3, $4, $5, $6, false)`,
    [
      input.partnerId,
      input.uploadedBy,
      input.file.name || "agreement.pdf",
      storedFilePath,
      input.file.type || "application/pdf",
      input.file.size,
    ],
  );

  await pool.query(
    `UPDATE public.partners
     SET agreement_source_doc_path = $1,
         updated_at = now()
     WHERE id = $2`,
    [storedFilePath, input.partnerId],
  );

  return storedFilePath;
}

export async function handleZohoSendAgreement(request: Request) {
  let body: ReturnType<typeof parseZohoSendAgreementFormData>;
  try {
    body = parseZohoSendAgreementFormData(await request.formData());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid multipart form data";
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { partnerId, partnerEmail, partnerName, partnerCompany, uploadedBy, agreementFile } = body;

  try {
    const partnerRes = await pool.query<{ id: string; owner_user_id: string }>(
      `SELECT id, owner_user_id FROM public.partners WHERE id = $1 LIMIT 1`,
      [partnerId],
    );
    const partner = partnerRes.rows[0];
    if (!partner) {
      return new Response(JSON.stringify({ error: "Partner not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const sourceFilePath = await storeSourceAgreementUpload({
      partnerId,
      uploadedBy: uploadedBy ?? partner.owner_user_id,
      file: agreementFile,
    });

    let result: Awaited<ReturnType<typeof sendAgreement>>;
    try {
      result = await sendAgreement({
        partnerId,
        partnerEmail,
        partnerName,
        partnerCompany,
        sourceFile: agreementFile,
      });
    } catch (err) {
      await removeDocumentBlobs([sourceFilePath]).catch(() => {});
      throw err;
    }

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
        sourceFilePath,
        requestStatus: "pending",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[ZohoSign send-agreement] error:", err);
    const msg = err instanceof Error ? err.message : "Failed to send agreement";
    return new Response(JSON.stringify({ error: msg }), {
      status: err instanceof Error && err.message === "Partner not found" ? 404 : 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function handleZohoResyncAgreement(request: Request) {
  let body: { partnerId?: string };
  try {
    body = (await request.json()) as { partnerId?: string };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const partnerId = String(body.partnerId ?? "").trim();
  if (!partnerId) {
    return new Response(JSON.stringify({ error: "partnerId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const partnerRes = await pool.query<{
      id: string;
      agreement_envelope_id: string | null;
      status: string;
    }>(
      `SELECT id, agreement_envelope_id, status
       FROM public.partners
       WHERE id = $1
       LIMIT 1`,
      [partnerId],
    );
    const partner = partnerRes.rows[0];
    if (!partner) {
      return new Response(JSON.stringify({ error: "Partner not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!partner.agreement_envelope_id) {
      return new Response(
        JSON.stringify({
          success: true,
          requestStatus: null,
          partnerStatus: partner.status,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const requestStatus = await getRequestStatus(partner.agreement_envelope_id);
    if (requestStatus === "completed") {
      await markPartnerSignedPendingReview(partnerId);
    }

    const refreshed = await pool.query<{ status: string }>(
      `SELECT status FROM public.partners WHERE id = $1 LIMIT 1`,
      [partnerId],
    );

    return new Response(
      JSON.stringify({
        success: true,
        requestStatus,
        partnerStatus: refreshed.rows[0]?.status ?? partner.status,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[ZohoSign resync-agreement] error:", err);
    const msg = err instanceof Error ? err.message : "Failed to resync agreement";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
