import type { DealRecord, DealStage } from "@/lib/portal-records";
import { matchesAdvancedFilters, type AdvancedFilterValues } from "@/lib/advanced-filters";

export type DealListStatusFilter = "all" | "open" | "won" | "lost" | "approved" | "submitted";
export type DealOwnerRoleFilter = "all" | "kam" | "pam" | "partner_admin" | "partner_user";

export type DealAdvancedFilters = {
  country?: string;
  region?: string;
  product?: string;
  currency?: string;
  amountMin?: number | string;
  amountMax?: number | string;
  probabilityMin?: number | string;
  probabilityMax?: number | string;
  closeDateFrom?: string;
  closeDateTo?: string;
};

export type DealListFilters = {
  query: string;
  stage: DealStage | "all";
  status: DealListStatusFilter;
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
    country: filters.country,
    region: filters.region,
    product: filters.product,
    currency: filters.currency,
    amountMin: filters.amountMin,
    amountMax: filters.amountMax,
    probabilityMin: filters.probabilityMin,
    probabilityMax: filters.probabilityMax,
    closeDateFrom: filters.closeDateFrom,
    closeDateTo: filters.closeDateTo,
  };

  return matchesAdvancedFilters(
    {
      country: deal.country,
      region: deal.region,
      product: deal.product,
      currency: deal.currency_code,
      amount: getDealAmountValue(deal),
      probability: deal.probability,
      closeDate: deal.close_date,
    },
    advancedFilters,
    [],
    { dateFields: ["closeDate"] },
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
        deal.notes,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    const matchesAdvanced = matchesDealAdvancedFilters(deal, filters.advanced);

    return matchesStage && matchesStatus && matchesOwnerRole && matchesQuery && matchesAdvanced;
  });
}
