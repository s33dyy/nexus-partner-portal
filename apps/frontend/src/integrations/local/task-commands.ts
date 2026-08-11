import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type { CreateTaskInput, TaskStatus } from "@livey/shared/types/task-commands";

import { apiFetch } from "./api-client";

export async function createTask(input: CreateTaskInput): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/task-commands/create-task", input);
}

export async function transitionTask(input: {
  taskId: string;
  expectedVersion: number;
  toStatus: TaskStatus;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/task-commands/transition-task", input);
}
