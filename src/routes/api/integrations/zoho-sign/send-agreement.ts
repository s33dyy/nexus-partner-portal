import { createAPIFileRoute } from "@tanstack/react-start/api";
import { sendAgreement } from "@/lib/zoho-sign";
import { pool } from "@/server/postgres.server";

type SendAgreementBody = {
  partnerId: string;
  partnerEmail: string;
  partnerName: string;
  partnerCompany: string;
};

/**
 * POST /api/integrations/zoho-sign/send-agreement
 *
 * Called by the admin UI to send a partner agreement for signing.
 * Updates the partner record with envelope ID and sets status to pending_agreement.
 */
export const Route = createAPIFileRoute("/api/integrations/zoho-sign/send-agreement")({
  POST: async ({ request }) => {
    let body: SendAgreementBody;
    try {
      body = (await request.json()) as SendAgreementBody;
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

      // Update the partners row
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

      // Update the owner profile's status too
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
  },
});
