import { read, utils } from "xlsx";

import {
  DEAL_PROBABILITY_OPTIONS,
  type DealProbability,
  isDealProbability,
} from "@/lib/deal-probability";

export const DEAL_IMPORT_TEMPLATE_COLUMNS = [
  "account_name",
  "contact_name",
  "owner_name",
  "country",
  "region",
  "product",
  "quantity",
  "amount",
  "customer_budget",
  "possible_close_date",
  "probability",
  "source",
  "notes",
] as const;

export type DealImportTemplateColumn = (typeof DEAL_IMPORT_TEMPLATE_COLUMNS)[number];

export type DealImportRow = Record<string, unknown>;

export type ValidatedDealImportRow = {
  account_name: string;
  contact_name: string;
  owner_name: string;
  country: string;
  region: string;
  product: string;
  quantity: number;
  amount: string;
  customer_budget: string;
  possible_close_date: string;
  probability: DealProbability;
  source: string;
  notes: string;
};

export type DealImportValidationError = {
  rowNumber: number;
  messages: string[];
};

export type DealImportValidationResult = {
  successCount: number;
  rows: ValidatedDealImportRow[];
  errors: DealImportValidationError[];
};

export function parseDealImportWorkbook(input: ArrayBuffer): DealImportRow[] {
  const workbook = read(input, { type: "array" });
  const [firstSheetName] = workbook.SheetNames;
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return [];
  return utils.sheet_to_json<DealImportRow>(sheet, { defval: "" });
}

function asTrimmedString(value: unknown) {
  return String(value ?? "").trim();
}

function parsePositiveInteger(value: unknown) {
  const raw = asTrimmedString(value);
  if (!raw) return 1;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function parseProbability(value: unknown) {
  const raw = asTrimmedString(value);
  if (!raw) return Number.NaN;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function validateDealImportRows(rows: DealImportRow[]): DealImportValidationResult {
  const validatedRows: ValidatedDealImportRow[] = [];
  const errors: DealImportValidationError[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const messages: string[] = [];
    const quantity = parsePositiveInteger(row.quantity);
    const probability = parseProbability(row.probability);

    const normalizedRow: ValidatedDealImportRow = {
      account_name: asTrimmedString(row.account_name),
      contact_name: asTrimmedString(row.contact_name),
      owner_name: asTrimmedString(row.owner_name),
      country: asTrimmedString(row.country) || "India",
      region: asTrimmedString(row.region),
      product: asTrimmedString(row.product),
      quantity: Number.isNaN(quantity) ? 1 : quantity,
      amount: asTrimmedString(row.amount),
      customer_budget: asTrimmedString(row.customer_budget),
      possible_close_date: asTrimmedString(row.possible_close_date),
      probability: isDealProbability(probability) ? probability : DEAL_PROBABILITY_OPTIONS[0].value,
      source: asTrimmedString(row.source),
      notes: asTrimmedString(row.notes),
    };

    if (!normalizedRow.account_name) messages.push("Account name is required");
    if (!normalizedRow.contact_name) messages.push("Contact name is required");
    if (!normalizedRow.owner_name) messages.push("Owner name is required");
    if (!normalizedRow.region) messages.push("Region is required");
    if (!normalizedRow.product) messages.push("Product is required");
    if (Number.isNaN(quantity) || quantity < 1) messages.push("Quantity must be at least 1");
    if (!normalizedRow.amount) messages.push("Amount is required");
    if (!isDealProbability(probability)) {
      messages.push("Probability must be one of 0, 25, 50, 75, or 100");
    }
    if (!normalizedRow.source) messages.push("Source is required");

    if (messages.length > 0) {
      errors.push({ rowNumber, messages });
      return;
    }

    validatedRows.push(normalizedRow);
  });

  return {
    successCount: errors.length > 0 ? 0 : validatedRows.length,
    rows: errors.length > 0 ? [] : validatedRows,
    errors,
  };
}
