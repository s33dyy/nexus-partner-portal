import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type {
  ReviewOutcomeInput,
  SubmitPOInput,
} from "@livey/shared/types/outcome-review-commands";

import { apiFetch } from "./api-client";

export async function submitPO(input: SubmitPOInput): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/outcome-review-commands/submit-po", input);
}

export async function approvePO(input: ReviewOutcomeInput): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/outcome-review-commands/approve-po", input);
}

export async function requestChanges(input: ReviewOutcomeInput): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/outcome-review-commands/request-changes", input);
}

export async function rejectOutcome(input: ReviewOutcomeInput): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/outcome-review-commands/reject-outcome", input);
}
