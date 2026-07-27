import { expect, test } from "bun:test";
import { utils, write } from "xlsx";

import {
  DEAL_IMPORT_TEMPLATE_COLUMNS,
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
      customer_budget: "",
      possible_close_date: "2026-08-15",
      probability: "50",
      source: " Partner referral ",
      notes: " Expansion deal ",
    },
  ]);

  expect(DEAL_IMPORT_TEMPLATE_COLUMNS).toEqual([
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
      customer_budget: "",
      possible_close_date: "2026-08-15",
      probability: 50,
      source: "Partner referral",
      notes: "Expansion deal",
    },
  ]);
});
