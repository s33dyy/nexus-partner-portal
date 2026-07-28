import {
  buildImportValidationResult,
  type ImportValidationError,
  type ImportValidationResult,
  type TemplateColumnDefinition,
} from "@/lib/spreadsheet-import";

export const CUSTOMER_IMPORT_TEMPLATE_COLUMNS = [
  { key: "company_name", header: "company_name" },
  { key: "account_owner", header: "account_owner" },
  { key: "region", header: "region" },
  { key: "segment", header: "segment" },
  { key: "health_score", header: "health_score" },
  { key: "mrr", header: "mrr" },
  { key: "renewal_date", header: "renewal_date" },
  { key: "status", header: "status" },
  { key: "next_step", header: "next_step" },
] as const satisfies readonly TemplateColumnDefinition[];

export const CUSTOMER_IMPORT_TEMPLATE_SAMPLE = [
  {
    company_name: "Acme Infra",
    account_owner: "Asha Mehta",
    region: "India West",
    segment: "Mid-market",
    health_score: 75,
    mrr: "$5K",
    renewal_date: "2026-09-15",
    status: "active",
    next_step: "Schedule QBR",
  },
];

export type ValidatedCustomerImportRow = {
  company_name: string;
  account_owner: string;
  region: string;
  segment: string;
  health_score: number;
  mrr: string;
  renewal_date: string;
  status: string;
  next_step: string;
  last_touch: string;
};

function normalizeString(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeInteger(value: unknown) {
  const numeric = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function isDateInput(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function validateCustomerImportRows(
  rows: Array<Record<string, unknown>>,
): ImportValidationResult<ValidatedCustomerImportRow> {
  const normalizedRows: ValidatedCustomerImportRow[] = [];
  const errors: ImportValidationError[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const companyName = normalizeString(row.company_name);
    const accountOwner = normalizeString(row.account_owner);
    const region = normalizeString(row.region);
    const segment = normalizeString(row.segment);
    const healthScore = normalizeInteger(row.health_score);
    const mrr = normalizeString(row.mrr);
    const renewalDate = normalizeString(row.renewal_date);
    const status = normalizeString(row.status);
    const nextStep = normalizeString(row.next_step);
    const lastTouch = normalizeString(row.last_touch) || "Today";
    const rowErrors: string[] = [];

    if (!companyName) rowErrors.push("company_name is required");
    if (!accountOwner) rowErrors.push("account_owner is required");
    if (!region) rowErrors.push("region is required");
    if (!segment) rowErrors.push("segment is required");
    if (!Number.isFinite(healthScore) || healthScore < 0 || healthScore > 100) {
      rowErrors.push("health_score must be between 0 and 100");
    }
    if (!mrr) rowErrors.push("mrr is required");
    if (!renewalDate) rowErrors.push("renewal_date is required");
    if (renewalDate && !isDateInput(renewalDate)) {
      rowErrors.push("renewal_date must use YYYY-MM-DD format");
    }
    if (!status) rowErrors.push("status is required");
    if (!nextStep) rowErrors.push("next_step is required");

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, messages: rowErrors });
      return;
    }

    normalizedRows.push({
      company_name: companyName,
      account_owner: accountOwner,
      region,
      segment,
      health_score: healthScore,
      mrr,
      renewal_date: renewalDate,
      status,
      next_step: nextStep,
      last_touch: lastTouch,
    });
  });

  return buildImportValidationResult({ rows: normalizedRows, errors });
}
