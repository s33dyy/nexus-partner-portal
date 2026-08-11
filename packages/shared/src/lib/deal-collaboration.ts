import { parseDealAmount } from "./portal-records";

export type DealCollaboratorRecord = {
  id?: string;
  deal_id: string;
  user_id: string;
  split_percent: number;
  sort_order: number;
  is_seed?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type DealCollaboratorInput = Pick<
  DealCollaboratorRecord,
  "user_id" | "split_percent" | "sort_order"
>;

export type DealCollaboratorInsert = DealCollaboratorInput &
  Pick<DealCollaboratorRecord, "deal_id" | "is_seed">;

export type DealCollaboratorDraft = {
  userId: string;
  splitPercent: number;
  sortOrder: number;
};

export type DealRewardAllocation = {
  dealId: string;
  userId: string;
  points: number;
};

export type CollaboratorMemberOption = {
  id: string;
};

export function buildPresetCollaboratorSplits(collaboratorCount: number): number[] {
  if (collaboratorCount === 1) return [100];
  if (collaboratorCount === 2) return [60, 40];
  if (collaboratorCount === 3) return [50, 30, 20];
  if (collaboratorCount === 4) return [60, 15, 15, 15];
  throw new Error("Deals can have at most 4 collaborators");
}

export function normalizeDealCollaborators(
  collaborators: Array<Partial<DealCollaboratorRecord> & { user_id: string }>,
): DealCollaboratorDraft[] {
  return collaborators
    .map((collaborator, index) => ({
      userId: collaborator.user_id,
      splitPercent: Number(collaborator.split_percent ?? 0),
      sortOrder: Number.isFinite(Number(collaborator.sort_order))
        ? Number(collaborator.sort_order)
        : index,
    }))
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function applyPresetCollaboratorSplits(userIds: string[]): DealCollaboratorDraft[] {
  const splits = buildPresetCollaboratorSplits(userIds.length);
  return userIds.map((userId, index) => ({
    userId,
    splitPercent: splits[index] ?? 0,
    sortOrder: index,
  }));
}

export function filterAddableCollaboratorMembers<T extends CollaboratorMemberOption>(
  members: T[],
  collaborators: DealCollaboratorDraft[],
  currentUserId?: string | null,
) {
  const selectedIds = new Set(collaborators.map((collaborator) => collaborator.userId));

  return members.filter((member) => {
    if (selectedIds.has(member.id)) return false;
    if (currentUserId && member.id === currentUserId) return false;
    return true;
  });
}

export function rebalanceCollaboratorSplits(
  collaborators: DealCollaboratorDraft[],
): DealCollaboratorDraft[] {
  const ordered = [...collaborators].sort((left, right) => left.sortOrder - right.sortOrder);
  if (ordered.length === 0) return [];
  if (ordered.length === 1) {
    return [{ ...ordered[0], splitPercent: 100, sortOrder: 0 }];
  }

  const normalized = ordered.map((collaborator, index) => ({
    ...collaborator,
    splitPercent: Math.max(0, Number(collaborator.splitPercent) || 0),
    sortOrder: index,
  }));

  const fixedTotal = normalized
    .slice(0, -1)
    .reduce((sum, collaborator) => sum + collaborator.splitPercent, 0);
  normalized[normalized.length - 1] = {
    ...normalized[normalized.length - 1],
    splitPercent: Math.max(0, 100 - fixedTotal),
  };

  return normalized;
}

export function buildDealCollaboratorPayloads(
  dealId: string,
  collaborators: DealCollaboratorDraft[],
): DealCollaboratorInsert[] {
  return [...collaborators]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((collaborator, index) => ({
      deal_id: dealId,
      user_id: collaborator.userId,
      split_percent: collaborator.splitPercent,
      sort_order: index,
      is_seed: false,
    }));
}

export function isDealCollaboratorEditingLocked(input: { stage: string; status: string }) {
  return ["won", "lost"].includes(input.stage) || ["won", "lost"].includes(input.status);
}

export function calculateDealRewardAllocations(input: {
  dealId: string;
  dealAmount: string | number;
  rewardRatePercent: number;
  collaborators: Array<{
    userId: string;
    splitPercent: number;
    sortOrder: number;
  }>;
}): DealRewardAllocation[] {
  const totalPoints = Math.round(
    (parseDealAmount(input.dealAmount) * input.rewardRatePercent) / 100,
  );
  if (totalPoints <= 0) return [];

  const collaborators = [...input.collaborators].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  if (collaborators.length === 0) return [];

  const allocations = collaborators.map((collaborator) => {
    const points = Math.round((totalPoints * collaborator.splitPercent) / 100);
    return {
      dealId: input.dealId,
      userId: collaborator.userId,
      points,
    };
  });

  const assigned = allocations.reduce((sum, allocation) => sum + allocation.points, 0);
  const remainder = totalPoints - assigned;
  if (remainder !== 0 && allocations[0]) {
    allocations[0] = {
      ...allocations[0],
      points: allocations[0].points + remainder,
    };
  }

  return allocations.filter((allocation) => allocation.points !== 0);
}
