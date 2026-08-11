import { Hono } from "hono";

import { actorDenial, resolveActor } from "@/routes/_actor";
import {
  createTask,
  resolveTaskCommandActor,
  transitionTask,
  type CreateTaskInput,
  type TaskStatus,
} from "@/server/task-commands.server";

export const taskCommandRoutes = new Hono();

taskCommandRoutes.post("/create-task", async (c) => {
  const data = await c.req.json<CreateTaskInput>();
  const actorResult = await resolveActor(resolveTaskCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(await createTask({ actor: actorResult.actor, data }));
});

taskCommandRoutes.post("/transition-task", async (c) => {
  const body = await c.req.json<{
    taskId: string;
    expectedVersion: number;
    toStatus: TaskStatus;
    reason?: string | null;
  }>();
  const actorResult = await resolveActor(resolveTaskCommandActor);
  if (!actorResult.ok) return c.json(actorDenial(actorResult.failure));
  return c.json(
    await transitionTask({
      actor: actorResult.actor,
      taskId: body.taskId,
      expectedVersion: body.expectedVersion,
      toStatus: body.toStatus,
      reason: body.reason ?? null,
    }),
  );
});
