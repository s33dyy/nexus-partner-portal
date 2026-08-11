import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type {
  AddDealLineItemInput,
  ApproveDiscountInput,
  FreezePricingRevisionInput,
  RemoveDealLineItemInput,
  RequestDiscountInput,
  UpdateDealLineItemInput,
} from "@livey/shared/types/pricing-commands";

import { apiFetch } from "./api-client";

export async function addDealLineItem(
  input: AddDealLineItemInput,
): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/pricing-commands/add-deal-line-item", input);
}
export async function updateDealLineItem(
  input: UpdateDealLineItemInput,
): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/pricing-commands/update-deal-line-item", input);
}
export async function removeDealLineItem(
  input: RemoveDealLineItemInput,
): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/pricing-commands/remove-deal-line-item", input);
}
export async function freezePricingRevision(
  input: FreezePricingRevisionInput,
): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/pricing-commands/freeze-pricing-revision", input);
}
export async function requestDiscount(
  input: RequestDiscountInput,
): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/pricing-commands/request-discount", input);
}
export async function approveDiscount(
  input: ApproveDiscountInput,
): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/pricing-commands/approve-discount", input);
}
