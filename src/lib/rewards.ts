export const DEAL_WIN_REWARD_POINTS = 500;

export const REWARD_TIERS = [
  { tier: "Bronze", minPoints: 0 },
  { tier: "Silver", minPoints: 500 },
  { tier: "Gold", minPoints: 1500 },
  { tier: "Platinum", minPoints: 3000 },
] as const;

export type RewardTier = (typeof REWARD_TIERS)[number]["tier"];

export type RewardCatalogRecord = {
  id: string;
  title: string;
  description: string;
  image_path: string | null;
  category: string;
  points_cost: number;
  stock: number;
  availability: string;
  retired_at: string | null;
  retired_by: string | null;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
  // §15.9 gadget catalogue fields. country_eligibility empty = no
  // restriction (available everywhere).
  country_eligibility: string[];
  requires_shipping: boolean;
  fulfillment_assignee_id: string | null;
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
  idempotency_key: string | null;
  reversal_of: string | null;
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
  idempotency_key: string | null;
  version: number;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
  // Fulfillment (product.md §15.7/§15.8) — provider truth recorded once
  // approval attempts GyFTR issuance. fulfillment_voucher_code is a
  // provider secret (§15.8): never render it outside the entitled
  // recipient's own protected view, and never include it in exports.
  fulfillment_provider: string | null;
  fulfillment_reference: string | null;
  fulfillment_voucher_code: string | null;
  fulfillment_expires_at: string | null;
  fulfilled_at: string | null;
  failure_reason: string | null;
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

// Available points already reflect every reservation: requestRewardRedemption
// posts a negative `redemption_reservation` event at request time, so the
// ledger sum alone is the spendable balance. Reserved points are a separate,
// purely informational figure — never added back into availablePoints, or a
// pending request would look spendable twice.
export function rewardBalanceSummary(input: {
  events: Array<{ points_delta: number }>;
  redemptions: Array<{ status: string; points_cost: number }>;
}) {
  const availablePoints = sumRewardPoints(input.events);
  const reservedPoints = input.redemptions
    .filter((redemption) => ["points_reserved", "pending_review"].includes(redemption.status))
    .reduce((sum, redemption) => sum + Number(redemption.points_cost), 0);
  return { availablePoints, reservedPoints };
}
