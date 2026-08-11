import { Hono } from "hono";

import { actorDenial, resolveActor } from "@/routes/_actor";
import { resolveDealCommandActor } from "@/server/deal-commands.server";
import {
  approvePO,
  rejectOutcome,
  requestChanges,
  submitPO,
  type ReviewOutcomeInput,
  type SubmitPOInput,
} from "@/server/outcome-review-commands.server";

export const outcomeReviewCommandRoutes = new Hono();

outcomeReviewCommandRoutes.post("/submit-po", async (c) => {
  const data = await c.req.json<SubmitPOInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await submitPO({ actor: actorResult.actor, data }));
});

outcomeReviewCommandRoutes.post("/approve-po", async (c) => {
  const data = await c.req.json<ReviewOutcomeInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await approvePO({ actor: actorResult.actor, data }));
});

outcomeReviewCommandRoutes.post("/request-changes", async (c) => {
  const data = await c.req.json<ReviewOutcomeInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await requestChanges({ actor: actorResult.actor, data }));
});

outcomeReviewCommandRoutes.post("/reject-outcome", async (c) => {
  const data = await c.req.json<ReviewOutcomeInput>();
  const actorResult = await resolveActor(resolveDealCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await rejectOutcome({ actor: actorResult.actor, data }));
});
