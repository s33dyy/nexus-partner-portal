import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type {
  AdjustRewardPointsInput,
  RequestRewardRedemptionInput,
} from "@livey/shared/types/reward-commands";

import { apiFetch } from "./api-client";

export function requestRewardRedemption(
  input: RequestRewardRedemptionInput,
): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/reward-commands/request-reward-redemption", input);
}

export function approveRewardRedemption(input: {
  redemptionId: string;
  expectedVersion: number;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/reward-commands/approve-reward-redemption", input);
}

export function rejectRewardRedemption(input: {
  redemptionId: string;
  expectedVersion: number;
  reason: string;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/reward-commands/reject-reward-redemption", input);
}

export function retireRewardCatalogItem(input: {
  rewardId: string;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/reward-commands/retire-reward-catalog-item", input);
}

export function adjustRewardPoints(
  input: AdjustRewardPointsInput,
): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/reward-commands/adjust-reward-points", input);
}
