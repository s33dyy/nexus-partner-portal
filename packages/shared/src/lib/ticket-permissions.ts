import type { RoleKey } from "../contracts/taxonomy";

// Mirrors SUPPORT_ROLES in ticket-commands.server.ts exactly — hiding the
// management panel from every other role is presentation only; the server
// commands (requireSupportRole) are the actual authority.
const TICKET_MANAGER_ROLES = new Set<RoleKey>(["super_admin", "livey_support"]);

export function canManageTicket(roleKey: RoleKey | null | undefined): boolean {
  return roleKey ? TICKET_MANAGER_ROLES.has(roleKey) : false;
}
