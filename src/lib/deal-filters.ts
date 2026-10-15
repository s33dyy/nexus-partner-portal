import type { DealRecord, DealStage } from "@/lib/portal-records";
import { matchesAdvancedFilters, type AdvancedFilterValues } from "@/lib/advanced-filters";

export type DealListStatusFilter = "all" | "open" | "won" | "lost" | "approved" | "submitted";
export type DealApprovalStateFilter =
  | "all"
  | "draft"
  | "submitted"
  | "approved"
  | "need_more_info"
  | "rejected";
export type DealOwnerRoleFilter = "all" | "kam" | "pam" | "partner_admin" | "partner_user";

export type DealAdvancedFilters = {
  approvalState?: Exclude<DealApprovalStateFilter, "all">;
  stage?: DealStage | "all";
  owner?: string;
  partner?: string;
  country?: string;
  region?: string;
  product?: string;
  currency?: string;
  amountMin?: number | string;
  amountMax?: number | string;
  probabilityMin?: number | string;
  probabilityMax?: number | string;
  submissionDateFrom?: string;
  submissionDateTo?: string;
  closeDateFrom?: string;
  closeDateTo?: string;
};

export type DealListFilters = {
  query: string;
  stage: DealStage | "all";
  status: DealListStatusFilter | DealApprovalStateFilter;
  ownerRole?: DealOwnerRoleFilter;
  advanced?: DealAdvancedFilters;
};

export function getDealCompanyName(deal: Pick<DealRecord, "account_name" | "company_name">) {
  return deal.company_name?.trim() || deal.account_name;
}

function getDealAmountValue(deal: DealRecord) {
  if (deal.amount_value != null) return deal.amount_value;
  const parsed = Number.parseFloat(deal.amount.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesDealAdvancedFilters(deal: DealRecord, filters: DealAdvancedFilters | undefined) {
  if (!filters) return true;

  const advancedFilters: AdvancedFilterValues = {
    approvalState: filters.approvalState,
    stage: filters.stage === "all" ? undefined : filters.stage,
    owner: filters.owner,
    partner: filters.partner,
    country: filters.country,
    region: filters.region,
    product: filters.product,
    currency: filters.currency,
    amountMin: filters.amountMin,
    amountMax: filters.amountMax,
    probabilityMin: filters.probabilityMin,
    probabilityMax: filters.probabilityMax,
    submissionDateFrom: filters.submissionDateFrom,
    submissionDateTo: filters.submissionDateTo,
    closeDateFrom: filters.closeDateFrom,
    closeDateTo: filters.closeDateTo,
  };

  return matchesAdvancedFilters(
    {
      approvalState: deal.status,
      stage: deal.stage,
      owner: deal.owner_name,
      partner: deal.partner_id,
      country: deal.country,
      region: deal.region,
      product: deal.product,
      currency: deal.currency_code,
      amount: getDealAmountValue(deal),
      probability: deal.probability,
      submissionDate: deal.created_at,
      closeDate: deal.close_date,
    },
    advancedFilters,
    [],
    { dateFields: ["submissionDate", "closeDate"] },
  );
}

export function filterDealsByView(deals: DealRecord[], filters: DealListFilters) {
  const term = filters.query.trim().toLowerCase();

  return deals.filter((deal) => {
    const matchesStage = filters.stage === "all" || deal.stage === filters.stage;
    const matchesStatus =
      filters.status === "all"
        ? true
        : filters.status === "open"
          ? !["won", "lost"].includes(deal.stage)
          : deal.status === filters.status || deal.stage === filters.status;
    const matchesOwnerRole =
      !filters.ownerRole || filters.ownerRole === "all" || deal.owner_role === filters.ownerRole;
    const matchesQuery =
      !term ||
      [
        getDealCompanyName(deal),
        deal.contact_name,
        deal.owner_name,
        deal.product,
        deal.country,
        deal.region,
        deal.partner_id,
        deal.notes,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    const matchesAdvanced = matchesDealAdvancedFilters(deal, filters.advanced);

    return matchesStage && matchesStatus && matchesOwnerRole && matchesQuery && matchesAdvanced;
  });
}
