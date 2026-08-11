import type { DealRecord } from "./portal-records";

export type DealVisibilityContext = {
  viewerUserId: string | null;
  viewerRole: "super_admin" | "partner_admin" | "partner_user" | string;
  isSuperAdmin: boolean;
  isPartnerAdmin: boolean;
  collaboratorUserIds: string[];
};

export type DealVisibilitySource = {
  id: string;
  user_id: string | null;
  is_hidden_to_team: boolean;
};

export type DealCollaboratorSource = {
  deal_id: string;
  user_id: string;
};

export function canViewDeal(
  deal: Pick<DealRecord, "user_id" | "is_hidden_to_team">,
  context: DealVisibilityContext,
) {
  if (context.isSuperAdmin || context.isPartnerAdmin) {
    return true;
  }

  if (!deal.is_hidden_to_team) {
    return true;
  }

  if (!context.viewerUserId) {
    return false;
  }

  if (deal.user_id === context.viewerUserId) {
    return true;
  }

  return context.collaboratorUserIds.includes(context.viewerUserId);
}

export function groupCollaboratorIdsByDeal(
  collaborators: DealCollaboratorSource[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const collaborator of collaborators) {
    const current = grouped.get(collaborator.deal_id) ?? [];
    current.push(collaborator.user_id);
    grouped.set(collaborator.deal_id, current);
  }

  return grouped;
}

export function filterVisibleDeals<T extends DealVisibilitySource>(
  deals: T[],
  collaboratorIdsByDeal: Map<string, string[]>,
  context: Omit<DealVisibilityContext, "collaboratorUserIds">,
) {
  return deals.filter((deal) =>
    canViewDeal(deal, {
      ...context,
      collaboratorUserIds: collaboratorIdsByDeal.get(deal.id) ?? [],
    }),
  );
}
