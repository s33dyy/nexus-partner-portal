import type { CommandExecutionResult } from "@/domain/contracts/commands";

import { apiFetch } from "./api-client";

export async function assignGovernedRole(input: {
  targetUserId: string;
  roleKey: string;
  geographyCeilingNodeId?: string | null;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  return apiFetch("POST", "/api/role-assignment-commands/assign-governed-role", input);
}
