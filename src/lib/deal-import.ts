import {
  DEAL_PROBABILITY_OPTIONS,
  type DealProbability,
  isDealProbability,
} from "@/lib/deal-probability";
import {
  isDealCurrencyCode,
  normalizeDealCurrencyCode,
  parseDealAmount,
  type DealCurrencyCode,
} from "@/lib/portal-records";
import {
  buildImportValidationResult,
  parseSpreadsheetRows,
  type ImportValidationError,
  type ImportValidationResult,
  type TemplateColumnDefinition,
} from "@/lib/spreadsheet-import";

export const DEAL_IMPORT_TEMPLATE_COLUMNS = [
  { key: "account_name", header: "account_name" },
  { key: "contact_name", header: "contact_name" },
  { key: "owner_name", header: "owner_name" },
  { key: "country", header: "country" },
  { key: "region", header: "region" },
  { key: "product", header: "product" },
  { key: "quantity", header: "quantity" },
  { key: "amount", header: "amount" },
  { key: "currency_code", header: "currency_code" },
  { key: "customer_budget", header: "customer_budget" },
  { key: "possible_close_date", header: "possible_close_date" },
  { key: "probability", header: "probability" },
  { key: "source", header: "source" },
  { key: "notes", header: "notes" },
] as const satisfies readonly TemplateColumnDefinition[];

export const DEAL_IMPORT_TEMPLATE_SAMPLE = [
  {
    account_name: "Acme Systems",
    contact_name: "Morgan Lee",
    owner_name: "Priya Rao",
    country: "India",
    region: "India West",
    product: "LIVEY WC350 QHD Webcam",
    quantity: 1,
    amount: "$5,000",
    currency_code: "USD",
    customer_budget: "Approved",
    possible_close_date: "2026-08-15",
    probability: 50,
    source: "Partner referral",
    notes: "Expansion deal",
  },
];

export type DealImportTemplateColumn = (typeof DEAL_IMPORT_TEMPLATE_COLUMNS)[number]["key"];

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
  currency_code: DealCurrencyCode;
  customer_budget: string;
  possible_close_date: string;
  probability: DealProbability;
  source: string;
  notes: string;
};

export type DealImportValidationError = ImportValidationError;

export type DealImportValidationResult = ImportValidationResult<ValidatedDealImportRow>;

export function parseDealImportWorkbook(input: ArrayBufferLike, filename = "import.xlsx"): DealImportRow[] {
  return parseSpreadsheetRows(input, filename);
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
    const amountValue = parseDealAmount(asTrimmedString(row.amount));
    const currencyCode = normalizeDealCurrencyCode(asTrimmedString(row.currency_code));
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
      currency_code: isDealCurrencyCode(currencyCode) ? currencyCode : "INR",
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
    if (normalizedRow.amount && amountValue <= 0) {
      messages.push("Amount must include a numeric value");
    }
    if (!isDealCurrencyCode(currencyCode)) {
      messages.push("Currency must be one of INR, USD, EUR, GBP, AED, or SGD");
    }
    if (!isDealProbability(probability)) {
      messages.push("Probability must be one of 0, 25, 50, or 100");
    }
    if (!normalizedRow.source) messages.push("Source is required");

    if (messages.length > 0) {
      errors.push({ rowNumber, messages });
      return;
    }

    validatedRows.push(normalizedRow);
  });

  return buildImportValidationResult({ rows: validatedRows, errors });
}
