import type {
  AssistantChatMessage,
  AssistantDealDraft,
  AssistantTurnResult,
} from "@/domain/contracts/assistant";
import type { CommandExecutionResult } from "@/domain/contracts/commands";

import { apiFetch } from "./api-client";

export async function sendAssistantMessage(input: {
  conversationId?: string | null;
  message: string;
  history: AssistantChatMessage[];
}): Promise<AssistantTurnResult> {
  return apiFetch("POST", "/api/assistant/send-assistant-message", input);
}

export async function confirmAssistantDeal(input: {
  conversationId: string;
  draft: AssistantDealDraft;
}): Promise<{ reply: string; result: CommandExecutionResult; correlationId: string }> {
  return apiFetch("POST", "/api/assistant/confirm-assistant-deal", input);
}
