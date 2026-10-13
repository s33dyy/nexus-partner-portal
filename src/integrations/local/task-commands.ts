import { createServerFn } from "@tanstack/react-start";

import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type { CreateTaskInput, TaskPatch, TaskStatus } from "@/server/task-commands.server";

async function resolveActorOrDenial() {
  const { getAuthContext } = await import("@/server/livey-service.server");
  const { resolveTaskCommandActor } = await import("@/server/task-commands.server");
  const authContext = await getAuthContext();
  return resolveTaskCommandActor({
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

const createTaskFn = createServerFn({ method: "POST" })
  .validator((input: CreateTaskInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { createTask } = await import("@/server/task-commands.server");
    return createTask({ actor: actorResult.actor, data });
  });

const listTasksFn = createServerFn({ method: "GET" }).handler(async () => {
  const actorResult = await resolveActorOrDenial();
  if (!actorResult.ok) return actorDenialResult(actorResult.failure);
  const { listTasks } = await import("@/server/task-commands.server");
  return listTasks({ actor: actorResult.actor });
});

const listTaskAssigneesFn = createServerFn({ method: "GET" }).handler(async () => {
  const actorResult = await resolveActorOrDenial();
  if (!actorResult.ok) return actorDenialResult(actorResult.failure);
  const { listTaskAssignees } = await import("@/server/task-commands.server");
  return listTaskAssignees({ actor: actorResult.actor });
});

const updateTaskFn = createServerFn({ method: "POST" })
  .validator((input: { taskId: string; expectedVersion?: number; patch: TaskPatch }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { updateTask } = await import("@/server/task-commands.server");
    return updateTask({
      actor: actorResult.actor,
      taskId: data.taskId,
      expectedVersion: data.expectedVersion,
      patch: data.patch,
    });
  });

const deleteTaskFn = createServerFn({ method: "POST" })
  .validator((input: { taskId: string; expectedVersion?: number }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { deleteTask } = await import("@/server/task-commands.server");
    return deleteTask({
      actor: actorResult.actor,
      taskId: data.taskId,
      expectedVersion: data.expectedVersion,
    });
  });

const transitionTaskFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      taskId: string;
      expectedVersion: number;
      toStatus: TaskStatus;
      reason?: string | null;
    }) => input,
  )
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { transitionTask } = await import("@/server/task-commands.server");
    return transitionTask({
      actor: actorResult.actor,
      taskId: data.taskId,
      expectedVersion: data.expectedVersion,
      toStatus: data.toStatus,
      reason: data.reason ?? null,
    });
  });

const setTaskProposedCompletionFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      taskId: string;
      expectedVersion: number;
      proposedCompletionAt: string | null;
      reason?: string | null;
    }) => input,
  )
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actorResult = await resolveActorOrDenial();
    if (!actorResult.ok) return actorDenialResult(actorResult.failure);
    const { setTaskProposedCompletion } = await import("@/server/task-commands.server");
    return setTaskProposedCompletion({
      actor: actorResult.actor,
      taskId: data.taskId,
      expectedVersion: data.expectedVersion,
      proposedCompletionAt: data.proposedCompletionAt,
      reason: data.reason ?? null,
    });
  });

export async function createTask(input: CreateTaskInput): Promise<CommandExecutionResult> {
  return createTaskFn({ data: input });
}

export async function listTasks() {
  return listTasksFn();
}

export async function listTaskAssignees() {
  return listTaskAssigneesFn();
}

export async function updateTask(input: {
  taskId: string;
  expectedVersion?: number;
  patch: TaskPatch;
}): Promise<CommandExecutionResult> {
  return updateTaskFn({ data: input });
}

export async function deleteTask(input: {
  taskId: string;
  expectedVersion?: number;
}): Promise<CommandExecutionResult> {
  return deleteTaskFn({ data: input });
}

export async function transitionTask(input: {
  taskId: string;
  expectedVersion: number;
  toStatus: TaskStatus;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return transitionTaskFn({ data: input });
}

export async function setTaskProposedCompletion(input: {
  taskId: string;
  expectedVersion: number;
  proposedCompletionAt: string | null;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return setTaskProposedCompletionFn({ data: input });
}
