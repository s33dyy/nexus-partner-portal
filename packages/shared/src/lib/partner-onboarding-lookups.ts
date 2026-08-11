import { LOOKUP_FIELDS } from "./lookup-fields";

export const PARTNER_ONBOARDING_LOOKUP_FIELDS = {
  country: LOOKUP_FIELDS.partnerCountry,
  businessType: LOOKUP_FIELDS.partnerBusinessType,
  annualTurnover: LOOKUP_FIELDS.partnerAnnualTurnover,
  employeeCount: LOOKUP_FIELDS.partnerEmployeeCount,
  regionPrefix: LOOKUP_FIELDS.partnerRegionPrefix,
} as const;

export function regionLookupField(country: string) {
  const key = country.trim().toLowerCase().replace(/\s+/g, "-") || "global";
  return `${PARTNER_ONBOARDING_LOOKUP_FIELDS.regionPrefix}.${key}`;
}
