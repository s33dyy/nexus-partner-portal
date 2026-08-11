import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type { AddTicketReplyInput, CreateTicketInput } from "@livey/shared/types/ticket-commands";

import { apiFetch } from "./api-client";

export async function createTicket(input: CreateTicketInput): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/ticket-commands/create-ticket", input);
}

export async function addTicketReply(input: AddTicketReplyInput): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/ticket-commands/add-ticket-reply", input);
}

export async function acceptTicket(input: { ticketId: string }): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/ticket-commands/accept-ticket", input);
}

export async function markTicketWaitingOnPartner(input: {
  ticketId: string;
  note?: string | null;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/ticket-commands/mark-ticket-waiting-on-partner", input);
}

export async function closeTicket(input: {
  ticketId: string;
  resolutionNote?: string | null;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/ticket-commands/close-ticket", input);
}

export async function requestReopen(input: {
  ticketId: string;
  reason: string;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/ticket-commands/request-reopen", input);
}

export async function decideReopen(input: {
  ticketId: string;
  approve: boolean;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/ticket-commands/decide-reopen", input);
}
