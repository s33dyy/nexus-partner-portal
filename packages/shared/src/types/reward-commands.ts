export type RequestRewardRedemptionInput = {
  rewardId: string;
  shippingName: string;
  shippingAddress: string;
  notes?: string | null;
  idempotencyKey: string;
};

export type AdjustRewardPointsInput = {
  userId: string;
  pointsDelta: number;
  reason: string;
  idempotencyKey: string;
};
