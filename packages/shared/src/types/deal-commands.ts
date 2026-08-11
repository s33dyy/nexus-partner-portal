export type DealWonPoChoice = "now" | "later";

export type DealRegistrationDecision = "approved" | "need_more_info" | "rejected";

export type CreateDealInput = {
  accountName: string;
  contactName: string;
  ownerName?: string | null;
  country?: string | null;
  region?: string | null;
  product: string;
  quantity?: number | null;
  amount: string;
  currencyCode?: string | null;
  amountValue?: number | null;
  amountUsd?: number | null;
  customerBudget?: string | null;
  possibleCloseDate?: string | null;
  closeDate?: string | null;
  source: string;
  notes?: string | null;
  partnerId?: string | null;
  customerId?: string | null;
  pocProfileId?: string | null;
  rewardRatePercent?: number | null;
};
