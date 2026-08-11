import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";

export type ShellContextSnapshot = {
  assignment: AssignmentRecord | null;
  activeContext: ActiveContextRecord | null;
};

export type ShellContextSummary = {
  title: string;
  description: string;
  roleLabel: string;
  scopeLabel: string;
  statusLabel: string;
  tenantLabel: string | null;
  state: "ready" | "assignment-pending" | "context-pending";
};

function formatRoleLabel(roleKey: string | null | undefined) {
  if (!roleKey) return "Assignment pending";
  return roleKey.replace(/_/g, " ");
}

function formatScopeLabel(activeContext: ActiveContextRecord | null) {
  if (!activeContext) return "Context pending";
  return activeContext.workingScope
    ? activeContext.workingScope.replace(/_/g, " ")
    : "Organization-wide scope";
}

function formatTenantLabel(activeContext: ActiveContextRecord | null) {
  if (!activeContext) return null;
  return `Tenant ${activeContext.tenantId.slice(0, 8)}`;
}

export function buildShellContextSummary({
  assignment,
  activeContext,
}: ShellContextSnapshot): ShellContextSummary {
  const roleLabel = formatRoleLabel(assignment?.roleKey);
  const statusLabel = activeContext?.assignmentStatus ?? assignment?.status ?? "pending";
  const tenantLabel = formatTenantLabel(activeContext);

  if (!assignment) {
    return {
      title: "No governed assignment",
      description:
        "This account is signed in, but no active assignment has been issued yet. Access will appear once an administrator grants a governed assignment.",
      roleLabel,
      scopeLabel: "Context pending",
      statusLabel: "Awaiting assignment",
      tenantLabel,
      state: "assignment-pending",
    };
  }

  if (!activeContext) {
    return {
      title: "Assignment issued, context pending",
      description:
        "Your assignment exists, but the server has not issued an active context envelope yet. Try refreshing the session or contact an administrator if this persists.",
      roleLabel,
      scopeLabel: "Context pending",
      statusLabel: `Assignment ${statusLabel}`,
      tenantLabel,
      state: "context-pending",
    };
  }

  return {
    title: roleLabel,
    description: `${formatScopeLabel(activeContext)} · ${tenantLabel ?? "Tenant pending"}`,
    roleLabel,
    scopeLabel: formatScopeLabel(activeContext),
    statusLabel: `Assignment ${statusLabel}`,
    tenantLabel,
    state: "ready",
  };
}
