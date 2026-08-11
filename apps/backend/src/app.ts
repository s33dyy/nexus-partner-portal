import { Hono } from "hono";
import { cors } from "hono/cors";

import { sessionAuthMiddleware } from "@/middleware/auth-context";
import { assistantRoutes } from "@/routes/assistant.routes";
import { authRoutes } from "@/routes/auth.routes";
import { dashboardMetricsRoutes } from "@/routes/dashboard-metrics.routes";
import { dealCommandRoutes } from "@/routes/deal-commands.routes";
import { digestRoutes } from "@/routes/digest.routes";
import { documentRoutes } from "@/routes/documents.routes";
import { dropdownSourceRoutes } from "@/routes/dropdown-sources.routes";
import { learningCommandRoutes } from "@/routes/learning-commands.routes";
import { lookupRoutes } from "@/routes/lookups.routes";
import { outcomeReviewCommandRoutes } from "@/routes/outcome-review-commands.routes";
import { participantCommandRoutes } from "@/routes/participant-commands.routes";
import { pricingCommandRoutes } from "@/routes/pricing-commands.routes";
import { rewardCommandRoutes } from "@/routes/reward-commands.routes";
import { roleAssignmentCommandRoutes } from "@/routes/role-assignment-commands.routes";
import { rolePermissionCommandRoutes } from "@/routes/role-permission-commands.routes";
import { taskCommandRoutes } from "@/routes/task-commands.routes";
import { ticketCommandRoutes } from "@/routes/ticket-commands.routes";
import { twilioRoutes } from "@/routes/twilio.routes";
import { userRoleCommandRoutes } from "@/routes/user-role-commands.routes";
import { queryRoutes } from "@/routes/query.routes";
import { handleGoogleCallback, handleGoogleConnect } from "@/server/google-oauth.server";
import { handleWhatsappWebhook } from "@/server/twilio.server";
import {
  handleVoiceIncoming,
  handleVoiceOutgoing,
  handleVoiceStatusCallback,
} from "@/server/twilio-voice.server";
import {
  handleZohoCallback,
  handleZohoConnect,
  handleZohoResyncAgreement,
  handleZohoSendAgreement,
  handleZohoSignUrl,
  handleZohoWebhook,
} from "@/server/zoho-api.server";
import { CORRELATION_ID_HEADER, normalizeCorrelationId } from "@/domain/contracts/telemetry";

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
    allowHeaders: ["Content-Type", "Authorization", CORRELATION_ID_HEADER],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    maxAge: 86400,
  }),
);

app.use("*", async (c, next) => {
  const correlationId = normalizeCorrelationId(c.req.header(CORRELATION_ID_HEADER));
  await next();
  c.header(CORRELATION_ID_HEADER, correlationId);
});

app.use("*", sessionAuthMiddleware);

app.onError((error, c) => {
  console.error(error);
  return c.json({ message: "Internal server error" }, 500);
});

app.get("/health", (c) => c.json({ ok: true }));

// Webhook + OAuth routes keep the exact paths the external Zoho/Google/Twilio
// consoles are already configured with. Their handlers take a raw Web Request.
app.all("/api/integrations/zoho-sign/connect", (c) => handleZohoConnect(c.req.raw));
app.all("/api/integrations/zoho-sign/callback", (c) => handleZohoCallback(c.req.raw));
app.all("/api/integrations/zoho-sign/webhook", (c) => handleZohoWebhook(c.req.raw));
app.all("/api/integrations/zoho-sign/send-agreement", (c) => handleZohoSendAgreement(c.req.raw));
app.all("/api/integrations/zoho-sign/resync-agreement", (c) =>
  handleZohoResyncAgreement(c.req.raw),
);
app.all("/api/integrations/zoho-sign/sign-url", (c) => handleZohoSignUrl(c.req.raw));
app.all("/api/auth/google/connect", (c) => handleGoogleConnect(c.req.raw));
app.all("/api/auth/google/callback", (c) => handleGoogleCallback(c.req.raw));
app.post("/api/integrations/whatsapp/webhook", (c) => handleWhatsappWebhook(c.req.raw));
app.post("/api/integrations/twilio/voice/incoming", (c) => handleVoiceIncoming(c.req.raw));
app.post("/api/integrations/twilio/voice/outgoing", (c) => handleVoiceOutgoing(c.req.raw));
app.post("/api/integrations/twilio/voice/status", (c) => handleVoiceStatusCallback(c.req.raw));

app.route("/api/auth", authRoutes);
app.route("/api/query", queryRoutes);
app.route("/api/documents", documentRoutes);
app.route("/api/dashboard-metrics", dashboardMetricsRoutes);
app.route("/api/digest", digestRoutes);
app.route("/api/task-commands", taskCommandRoutes);
app.route("/api/learning-commands", learningCommandRoutes);
app.route("/api/role-assignment-commands", roleAssignmentCommandRoutes);
app.route("/api/role-permission-commands", rolePermissionCommandRoutes);
app.route("/api/user-role-commands", userRoleCommandRoutes);
app.route("/api/participant-commands", participantCommandRoutes);
app.route("/api/outcome-review-commands", outcomeReviewCommandRoutes);
app.route("/api/reward-commands", rewardCommandRoutes);
app.route("/api/ticket-commands", ticketCommandRoutes);
app.route("/api/pricing-commands", pricingCommandRoutes);
app.route("/api/deal-commands", dealCommandRoutes);
app.route("/api/dropdown-sources", dropdownSourceRoutes);
app.route("/api/lookups", lookupRoutes);
app.route("/api/assistant", assistantRoutes);
app.route("/api/twilio", twilioRoutes);
