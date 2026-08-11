import { Hono } from "hono";

import {
  confirmWhatsappLink,
  disconnectWhatsapp,
  requestWhatsappLink,
} from "@/server/twilio.server";
import {
  mintVoiceAccessToken,
  setCallDisposition,
  setCallReady,
} from "@/server/twilio-voice.server";

export const twilioRoutes = new Hono();

twilioRoutes.post("/request-whatsapp-link", async (c) =>
  c.json(await requestWhatsappLink(await c.req.json<{ phoneE164: string }>())),
);

twilioRoutes.post("/confirm-whatsapp-link", async (c) =>
  c.json(await confirmWhatsappLink(await c.req.json<{ phoneE164: string; code: string }>())),
);

twilioRoutes.post("/disconnect-whatsapp", async (c) => c.json(await disconnectWhatsapp()));

twilioRoutes.post("/mint-voice-access-token", async (c) => c.json(await mintVoiceAccessToken()));

twilioRoutes.post("/set-call-disposition", async (c) =>
  c.json(
    await setCallDisposition(await c.req.json<{ twilioCallSid: string; disposition: string }>()),
  ),
);

twilioRoutes.post("/set-call-ready", async (c) =>
  c.json(await setCallReady(await c.req.json<{ ready: boolean }>())),
);
