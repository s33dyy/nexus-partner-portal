import { Hono } from "hono";

import { actorDenial, resolveActor } from "@/routes/_actor";
import {
  completeLesson,
  enrollInTrack,
  resolveLearningCommandActor,
  submitAssessmentAttempt,
  type CompleteLessonInput,
  type EnrollInTrackInput,
  type SubmitAssessmentInput,
} from "@/server/learning-commands.server";

export const learningCommandRoutes = new Hono();

learningCommandRoutes.post("/enroll-in-track", async (c) => {
  const data = await c.req.json<EnrollInTrackInput>();
  const actorResult = await resolveActor(resolveLearningCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await enrollInTrack({ actor: actorResult.actor, data }));
});

learningCommandRoutes.post("/submit-assessment-attempt", async (c) => {
  const data = await c.req.json<SubmitAssessmentInput>();
  const actorResult = await resolveActor(resolveLearningCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await submitAssessmentAttempt({ actor: actorResult.actor, data }));
});

learningCommandRoutes.post("/complete-lesson", async (c) => {
  const data = await c.req.json<CompleteLessonInput>();
  const actorResult = await resolveActor(resolveLearningCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await completeLesson({ actor: actorResult.actor, data }));
});
