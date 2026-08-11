import { createServerFn } from "@tanstack/react-start";

import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type { AddTicketReplyInput, CreateTicketInput } from "@/server/ticket-commands.server";

async function resolveActorOrDenial() {
  const { getAuthContext } = await import("@/server/livey-service.server");
  const { resolveTicketCommandActor } = await import("@/server/ticket-commands.server");
  const authContext = await getAuthContext();
  return resolveTicketCommandActor({
    userId: authContext.session?.user.id ?? null,
    assignment: authContext.assignment,
    activeContext: authContext.activeContext,
  });
}

async function actorDenialResult(
  failure: Extract<Awaited<ReturnType<typeof resolveActorOrDenial>>, { ok: false }>["failure"],
): Promise<CommandExecutionResult> {
  const { createCorrelationId } = await import("@/domain/contracts/telemetry");
  return { ok: false, failure, correlationId: createCorrelationId() };
}

const createTicketFn = createServerFn({ method: "POST" })
  .validator((input: CreateTicketInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { createTicket } = await import("@/server/ticket-commands.server");
    return createTicket({ actor: actorResult.actor, data });
  });

const addTicketReplyFn = createServerFn({ method: "POST" })
  .validator((input: AddTicketReplyInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { addTicketReply } = await import("@/server/ticket-commands.server");
    return addTicketReply({ actor: actorResult.actor, data });
  });

const acceptTicketFn = createServerFn({ method: "POST" })
  .validator((input: { ticketId: string }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { acceptTicket } = await import("@/server/ticket-commands.server");
    return acceptTicket({ actor: actorResult.actor, ticketId: data.ticketId });
  });

const markTicketWaitingOnPartnerFn = createServerFn({ method: "POST" })
  .validator((input: { ticketId: string; note?: string | null }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { markTicketWaitingOnPartner } = await import("@/server/ticket-commands.server");
    return markTicketWaitingOnPartner({
      actor: actorResult.actor,
      ticketId: data.ticketId,
      note: data.note ?? null,
    });
  });

const closeTicketFn = createServerFn({ method: "POST" })
  .validator((input: { ticketId: string; resolutionNote?: string | null }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { closeTicket } = await import("@/server/ticket-commands.server");
    return closeTicket({
      actor: actorResult.actor,
      ticketId: data.ticketId,
      resolutionNote: data.resolutionNote ?? null,
    });
  });

const requestReopenFn = createServerFn({ method: "POST" })
  .validator((input: { ticketId: string; reason: string }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { requestReopen } = await import("@/server/ticket-commands.server");
    return requestReopen({
      actor: actorResult.actor,
      ticketId: data.ticketId,
      reason: data.reason,
    });
  });

const decideReopenFn = createServerFn({ method: "POST" })
  .validator((input: { ticketId: string; approve: boolean; reason?: string | null }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { decideReopen } = await import("@/server/ticket-commands.server");
    return decideReopen({
      actor: actorResult.actor,
      ticketId: data.ticketId,
      approve: data.approve,
      reason: data.reason ?? null,
    });
  });

export async function createTicket(input: CreateTicketInput): Promise<CommandExecutionResult> {
  return createTicketFn({ data: input });
}

export async function addTicketReply(input: AddTicketReplyInput): Promise<CommandExecutionResult> {
  return addTicketReplyFn({ data: input });
}

export async function acceptTicket(input: { ticketId: string }): Promise<CommandExecutionResult> {
  return acceptTicketFn({ data: input });
}

export async function markTicketWaitingOnPartner(input: {
  ticketId: string;
  note?: string | null;
}): Promise<CommandExecutionResult> {
  return markTicketWaitingOnPartnerFn({ data: input });
}

export async function closeTicket(input: {
  ticketId: string;
  resolutionNote?: string | null;
}): Promise<CommandExecutionResult> {
  return closeTicketFn({ data: input });
}

export async function requestReopen(input: {
  ticketId: string;
  reason: string;
}): Promise<CommandExecutionResult> {
  return requestReopenFn({ data: input });
}

export async function decideReopen(input: {
  ticketId: string;
  approve: boolean;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return decideReopenFn({ data: input });
}
