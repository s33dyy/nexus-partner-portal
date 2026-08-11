import { Hono } from "hono";

import { actorDenial, resolveActor } from "@/routes/_actor";
import {
  adjustRewardPoints,
  approveRewardRedemption,
  rejectRewardRedemption,
  requestRewardRedemption,
  resolveRewardCommandActor,
  retireRewardCatalogItem,
  type AdjustRewardPointsInput,
  type RequestRewardRedemptionInput,
} from "@/server/reward-commands.server";

export const rewardCommandRoutes = new Hono();

rewardCommandRoutes.post("/request-reward-redemption", async (c) => {
  const data = await c.req.json<RequestRewardRedemptionInput>();
  const actorResult = await resolveActor(resolveRewardCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await requestRewardRedemption({ actor: actorResult.actor, data }));
});

rewardCommandRoutes.post("/approve-reward-redemption", async (c) => {
  const body = await c.req.json<{ redemptionId: string; expectedVersion: number }>();
  const actorResult = await resolveActor(resolveRewardCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await approveRewardRedemption({
      actor: actorResult.actor,
      redemptionId: body.redemptionId,
      expectedVersion: body.expectedVersion,
    }),
  );
});

rewardCommandRoutes.post("/reject-reward-redemption", async (c) => {
  const body = await c.req.json<{
    redemptionId: string;
    expectedVersion: number;
    reason: string;
  }>();
  const actorResult = await resolveActor(resolveRewardCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await rejectRewardRedemption({
      actor: actorResult.actor,
      redemptionId: body.redemptionId,
      expectedVersion: body.expectedVersion,
      reason: body.reason,
    }),
  );
});

rewardCommandRoutes.post("/retire-reward-catalog-item", async (c) => {
  const body = await c.req.json<{ rewardId: string }>();
  const actorResult = await resolveActor(resolveRewardCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await retireRewardCatalogItem({ actor: actorResult.actor, rewardId: body.rewardId }),
  );
});

rewardCommandRoutes.post("/adjust-reward-points", async (c) => {
  const data = await c.req.json<AdjustRewardPointsInput>();
  const actorResult = await resolveActor(resolveRewardCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await adjustRewardPoints({ actor: actorResult.actor, data }));
});
