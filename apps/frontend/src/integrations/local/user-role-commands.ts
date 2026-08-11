import type { CommandExecutionResult } from "@/domain/contracts/commands";

import { apiFetch } from "./api-client";

export async function changeUserRole(input: {
  targetUserId: string;
  newRole: string;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/user-role-commands/change-user-role", input);
}
