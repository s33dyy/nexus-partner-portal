import { Hono } from "hono";

import { actorDenial, resolveActor } from "@/routes/_actor";
import { resolveDealCommandActor } from "@/server/deal-commands.server";
import {
  tagCustomerParticipant,
  tagDealParticipant,
  untagCustomerParticipant,
  untagDealParticipant,
  type TagCustomerParticipantInput,
  type TagDealParticipantInput,
  type UntagCustomerParticipantInput,
  type UntagDealParticipantInput,
} from "@/server/participant-commands.server";

export const participantCommandRoutes = new Hono();

participantCommandRoutes.post("/tag-deal-participant", async (c) => {
  const data = await c.req.json<TagDealParticipantInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await tagDealParticipant({ actor: actorResult.actor, data }));
});

participantCommandRoutes.post("/untag-deal-participant", async (c) => {
  const data = await c.req.json<UntagDealParticipantInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await untagDealParticipant({ actor: actorResult.actor, data }));
});

participantCommandRoutes.post("/tag-customer-participant", async (c) => {
  const data = await c.req.json<TagCustomerParticipantInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await tagCustomerParticipant({ actor: actorResult.actor, data }));
});

participantCommandRoutes.post("/untag-customer-participant", async (c) => {
  const data = await c.req.json<UntagCustomerParticipantInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await untagCustomerParticipant({ actor: actorResult.actor, data }));
});
