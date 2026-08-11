import { Hono } from "hono";

import { actorDenial, resolveActor } from "@/routes/_actor";
import { resolveDealCommandActor } from "@/server/deal-commands.server";
import {
  addDealLineItem,
  approveDiscount,
  freezePricingRevision,
  removeDealLineItem,
  requestDiscount,
  updateDealLineItem,
  type AddDealLineItemInput,
  type ApproveDiscountInput,
  type FreezePricingRevisionInput,
  type RemoveDealLineItemInput,
  type RequestDiscountInput,
  type UpdateDealLineItemInput,
} from "@/server/pricing-commands.server";

export const pricingCommandRoutes = new Hono();

pricingCommandRoutes.post("/add-deal-line-item", async (c) => {
  const data = await c.req.json<AddDealLineItemInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await addDealLineItem({ actor: actorResult.actor, data }));
});

pricingCommandRoutes.post("/update-deal-line-item", async (c) => {
  const data = await c.req.json<UpdateDealLineItemInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await updateDealLineItem({ actor: actorResult.actor, data }));
});

pricingCommandRoutes.post("/remove-deal-line-item", async (c) => {
  const data = await c.req.json<RemoveDealLineItemInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await removeDealLineItem({ actor: actorResult.actor, data }));
});

pricingCommandRoutes.post("/freeze-pricing-revision", async (c) => {
  const data = await c.req.json<FreezePricingRevisionInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await freezePricingRevision({ actor: actorResult.actor, data }));
});

pricingCommandRoutes.post("/request-discount", async (c) => {
  const data = await c.req.json<RequestDiscountInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await requestDiscount({ actor: actorResult.actor, data }));
});

pricingCommandRoutes.post("/approve-discount", async (c) => {
  const data = await c.req.json<ApproveDiscountInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await approveDiscount({ actor: actorResult.actor, data }));
});
