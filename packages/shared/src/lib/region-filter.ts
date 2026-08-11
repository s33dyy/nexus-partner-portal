import { resolveCountryForText, type SalesRegionKey } from "../contracts/world-geography";

export type RegionFilterValue = SalesRegionKey | "all";

/**
 * Matches a record's free-text country (e.g. portal_deals.country,
 * portal_customers.country, partners.country) against the currently
 * selected Sales Region. Unmatched country text (no governed country
 * resolves) is treated as visible under "All regions" but excluded once a
 * specific region is selected, since it can't be placed with confidence.
 */
export function matchesSelectedRegion(
  countryText: string | null | undefined,
  selectedRegion: RegionFilterValue,
): boolean {
  if (selectedRegion === "all") return true;
  const country = resolveCountryForText(countryText);
  return country?.regionKey === selectedRegion;
}
