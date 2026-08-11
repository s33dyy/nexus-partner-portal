import { Hono } from "hono";

import type { DealStage } from "@livey/shared/lib/portal-records";
import { actorDenial, resolveActor } from "@/routes/_actor";
import {
  createDeal,
  markDealLost,
  markDealWon,
  moveDealStageBackward,
  moveDealStageForward,
  resolveDealCommandActor,
  reviewDealRegistration,
  submitDealForRegistration,
  type CreateDealInput,
  type DealRegistrationDecision,
  type DealWonPoChoice,
} from "@/server/deal-commands.server";

export const dealCommandRoutes = new Hono();

dealCommandRoutes.post("/create-deal", async (c) => {
  const data = await c.req.json<CreateDealInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await createDeal({ actor: actorResult.actor, data }));
});

dealCommandRoutes.post("/move-deal-stage-forward", async (c) => {
  const data = await c.req.json<{
    dealId: string;
    expectedVersion: number;
    note?: string | null;
  }>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await moveDealStageForward({
      actor: actorResult.actor,
      dealId: data.dealId,
      expectedVersion: data.expectedVersion,
      note: data.note ?? null,
    }),
  );
});

dealCommandRoutes.post("/move-deal-stage-backward", async (c) => {
  const data = await c.req.json<{
    dealId: string;
    expectedVersion: number;
    toStage: DealStage;
    reason: string;
  }>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await moveDealStageBackward({
      actor: actorResult.actor,
      dealId: data.dealId,
      expectedVersion: data.expectedVersion,
      toStage: data.toStage,
      reason: data.reason,
    }),
  );
});

dealCommandRoutes.post("/mark-deal-won", async (c) => {
  const data = await c.req.json<{
    dealId: string;
    expectedVersion: number;
    reason?: string | null;
    outcomeDate?: string | null;
    poChoice?: DealWonPoChoice | null;
  }>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await markDealWon({
      actor: actorResult.actor,
      dealId: data.dealId,
      expectedVersion: data.expectedVersion,
      reason: data.reason ?? null,
      outcomeDate: data.outcomeDate ?? null,
      poChoice: data.poChoice ?? null,
    }),
  );
});

dealCommandRoutes.post("/mark-deal-lost", async (c) => {
  const data = await c.req.json<{
    dealId: string;
    expectedVersion: number;
    reason: string;
  }>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await markDealLost({
      actor: actorResult.actor,
      dealId: data.dealId,
      expectedVersion: data.expectedVersion,
      reason: data.reason,
    }),
  );
});

dealCommandRoutes.post("/submit-deal-for-registration", async (c) => {
  const data = await c.req.json<{ dealId: string }>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await submitDealForRegistration({ actor: actorResult.actor, data }));
});

dealCommandRoutes.post("/review-deal-registration", async (c) => {
  const data = await c.req.json<{
    dealId: string;
    expectedVersion: number;
    decision: DealRegistrationDecision;
    reason?: string | null;
  }>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await reviewDealRegistration({
      actor: actorResult.actor,
      expectedVersion: data.expectedVersion,
      data: { dealId: data.dealId, decision: data.decision, reason: data.reason ?? null },
    }),
  );
});
