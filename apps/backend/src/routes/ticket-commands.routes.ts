import { Hono } from "hono";

import { actorDenial, resolveActor } from "@/routes/_actor";
import {
  acceptTicket,
  addTicketReply,
  closeTicket,
  createTicket,
  decideReopen,
  markTicketWaitingOnPartner,
  requestReopen,
  resolveTicketCommandActor,
  type AddTicketReplyInput,
  type CreateTicketInput,
} from "@/server/ticket-commands.server";

export const ticketCommandRoutes = new Hono();

ticketCommandRoutes.post("/create-ticket", async (c) => {
  const data = await c.req.json<CreateTicketInput>();
  const actorResult = await resolveActor(resolveTicketCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await createTicket({ actor: actorResult.actor, data }));
});

ticketCommandRoutes.post("/add-ticket-reply", async (c) => {
  const data = await c.req.json<AddTicketReplyInput>();
  const actorResult = await resolveActor(resolveTicketCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await addTicketReply({ actor: actorResult.actor, data }));
});

ticketCommandRoutes.post("/accept-ticket", async (c) => {
  const body = await c.req.json<{ ticketId: string }>();
  const actorResult = await resolveActor(resolveTicketCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await acceptTicket({ actor: actorResult.actor, ticketId: body.ticketId }));
});

ticketCommandRoutes.post("/mark-ticket-waiting-on-partner", async (c) => {
  const body = await c.req.json<{ ticketId: string; note?: string | null }>();
  const actorResult = await resolveActor(resolveTicketCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await markTicketWaitingOnPartner({
      actor: actorResult.actor,
      ticketId: body.ticketId,
      note: body.note ?? null,
    }),
  );
});

ticketCommandRoutes.post("/close-ticket", async (c) => {
  const body = await c.req.json<{ ticketId: string; resolutionNote?: string | null }>();
  const actorResult = await resolveActor(resolveTicketCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await closeTicket({
      actor: actorResult.actor,
      ticketId: body.ticketId,
      resolutionNote: body.resolutionNote ?? null,
    }),
  );
});

ticketCommandRoutes.post("/request-reopen", async (c) => {
  const body = await c.req.json<{ ticketId: string; reason: string }>();
  const actorResult = await resolveActor(resolveTicketCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await requestReopen({
      actor: actorResult.actor,
      ticketId: body.ticketId,
      reason: body.reason,
    }),
  );
});

ticketCommandRoutes.post("/decide-reopen", async (c) => {
  const body = await c.req.json<{ ticketId: string; approve: boolean; reason?: string | null }>();
  const actorResult = await resolveActor(resolveTicketCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await decideReopen({
      actor: actorResult.actor,
      ticketId: body.ticketId,
      approve: body.approve,
      reason: body.reason ?? null,
    }),
  );
});
