import { createAPIFileRoute } from "@tanstack/react-start/api";
import { verifyZohoWebhookSignature } from "@/lib/zoho-sign";
import { pool } from "@/server/postgres.server";

type ZohoSignWebhookPayload = {
  notification_type?: string;
  requests?: {
    request_id?: string;
    request_status?: string;
    actions?: Array<{
      action_type?: string;
      action_status?: string;
      recipient_email?: string;
    }>;
  };
};

/**
 * POST /api/integrations/zoho-sign/webhook
 *
 * Receives Zoho Sign event notifications. When a document is fully signed
 * (status = "completed"), automatically upgrades the partner to "approved".
 *
 * Register this URL in Zoho Sign Settings → Notifications:
 *   https://systemforgelabs.xyz/api/integrations/zoho-sign/webhook
 */
export const Route = createAPIFileRoute("/api/integrations/zoho-sign/webhook")({
  POST: async ({ request }) => {
    const rawBody = await request.text();

    // Verify HMAC signature if webhook secret is configured
    const signature = request.headers.get("x-zoho-sign-signature") ?? "";
    if (!verifyZohoWebhookSignature(rawBody, signature)) {
      console.warn("[ZohoSign webhook] invalid signature");
      return new Response("Unauthorized", { status: 401 });
    }

    let payload: ZohoSignWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as ZohoSignWebhookPayload;
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    const requestId = payload.requests?.request_id;
    const status = payload.requests?.request_status;

    console.log(`[ZohoSign webhook] requestId=${requestId} status=${status}`);

    if (!requestId) {
      return new Response("OK — no request_id", { status: 200 });
    }

    // When all signers have completed, transition partner to approved
    if (status === "completed") {
      try {
        // Find the partner by agreement_envelope_id
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

          // Insert a notification for the partner
          await pool.query(
            `INSERT INTO public.notifications (partner_id, title, message, type)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [
              partner.id,
              "Agreement Signed — You now have full portal access!",
              "Congratulations! Your partner agreement has been signed and your account is now fully activated.",
              "status_change",
            ],
          ).catch(() => {
            // notifications table may not exist yet — ignore
          });
        } else {
          console.warn(`[ZohoSign webhook] No partner found for requestId=${requestId}`);
        }
      } catch (err) {
        console.error("[ZohoSign webhook] DB update failed:", err);
        return new Response("Internal error", { status: 500 });
      }
    }

    return new Response("OK", { status: 200 });
  },
});
