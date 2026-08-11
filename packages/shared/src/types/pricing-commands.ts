export type AddDealLineItemInput = {
  dealId: string;
  productId: string;
  quantity: number;
  msrpUsd: number;
  ptpUsd: number;
  discountPct: number;
  dtpUsd: number;
  proposedSellingPriceUsd: number;
  rewardEligible: boolean;
};

export type UpdateDealLineItemInput = {
  dealId: string;
  lineItemId: string;
  quantity?: number;
  msrpUsd?: number;
  ptpUsd?: number;
  discountPct?: number;
  dtpUsd?: number;
  proposedSellingPriceUsd?: number;
  rewardEligible?: boolean;
};

export type RemoveDealLineItemInput = {
  dealId: string;
  lineItemId: string;
};

export type FreezePricingRevisionInput = {
  dealId: string;
};

export type RequestDiscountInput = {
  dealId: string;
  lineItemId: string;
  requestedDiscountPct: number;
  reason?: string;
};

export type ApproveDiscountInput = {
  dealId: string;
  requestId: string;
  approved: boolean;
};
