import type { DealRecord, DealStage } from "@/lib/portal-records";

export type DealListStatusFilter = "all" | "open" | "won" | "lost" | "approved" | "submitted";

export type DealListFilters = {
  query: string;
  stage: DealStage | "all";
  status: DealListStatusFilter;
};

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
    const matchesQuery =
      !term ||
      [
        deal.account_name,
        deal.contact_name,
        deal.owner_name,
        deal.product,
        deal.country,
        deal.region,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);

    return matchesStage && matchesStatus && matchesQuery;
  });
}
