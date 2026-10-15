import { matchesAdvancedFilters, type AdvancedFilterValues } from "./advanced-filters";

export type CustomerFilterRecord = {
  id: string;
  company_name: string;
  account_owner: string;
  status: string;
  country?: string | null;
  region: string;
  segment: string;
  renewal_date: string;
  health_score: number;
  mrr: string;
};

export type CustomerAdvancedFilters = {
  text?: string;
  owner?: string;
  status?: string;
  country?: string;
  region?: string;
  segment?: string;
  renewalType?: string;
  credibilityMin?: number | string;
  credibilityMax?: number | string;
  employeeCountMin?: number | string;
  employeeCountMax?: number | string;
};

type EmployeeCountRange = {
  min: number;
  max: number;
};

function parseEmployeeCountRange(value: string): EmployeeCountRange | null {
  const normalized = value.trim().replace(/,/g, "");
  const rangeMatch = normalized.match(
    /^\$?([0-9]+(?:\.[0-9]+)?)\s*(?:-|–|to)\s*\$?([0-9]+(?:\.[0-9]+)?)(k)?$/i,
  );
  if (rangeMatch) {
    const multiplier = rangeMatch[3] ? 1000 : 1;
    const min = Number(rangeMatch[1]) * multiplier;
    const max = Number(rangeMatch[2]) * multiplier;
    return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
  }

  const singleMatch = normalized.match(/^\$?([0-9]+(?:\.[0-9]+)?)(k)?$/i);
  if (!singleMatch) return null;
  const valueNumber = Number(singleMatch[1]) * (singleMatch[2] ? 1000 : 1);
  return Number.isFinite(valueNumber) ? { min: valueNumber, max: valueNumber } : null;
}

function matchesEmployeeCountRange(
  value: string,
  minValue: number | string | undefined,
  maxValue: number | string | undefined,
) {
  if (minValue === undefined && maxValue === undefined) return true;
  const employeeRange = parseEmployeeCountRange(value);
  if (!employeeRange) return false;

  const min = minValue === undefined || minValue === "" ? undefined : Number(minValue);
  const max = maxValue === undefined || maxValue === "" ? undefined : Number(maxValue);
  if (min !== undefined && !Number.isFinite(min)) return false;
  if (max !== undefined && !Number.isFinite(max)) return false;
  return (
    (min === undefined || employeeRange.max >= min) &&
    (max === undefined || employeeRange.min <= max)
  );
}

export function filterCustomersByView<T extends CustomerFilterRecord>(
  customers: T[],
  filters: CustomerAdvancedFilters = {},
) {
  const advancedFilters: AdvancedFilterValues = {
    text: filters.text,
    owner: filters.owner,
    status: filters.status,
    country: filters.country,
    region: filters.region,
    segment: filters.segment,
    renewalType: filters.renewalType,
    credibilityMin: filters.credibilityMin,
    credibilityMax: filters.credibilityMax,
  };

  return customers.filter((customer) => {
    const matchesStandardFilters = matchesAdvancedFilters(
      {
        company_name: customer.company_name,
        owner: customer.account_owner,
        account_owner: customer.account_owner,
        status: customer.status,
        country: customer.country,
        region: customer.region,
        segment: customer.segment,
        renewalType: customer.renewal_date,
        credibility: customer.health_score,
      },
      advancedFilters,
      ["company_name", "account_owner"],
    );

    return (
      matchesStandardFilters &&
      matchesEmployeeCountRange(customer.mrr, filters.employeeCountMin, filters.employeeCountMax)
    );
  });
}
