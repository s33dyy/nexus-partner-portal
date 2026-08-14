import { expect, test } from "bun:test";
import { utils, write } from "xlsx";

import {
  buildDealImportLookupUpserts,
  DEAL_IMPORT_TEMPLATE_COLUMNS,
  getDealImportStatus,
  getDealImportTemplateColumns,
  getDealImportTemplateDownloadColumns,
  getDealImportTemplateSample,
  normalizeDealImportSpreadsheet,
  parseDealImportWorkbook,
  validateDealImportRows,
} from "@/lib/deal-import";

function toArrayBuffer(buffer: Uint8Array) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test("parseDealImportWorkbook reads rows from the first sheet of an xlsx workbook", async () => {
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
  const rows = await parseDealImportWorkbook(toArrayBuffer(workbookBytes));

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
        "Currency must be a supported ISO 4217 currency code",
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
      stage: " proposal ",
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
    "stage",
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
      stage: "proposal",
      customer_budget: "",
      possible_close_date: "2026-08-15",
      probability: 50,
      source: "Partner referral",
      notes: "Expansion deal",
    },
  ]);
});

test("partner-side deal templates use the reduced import shape", () => {
  expect(getDealImportTemplateColumns({ mode: "partner" }).map((column) => column.key)).toEqual([
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
  ]);
  expect(
    getDealImportTemplateDownloadColumns({ mode: "partner" }).map((column) => column.header),
  ).toEqual([
    "Client",
    "Country",
    "Region",
    "Product",
    "Quantity",
    "Amount",
    "Currency",
    "Stage",
    "Probability",
    "Probable Close Date",
    "Source",
  ]);
  expect(getDealImportTemplateSample({ mode: "partner" })[0]).toEqual({
    contact_name: "Morgan Lee",
    country: "India",
    region: "India West",
    product: "LIVEY WC350 QHD Webcam",
    quantity: 1,
    amount: "$5,000",
    currency_code: "USD",
    stage: "proposal",
    probability: 50,
    possible_close_date: "2026-08-15",
    source: "Partner referral",
  });
});

test("super-admin deal templates keep the wider current shape", () => {
  expect(getDealImportTemplateColumns({ mode: "super_admin" }).map((column) => column.key)).toEqual(
    [
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
    ],
  );
});

test("validateDealImportRows allows partner-role templates to omit auto-filled columns", () => {
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
        stage: "proposal",
        possible_close_date: "2026-08-15",
        probability: 50,
        source: "Partner referral",
      },
    ],
    { mode: "partner" },
  );

  expect(partnerUserResult.errors).toEqual([]);
});

test("validateDealImportRows defaults a blank currency to USD", () => {
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
      stage: "proposal",
      customer_budget: "Approved",
      possible_close_date: "2026-08-15",
      probability: 50,
      source: "Partner referral",
      notes: "Expansion deal",
    },
  ]);

  expect(result.errors).toEqual([]);
  expect(result.rows[0]?.currency_code).toBe("USD");
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
      stage: "proposal",
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

test("validateDealImportRows rejects invalid partner stages", () => {
  const result = validateDealImportRows(
    [
      {
        contact_name: "Morgan Lee",
        country: "India",
        region: "India West",
        product: "LIVEY WC350 QHD Webcam",
        quantity: 1,
        amount: "$5,000",
        currency_code: "USD",
        stage: "review",
        possible_close_date: "2026-08-15",
        probability: 50,
        source: "Partner referral",
      },
    ],
    { mode: "partner" },
  );

  expect(result.rows).toEqual([]);
  expect(result.errors).toEqual([
    {
      rowNumber: 2,
      messages: [
        "Stage must be one of sourced, demo, testing, qualified, proposal, negotiation, approved, won, or lost",
      ],
    },
  ]);
});

test("normalizeDealImportSpreadsheet accepts partner template headers and aliases", () => {
  const normalized = normalizeDealImportSpreadsheet({
    headers: [
      "Client",
      "Country",
      "Region",
      "Product",
      "Quantity",
      "Amount",
      "Currency",
      "Stage",
      "Probable Close Date",
      "Probability",
      "Source",
    ],
    rows: [
      {
        Client: "Repro Client",
        Country: "India",
        Region: "India West",
        Product: "LIVEY WC350 QHD Webcam",
        Quantity: 1,
        Amount: "5000",
        Currency: "INR",
        Stage: "proposal",
        "Probable Close Date": "2026-08-15",
        Probability: 50,
        Source: "Partner referral",
      },
    ],
  });

  expect(normalized.headers).toEqual([
    "contact_name",
    "country",
    "region",
    "product",
    "quantity",
    "amount",
    "currency_code",
    "stage",
    "possible_close_date",
    "probability",
    "source",
  ]);
  expect(normalized.rows).toEqual([
    {
      contact_name: "Repro Client",
      country: "India",
      region: "India West",
      product: "LIVEY WC350 QHD Webcam",
      quantity: 1,
      amount: "5000",
      currency_code: "INR",
      stage: "proposal",
      possible_close_date: "2026-08-15",
      probability: 50,
      source: "Partner referral",
    },
  ]);
});

test("buildDealImportLookupUpserts deduplicates values and scopes regions by country", () => {
  expect(
    buildDealImportLookupUpserts([
      {
        country: "India",
        region: "India West",
        product: "LIVEY WC350 QHD Webcam",
      },
      {
        country: "India",
        region: "India West",
        product: "LIVEY WC350 QHD Webcam",
      },
      {
        country: "UAE",
        region: "Dubai",
        product: "LIVEY Studio Bar",
      },
    ]),
  ).toEqual([
    { fieldName: "deals.country", value: "India" },
    { fieldName: "deals.region.india", value: "India West" },
    { fieldName: "deals.product", value: "LIVEY WC350 QHD Webcam" },
    { fieldName: "deals.country", value: "UAE" },
    { fieldName: "deals.region.uae", value: "Dubai" },
    { fieldName: "deals.product", value: "LIVEY Studio Bar" },
  ]);
});

test("getDealImportStatus keeps terminal stages and otherwise follows approval state", () => {
  expect(getDealImportStatus("won", false)).toBe("won");
  expect(getDealImportStatus("lost", true)).toBe("lost");
  expect(getDealImportStatus("proposal", true)).toBe("approved");
  expect(getDealImportStatus("proposal", false)).toBe("submitted");
});
