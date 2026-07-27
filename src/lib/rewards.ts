import { calculateDealRewardAllocations } from "@/lib/deal-collaboration";

export const DEAL_WIN_REWARD_POINTS = 500;

export const REWARD_TIERS = [
  { tier: "Bronze", minPoints: 0 },
  { tier: "Silver", minPoints: 500 },
  { tier: "Gold", minPoints: 1500 },
  { tier: "Platinum", minPoints: 3000 },
] as const;

export type RewardTier = (typeof REWARD_TIERS)[number]["tier"];

function makeRewardId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `reward_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

export type RewardCatalogRecord = {
  id: string;
  title: string;
  description: string;
  image_path: string | null;
  category: string;
  points_cost: number;
  stock: number;
  availability: string;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export type RewardPointEventRecord = {
  id: string;
  user_id: string | null;
  partner_id: string | null;
  source_type: string;
  source_id: string | null;
  points_delta: number;
  reason: string;
  approved_by: string | null;
  approved_at: string | null;
  is_seed: boolean;
  created_at: string;
};

export type RewardRedemptionRecord = {
  id: string;
  reward_id: string;
  user_id: string | null;
  partner_id: string | null;
  points_cost: number;
  status: string;
  shipping_name: string | null;
  shipping_address: string | null;
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

type RewardQuery = {
  select(columns?: string): RewardQuery;
  count(): RewardQuery;
  eq(column: string, value: unknown): RewardQuery;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown | null }>;
  insert(payload: Record<string, unknown>): PromiseLike<{ error: unknown | null }>;
};

type RewardDbClient = {
  from(table: string): RewardQuery;
};

type DealRewardCollaborator = {
  userId: string;
  splitPercent: number;
  sortOrder: number;
};

export function rewardTierForPoints(points: number): RewardTier {
  if (points >= 3000) return "Platinum";
  if (points >= 1500) return "Gold";
  if (points >= 500) return "Silver";
  return "Bronze";
}

export function rewardTierIndex(points: number) {
  return REWARD_TIERS.findIndex((entry) => points < entry.minPoints);
}

export function rewardProgress(points: number) {
  const currentTierIndex = [...REWARD_TIERS]
    .reverse()
    .findIndex((entry) => points >= entry.minPoints);
  const normalizedIndex = currentTierIndex < 0 ? 0 : REWARD_TIERS.length - 1 - currentTierIndex;
  const currentTier = REWARD_TIERS[normalizedIndex] ?? REWARD_TIERS[0];
  const nextTier = REWARD_TIERS[normalizedIndex + 1] ?? null;
  const pointsInTier = Math.max(points - currentTier.minPoints, 0);
  const nextThreshold = nextTier?.minPoints ?? currentTier.minPoints;
  const progress =
    nextTier === null
      ? 100
      : Math.min(100, Math.round((pointsInTier / (nextThreshold - currentTier.minPoints)) * 100));

  return {
    currentTier: currentTier.tier,
    nextTier: nextTier?.tier ?? null,
    nextThreshold: nextTier?.minPoints ?? null,
    progress,
    pointsToNext: nextTier ? Math.max(nextTier.minPoints - points, 0) : 0,
  };
}

export function sumRewardPoints(events: Array<{ points_delta: number }>) {
  return events.reduce((sum, event) => sum + Number(event.points_delta ?? 0), 0);
}

export async function awardDealWinPoints(
  db: RewardDbClient,
  input: {
    dealId: string;
    accountName: string;
    product: string;
    dealAmount: string | number;
    rewardRatePercent: number;
    collaborators: DealRewardCollaborator[];
    fallbackUserId?: string | null;
    partnerId: string | null;
    actorId: string | null;
  },
) {
  const collaborators =
    input.collaborators.length > 0
      ? input.collaborators
      : input.fallbackUserId
        ? [{ userId: input.fallbackUserId, splitPercent: 100, sortOrder: 0 }]
        : [];

  const allocations = calculateDealRewardAllocations({
    dealId: input.dealId,
    dealAmount: input.dealAmount,
    rewardRatePercent: input.rewardRatePercent,
    collaborators,
  });

  let created = 0;
  let points = 0;
  const now = new Date().toISOString();

  for (const allocation of allocations) {
    const { data: existing, error: lookupError } = await db
      .from("reward_point_events")
      .select("id")
      .eq("source_type", "deal_win")
      .eq("source_id", input.dealId)
      .eq("user_id", allocation.userId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) continue;

    const payload = {
      id: makeRewardId(),
      user_id: allocation.userId,
      partner_id: input.partnerId,
      source_type: "deal_win",
      source_id: input.dealId,
      points_delta: allocation.points,
      reason: `${input.accountName} closed won for ${input.product}`,
      approved_by: input.actorId,
      approved_at: now,
      is_seed: false,
      created_at: now,
    };
    const { error: insertError } = await db.from("reward_point_events").insert(payload);
    if (insertError) throw insertError;
    created += 1;
    points += allocation.points;
  }

  return { created, points };
}
