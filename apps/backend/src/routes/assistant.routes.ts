import { Hono } from "hono";

import { confirmAssistantDeal, sendAssistantMessage } from "@/server/assistant.server";
import type { AssistantChatMessage, AssistantDealDraft } from "@/domain/contracts/assistant";

export const assistantRoutes = new Hono();

assistantRoutes.post("/send-assistant-message", async (c) =>
  c.json(
    await sendAssistantMessage(
      await c.req.json<{
        conversationId?: string | null;
        message: string;
        history: AssistantChatMessage[];
      }>(),
    ),
  ),
);

assistantRoutes.post("/confirm-assistant-deal", async (c) =>
  c.json(
    await confirmAssistantDeal(
      await c.req.json<{ conversationId: string; draft: AssistantDealDraft }>(),
    ),
  ),
);
