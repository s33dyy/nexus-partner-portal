import { expect, test } from "bun:test";
import { utils, write } from "xlsx";

import {
  DEAL_IMPORT_TEMPLATE_COLUMNS,
  getDealImportTemplateColumns,
  getDealImportTemplateSample,
  normalizeDealImportSpreadsheet,
  parseDealImportWorkbook,
  validateDealImportRows,
} from "@/lib/deal-import";

function toArrayBuffer(buffer: Uint8Array) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test("parseDealImportWorkbook reads rows from the first sheet of an xlsx workbook", () => {
  const workbook = utils.book_new();
  const sheet = utils.json_to_sheet([
    {
      account_name: "Acme Systems",
      contact_name: "Morgan Lee",
      owner_name: "Priya Rao",
      country: "India",
      region: "India West",
      product: "LIVEY WC350 QHD Webcam",
      quantity: 2,
      amount: "$4,999",
      currency_code: "USD",
      customer_budget: "Approved",
      possible_close_date: "2026-08-15",
      probability: 50,
      source: "Partner referral",
      notes: "Expansion deal",
    },
  ]);
  utils.book_append_sheet(workbook, sheet, "Deals");

  const workbookBytes = write(workbook, { bookType: "xlsx", type: "buffer" });
  const rows = parseDealImportWorkbook(toArrayBuffer(workbookBytes));

  expect(rows).toHaveLength(1);
  expect(rows[0]?.account_name).toBe("Acme Systems");
  expect(rows[0]?.currency_code).toBe("USD");
  expect(rows[0]?.probability).toBe(50);
});

test("validateDealImportRows rejects the whole workbook when any row is invalid", () => {
  const result = validateDealImportRows([
    {
      account_name: "Acme Systems",
      contact_name: "",
      owner_name: "Priya Rao",
      country: "India",
      region: "India West",
      product: "LIVEY WC350 QHD Webcam",
      quantity: 0,
      amount: "",
      currency_code: "BTC",
      customer_budget: "Approved",
      possible_close_date: "2026-08-15",
      probability: 64,
      source: "",
      notes: "Expansion deal",
    },
  ]);

  expect(result.successCount).toBe(0);
  expect(result.rows).toEqual([]);
  expect(result.errors).toEqual([
    {
      rowNumber: 2,
      messages: [
        "Contact name is required",
        "Quantity must be at least 1",
        "Amount is required",
        "Currency must be one of INR, USD, EUR, GBP, AED, or SGD",
        "Probability must be one of 0, 25, 50, or 100",
        "Source is required",
      ],
    },
  ]);
});

test("validateDealImportRows normalizes valid rows for insertion and template columns stay stable", () => {
  const result = validateDealImportRows([
    {
      account_name: "  Acme Systems  ",
      contact_name: " Morgan Lee ",
      owner_name: " Priya Rao ",
      country: "",
      region: " India West ",
      product: " LIVEY WC350 QHD Webcam ",
      quantity: "",
      amount: " $5,000 ",
      currency_code: " usd ",
      customer_budget: "",
      possible_close_date: "2026-08-15",
      probability: "50",
      source: " Partner referral ",
      notes: " Expansion deal ",
    },
  ]);

  expect(DEAL_IMPORT_TEMPLATE_COLUMNS.map((column) => column.key)).toEqual([
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
  ]);
  expect(result.errors).toEqual([]);
  expect(result.successCount).toBe(1);
  expect(result.rows).toEqual([
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
      customer_budget: "",
      possible_close_date: "2026-08-15",
      probability: 50,
      source: "Partner referral",
      notes: "Expansion deal",
    },
  ]);
});

test("deal import templates omit auto-filled columns for partner roles", () => {
  expect(getDealImportTemplateColumns({ includeAccountName: true, includeOwnerName: false })).toEqual(
    DEAL_IMPORT_TEMPLATE_COLUMNS.filter((column) => column.key !== "owner_name"),
  );
  expect(getDealImportTemplateColumns({ includeAccountName: false, includeOwnerName: false })).toEqual(
    DEAL_IMPORT_TEMPLATE_COLUMNS.filter(
      (column) => column.key !== "account_name" && column.key !== "owner_name",
    ),
  );
  expect(getDealImportTemplateSample({ includeAccountName: false, includeOwnerName: false })[0]).toEqual({
    contact_name: "Morgan Lee",
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
  });
});

test("validateDealImportRows allows partner-role templates to omit auto-filled columns", () => {
  const partnerAdminResult = validateDealImportRows(
    [
      {
        account_name: "Acme Systems",
        contact_name: "Morgan Lee",
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
    ],
    { includeAccountName: true, includeOwnerName: false },
  );
  const partnerUserResult = validateDealImportRows(
    [
      {
        contact_name: "Morgan Lee",
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
    ],
    { includeAccountName: false, includeOwnerName: false },
  );

  expect(partnerAdminResult.errors).toEqual([]);
  expect(partnerUserResult.errors).toEqual([]);
});

test("validateDealImportRows defaults a blank currency to INR", () => {
  const result = validateDealImportRows([
    {
      account_name: "Acme Systems",
      contact_name: "Morgan Lee",
      owner_name: "Priya Rao",
      country: "India",
      region: "India West",
      product: "LIVEY WC350 QHD Webcam",
      quantity: 2,
      amount: "5000",
      currency_code: "",
      customer_budget: "Approved",
      possible_close_date: "2026-08-15",
      probability: 50,
      source: "Partner referral",
      notes: "Expansion deal",
    },
  ]);

  expect(result.errors).toEqual([]);
  expect(result.rows[0]?.currency_code).toBe("INR");
});

test("validateDealImportRows requires amount strings to contain a numeric value", () => {
  const result = validateDealImportRows([
    {
      account_name: "Acme Systems",
      contact_name: "Morgan Lee",
      owner_name: "Priya Rao",
      country: "India",
      region: "India West",
      product: "LIVEY WC350 QHD Webcam",
      quantity: 1,
      amount: "TBD",
      currency_code: "USD",
      customer_budget: "Approved",
      possible_close_date: "2026-08-15",
      probability: 50,
      source: "Partner referral",
      notes: "Expansion deal",
    },
  ]);

  expect(result.rows).toEqual([]);
  expect(result.errors).toEqual([
    {
      rowNumber: 2,
      messages: ["Amount must include a numeric value"],
    },
  ]);
});

test("normalizeDealImportSpreadsheet accepts export-style deal headers", () => {
  const normalized = normalizeDealImportSpreadsheet({
    headers: [
      "Account",
      "Client",
      "Owner",
      "Country",
      "Region",
      "Product",
      "Quantity",
      "Amount",
      "Currency",
      "Customer Budget",
      "Possible Close Date",
      "Probability",
      "Source",
      "Notes",
    ],
    rows: [
      {
        Account: "Northstar Systems",
        Client: "Repro Client",
        Owner: "Maya Chen",
        Country: "India",
        Region: "India West",
        Product: "LIVEY WC350 QHD Webcam",
        Quantity: 1,
        Amount: "5000",
        Currency: "INR",
        "Customer Budget": "Approved",
        "Possible Close Date": "2026-08-15",
        Probability: 50,
        Source: "Partner referral",
        Notes: "Imported from export headers",
      },
    ],
  });

  expect(normalized.headers).toEqual(DEAL_IMPORT_TEMPLATE_COLUMNS.map((column) => column.header));
  expect(normalized.rows).toEqual([
    {
      account_name: "Northstar Systems",
      contact_name: "Repro Client",
      owner_name: "Maya Chen",
      country: "India",
      region: "India West",
      product: "LIVEY WC350 QHD Webcam",
      quantity: 1,
      amount: "5000",
      currency_code: "INR",
      customer_budget: "Approved",
      possible_close_date: "2026-08-15",
      probability: 50,
      source: "Partner referral",
      notes: "Imported from export headers",
    },
  ]);
});
