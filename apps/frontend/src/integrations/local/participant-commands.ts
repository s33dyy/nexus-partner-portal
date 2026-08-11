import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type {
  TagCustomerParticipantInput,
  TagDealParticipantInput,
  UntagCustomerParticipantInput,
  UntagDealParticipantInput,
} from "@livey/shared/types/participant-commands";

import { apiFetch } from "./api-client";

export async function tagDealParticipant(
  input: TagDealParticipantInput,
): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/participant-commands/tag-deal-participant", input);
}

export async function untagDealParticipant(
  input: UntagDealParticipantInput,
): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/participant-commands/untag-deal-participant", input);
}

export async function tagCustomerParticipant(
  input: TagCustomerParticipantInput,
): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/participant-commands/tag-customer-participant", input);
}

export async function untagCustomerParticipant(
  input: UntagCustomerParticipantInput,
): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/participant-commands/untag-customer-participant", input);
}
