import {
  DEAL_PROBABILITY_OPTIONS,
  type DealProbability,
  isDealProbability,
} from "@/lib/deal-probability";
import {
  DEAL_STAGE_ORDER,
  isDealCurrencyCode,
  normalizeDealCurrencyCode,
  parseDealAmount,
  type DealStage,
  type DealCurrencyCode,
} from "@/lib/portal-records";
import { dealRegionLookupField } from "@/lib/deal-lookups";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import {
  buildImportValidationResult,
  type ParsedSpreadsheet,
  type ImportValidationError,
  type ImportValidationResult,
  type TemplateColumnDefinition,
} from "@/lib/spreadsheet-import";

const DEAL_IMPORT_TEMPLATE_COLUMNS_ALL = [
  { key: "account_name", header: "account_name" },
  { key: "contact_name", header: "contact_name" },
  { key: "owner_name", header: "owner_name" },
  { key: "country", header: "country" },
  { key: "region", header: "region" },
  { key: "product", header: "product" },
  { key: "quantity", header: "quantity" },
  { key: "amount", header: "amount" },
  { key: "currency_code", header: "currency_code" },
  { key: "stage", header: "stage" },
  { key: "customer_budget", header: "customer_budget" },
  { key: "possible_close_date", header: "possible_close_date" },
  { key: "probability", header: "probability" },
  { key: "source", header: "source" },
  { key: "notes", header: "notes" },
] as const satisfies readonly TemplateColumnDefinition[];

const DEAL_IMPORT_TEMPLATE_SAMPLE_ROW = {
  account_name: "Acme Systems",
  contact_name: "Morgan Lee",
  owner_name: "Priya Rao",
  country: "India",
  region: "India West",
  product: "LIVEY WC350 QHD Webcam",
  quantity: 1,
  amount: "$5,000",
  currency_code: "USD",
  stage: "proposal",
  customer_budget: "Approved",
  possible_close_date: "2026-08-15",
  probability: 50,
  source: "Partner referral",
  notes: "Expansion deal",
} as const;

export type DealImportTemplateOptions = {
  mode?: "super_admin" | "partner";
};

const PARTNER_DEAL_IMPORT_TEMPLATE_KEYS = [
  "contact_name",
  "country",
  "region",
  "product",
  "quantity",
  "amount",
  "currency_code",
  "stage",
  "probability",
  "possible_close_date",
  "source",
] as const satisfies readonly DealImportTemplateColumn[];

const SUPER_ADMIN_DEAL_IMPORT_TEMPLATE_KEYS = [
  "account_name",
  "contact_name",
  "owner_name",
  "country",
  "region",
  "product",
  "quantity",
  "amount",
  "currency_code",
  "customer_budget",
  "possible_close_date",
  "probability",
  "source",
  "notes",
] as const satisfies readonly DealImportTemplateColumn[];

export const DEAL_IMPORT_TEMPLATE_COLUMNS = DEAL_IMPORT_TEMPLATE_COLUMNS_ALL;

export const DEAL_IMPORT_TEMPLATE_SAMPLE = [DEAL_IMPORT_TEMPLATE_SAMPLE_ROW];

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
  stage: DealStage;
  customer_budget: string;
  possible_close_date: string;
  probability: DealProbability;
  source: string;
  notes: string;
};

export type DealImportValidationError = ImportValidationError;

export type DealImportValidationResult = ImportValidationResult<ValidatedDealImportRow>;

export type DealImportLookupUpsert = {
  fieldName: string;
  value: string;
};

const DEAL_IMPORT_HEADER_ALIASES = {
  account_name: ["Account", "Account Name"],
  contact_name: ["Client", "Contact", "Contact Name"],
  owner_name: ["Owner", "POC"],
  country: ["Country"],
  region: ["Region"],
  product: ["Product"],
  quantity: ["Quantity"],
  amount: ["Amount", "Deal Value", "Value"],
  currency_code: ["Currency", "Currency Code"],
  stage: ["Stage"],
  customer_budget: ["Customer Budget", "Budget"],
  possible_close_date: ["Possible Close Date", "Probable Close Date"],
  probability: ["Probability"],
  source: ["Source"],
  notes: ["Notes"],
} as const satisfies Record<DealImportTemplateColumn, string[]>;

const DEAL_IMPORT_HEADER_LOOKUP = new Map<string, DealImportTemplateColumn>(
  DEAL_IMPORT_TEMPLATE_COLUMNS_ALL.flatMap((column) => {
    const aliases = [column.header, ...(DEAL_IMPORT_HEADER_ALIASES[column.key] ?? [])];
    return aliases.map(
      (alias) => [alias.trim().toLowerCase(), column.key] as [string, DealImportTemplateColumn],
    );
  }),
);

function resolveDealImportHeader(value: string) {
  return DEAL_IMPORT_HEADER_LOOKUP.get(value.trim().toLowerCase()) ?? value.trim();
}

export function normalizeDealImportSpreadsheet(parsed: ParsedSpreadsheet): ParsedSpreadsheet {
  const headers = parsed.headers.map((header) => resolveDealImportHeader(header));
  const rows = parsed.rows.map((row) => {
    const normalizedRow: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = resolveDealImportHeader(key);
      const existingValue = normalizedRow[normalizedKey];
      if (
        existingValue == null ||
        existingValue === "" ||
        (typeof existingValue === "string" && existingValue.trim() === "")
      ) {
        normalizedRow[normalizedKey] = value;
      }
    }
    return normalizedRow;
  });

  return { headers, rows };
}

function resolveTemplateMode(input: DealImportTemplateOptions) {
  return input.mode ?? "super_admin";
}

export function getDealImportTemplateColumns(
  input: DealImportTemplateOptions = {},
): readonly TemplateColumnDefinition[] {
  const mode = resolveTemplateMode(input);
  const allowedKeys =
    mode === "partner" ? PARTNER_DEAL_IMPORT_TEMPLATE_KEYS : SUPER_ADMIN_DEAL_IMPORT_TEMPLATE_KEYS;
  return allowedKeys.map(
    (key) => DEAL_IMPORT_TEMPLATE_COLUMNS_ALL.find((column) => column.key === key)!,
  );
}

export function getDealImportTemplateDownloadColumns(
  input: DealImportTemplateOptions = {},
): readonly TemplateColumnDefinition[] {
  const mode = resolveTemplateMode(input);
  const columns = getDealImportTemplateColumns(input);
  if (mode !== "partner") {
    return columns;
  }

  const displayHeaders: Record<string, string> = {
    contact_name: "Client",
    country: "Country",
    region: "Region",
    product: "Product",
    quantity: "Quantity",
    amount: "Amount",
    currency_code: "Currency",
    stage: "Stage",
    probability: "Probability",
    possible_close_date: "Probable Close Date",
    source: "Source",
  };

  return columns.map((column) => ({
    ...column,
    header: displayHeaders[column.key] ?? column.header,
  }));
}

export function getDealImportTemplateSample(
  input: DealImportTemplateOptions = {},
): Array<Record<string, unknown>> {
  const columns = getDealImportTemplateColumns(input);
  return [
    Object.fromEntries(
      columns.map((column) => [
        column.key,
        DEAL_IMPORT_TEMPLATE_SAMPLE_ROW[column.key as keyof typeof DEAL_IMPORT_TEMPLATE_SAMPLE_ROW],
      ]),
    ),
  ];
}

/**
 * Async because the xlsx parser is loaded on demand — see spreadsheet-parse.ts.
 * Nothing calls this on a render path; it runs from a file-upload handler.
 */
export async function parseDealImportWorkbook(
  input: ArrayBufferLike,
  filename = "import.xlsx",
): Promise<DealImportRow[]> {
  const { parseSpreadsheetRows } = await import("@/lib/spreadsheet-parse");
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

function parseStage(value: unknown) {
  const raw = asTrimmedString(value).toLowerCase();
  return DEAL_STAGE_ORDER.find((stage) => stage === raw) ?? "";
}

function isDealStage(value: string): value is DealStage {
  return (DEAL_STAGE_ORDER as readonly string[]).includes(value);
}

export function validateDealImportRows(
  rows: DealImportRow[],
  input: DealImportTemplateOptions = {},
): DealImportValidationResult {
  const mode = resolveTemplateMode(input);
  const requireAccountName = mode === "super_admin";
  const requireOwnerName = mode === "super_admin";
  const requireStage = mode === "partner";
  const validatedRows: ValidatedDealImportRow[] = [];
  const errors: DealImportValidationError[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const messages: string[] = [];
    const quantity = parsePositiveInteger(row.quantity);
    const amountValue = parseDealAmount(asTrimmedString(row.amount));
    const currencyCode = normalizeDealCurrencyCode(asTrimmedString(row.currency_code));
    const stage = parseStage(row.stage);
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
      currency_code: isDealCurrencyCode(currencyCode) ? currencyCode : "USD",
      stage: isDealStage(stage) ? stage : DEAL_STAGE_ORDER[0],
      customer_budget: asTrimmedString(row.customer_budget),
      possible_close_date: asTrimmedString(row.possible_close_date),
      probability: isDealProbability(probability) ? probability : DEAL_PROBABILITY_OPTIONS[0].value,
      source: asTrimmedString(row.source),
      notes: asTrimmedString(row.notes),
    };

    if (requireAccountName && !normalizedRow.account_name)
      messages.push("Account name is required");
    if (!normalizedRow.contact_name) messages.push("Contact name is required");
    if (requireOwnerName && !normalizedRow.owner_name) messages.push("Owner name is required");
    if (!normalizedRow.region) messages.push("Region is required");
    if (!normalizedRow.product) messages.push("Product is required");
    if (Number.isNaN(quantity) || quantity < 1) messages.push("Quantity must be at least 1");
    if (!normalizedRow.amount) messages.push("Amount is required");
    if (normalizedRow.amount && amountValue <= 0) {
      messages.push("Amount must include a numeric value");
    }
    if (!isDealCurrencyCode(currencyCode)) {
      messages.push("Currency must be a supported ISO 4217 currency code");
    }
    if (requireStage && !isDealStage(stage)) {
      messages.push(
        "Stage must be one of sourced, demo, testing, qualified, proposal, negotiation, approved, won, or lost",
      );
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

export function buildDealImportLookupUpserts(
  rows: Array<Pick<ValidatedDealImportRow, "country" | "region" | "product">>,
): DealImportLookupUpsert[] {
  const seen = new Set<string>();
  const upserts: DealImportLookupUpsert[] = [];

  const addUpsert = (fieldName: string, value: string) => {
    const normalizedValue = value.trim().replace(/\s+/g, " ");
    if (!normalizedValue) return;
    const key = `${fieldName}:${normalizedValue.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    upserts.push({ fieldName, value: normalizedValue });
  };

  for (const row of rows) {
    const country = row.country.trim() || "India";
    addUpsert(LOOKUP_FIELDS.dealCountry, country);
    addUpsert(dealRegionLookupField(country), row.region);
    addUpsert(LOOKUP_FIELDS.dealProduct, row.product);
  }

  return upserts;
}

export function getDealImportStatus(stage: DealStage, autoApproved: boolean) {
  if (stage === "won" || stage === "lost") {
    return stage;
  }

  return autoApproved ? "approved" : "submitted";
}
