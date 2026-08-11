import { LOOKUP_FIELDS } from "./lookup-fields";

export const DEAL_LOOKUP_FIELDS = {
  country: LOOKUP_FIELDS.dealCountry,
  regionPrefix: LOOKUP_FIELDS.dealRegionPrefix,
} as const;

export function dealRegionLookupField(country: string) {
  const key = country.trim().toLowerCase().replace(/\s+/g, "-") || "global";
  return `${DEAL_LOOKUP_FIELDS.regionPrefix}.${key}`;
}
