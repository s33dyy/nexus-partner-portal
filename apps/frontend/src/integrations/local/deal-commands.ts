import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type { DealStage } from "@livey/shared/lib/portal-records";
import type {
  CreateDealInput,
  DealRegistrationDecision,
  DealWonPoChoice,
} from "@livey/shared/types/deal-commands";

import { apiFetch } from "./api-client";

export async function createDeal(input: CreateDealInput): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/deal-commands/create-deal", input);
}

export async function moveDealStageForward(input: {
  dealId: string;
  expectedVersion: number;
  note?: string | null;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/deal-commands/move-deal-stage-forward", input);
}

export async function moveDealStageBackward(input: {
  dealId: string;
  expectedVersion: number;
  toStage: DealStage;
  reason: string;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/deal-commands/move-deal-stage-backward", input);
}

export async function markDealWon(input: {
  dealId: string;
  expectedVersion: number;
  reason?: string | null;
  outcomeDate?: string | null;
  poChoice?: DealWonPoChoice | null;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/deal-commands/mark-deal-won", input);
}

export async function markDealLost(input: {
  dealId: string;
  expectedVersion: number;
  reason: string;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/deal-commands/mark-deal-lost", input);
}

export async function submitDealForRegistration(input: {
  dealId: string;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/deal-commands/submit-deal-for-registration", input);
}

export async function reviewDealRegistration(input: {
  dealId: string;
  expectedVersion: number;
  decision: DealRegistrationDecision;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/deal-commands/review-deal-registration", input);
}
