import type { DealRecord, DealStage } from "@/lib/portal-records";

export type DealListStatusFilter = "all" | "open" | "won" | "lost" | "approved" | "submitted";
export type DealOwnerRoleFilter = "all" | "kam" | "pam" | "partner_admin" | "partner_user";

export type DealListFilters = {
  query: string;
  stage: DealStage | "all";
  status: DealListStatusFilter;
  ownerRole?: DealOwnerRoleFilter;
};

export function getDealCompanyName(deal: Pick<DealRecord, "account_name" | "company_name">) {
  return deal.company_name?.trim() || deal.account_name;
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

    return matchesStage && matchesStatus && matchesOwnerRole && matchesQuery;
  });
}
