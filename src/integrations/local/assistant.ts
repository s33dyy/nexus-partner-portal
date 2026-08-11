import { createServerFn } from "@tanstack/react-start";

import type {
  AssistantChatMessage,
  AssistantDealDraft,
  AssistantTurnResult,
} from "@/domain/contracts/assistant";
import type { CommandExecutionResult } from "@/domain/contracts/commands";

const sendAssistantMessageFn = createServerFn({ method: "POST" })
  .validator(
    (input: { conversationId?: string | null; message: string; history: AssistantChatMessage[] }) =>
      input,
  )
  .handler(async ({ data }): Promise<AssistantTurnResult> => {
    const { sendAssistantMessage } = await import("@/server/assistant.server");
    return sendAssistantMessage(data);
  });

const confirmAssistantDealFn = createServerFn({ method: "POST" })
  .validator((input: { conversationId: string; draft: AssistantDealDraft }) => input)
  .handler(
    async ({
      data,
    }): Promise<{ reply: string; result: CommandExecutionResult; correlationId: string }> => {
      const { confirmAssistantDeal } = await import("@/server/assistant.server");
      return confirmAssistantDeal(data);
    },
  );

export async function sendAssistantMessage(input: {
  conversationId?: string | null;
  message: string;
  history: AssistantChatMessage[];
}): Promise<AssistantTurnResult> {
  return sendAssistantMessageFn({ data: input });
}

export async function confirmAssistantDeal(input: {
  conversationId: string;
  draft: AssistantDealDraft;
}): Promise<{ reply: string; result: CommandExecutionResult; correlationId: string }> {
  return confirmAssistantDealFn({ data: input });
}
