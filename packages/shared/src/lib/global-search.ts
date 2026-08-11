import type { GlobalSearchResult } from "./portal-records";

export type GlobalSearchSourceData = {
  deals: Array<{
    id: string;
    account_name: string;
    company_name?: string | null;
    stage: string;
  }>;
  partners: Array<{
    id: string;
    company_name: string;
    status: string;
    tier: string;
  }>;
  catalogItems: Array<{
    id: string;
    product_name: string;
    category: string;
    partner_tier: string;
    catalog_kind?: string | null;
  }>;
};

function includesQuery(query: string, values: Array<string | null | undefined>) {
  const haystack = values
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return haystack.includes(query);
}

export function buildGlobalSearchResults(
  rawQuery: string,
  sourceData: GlobalSearchSourceData,
): GlobalSearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return [];
  }

  const deals = sourceData.deals
    .filter((deal) => includesQuery(query, [deal.account_name, deal.company_name, deal.stage]))
    .slice(0, 4)
    .map((deal) => ({
      id: deal.id,
      title: deal.account_name || deal.company_name || "Untitled deal",
      subtitle: `Stage: ${deal.stage}`,
      href: "/deals",
    }));

  const partners = sourceData.partners
    .filter((partner) => includesQuery(query, [partner.company_name, partner.status, partner.tier]))
    .slice(0, 4)
    .map((partner) => ({
      id: partner.id,
      title: partner.company_name,
      subtitle: `${partner.tier} tier · ${partner.status}`,
      href: "/admin/partners",
    }));

  const catalog = sourceData.catalogItems
    .filter((item) => includesQuery(query, [item.product_name, item.category, item.partner_tier]))
    .slice(0, 4)
    .map((item) => ({
      id: item.id,
      title: item.product_name,
      subtitle: `${(item.catalog_kind ?? "product").toLowerCase() === "combo" ? "Combo" : "Product"} · ${item.category} · ${item.partner_tier}`,
      href: "/admin/catalog",
    }));

  const groups: GlobalSearchResult[] = [
    { group: "Deals", items: deals },
    { group: "Partners", items: partners },
    { group: "Product Catalog", items: catalog },
  ];

  return groups.filter((group) => group.items.length > 0);
}

export function getDashboardMetricDestination(metricId: string, isSuperAdmin: boolean) {
  switch (metricId) {
    case "pipeline":
      return "/pipeline";
    case "deals":
      return "/deals";
    case "partners":
      return isSuperAdmin ? "/admin/partners" : "/partner";
    case "customers":
      return "/customers";
    case "rewards":
      return "/rewards";
    default:
      return null;
  }
}
