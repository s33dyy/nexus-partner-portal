import type * as XLSX from "xlsx";

import { type CsvColumn } from "@/lib/csv-export";
import { sumRewardPoints, type RewardPointEventRecord } from "@/lib/rewards";

export const REWARD_CATALOG_IMPORT_TEMPLATE_COLUMNS: CsvColumn[] = [
  { key: "title", header: "Title" },
  { key: "description", header: "Description" },
  { key: "image_path", header: "Image Path" },
  { key: "category", header: "Category" },
  { key: "points_cost", header: "Points Cost" },
  { key: "stock", header: "Stock" },
  { key: "availability", header: "Availability" },
];

export const REWARD_CATALOG_IMPORT_TEMPLATE_SAMPLE = [
  {
    title: "LIVEY Hoodie",
    description: "Warm merch",
    image_path: "https://cdn.example.com/hoodie.png",
    category: "Merchandise",
    points_cost: 1200,
    stock: 5,
    availability: "available",
  },
];

export type RewardCatalogImportRow = {
  title: string;
  description: string;
  image_path: string | null;
  category: string;
  points_cost: number;
  stock: number;
  availability: string;
};

export type RewardCatalogImportError = {
  rowNumber: number;
  message: string;
};

export type RewardCatalogImportValidationResult =
  | {
      ok: true;
      rows: RewardCatalogImportRow[];
      errors: [];
    }
  | {
      ok: false;
      rows: [];
      errors: RewardCatalogImportError[];
    };

function normalizeString(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeInteger(value: unknown) {
  const numeric = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

function readRewardCatalogImportRowsFromWorkbook(
  workbook: XLSX.WorkBook,
  utils: typeof XLSX.utils,
) {
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) {
    throw new Error("The selected file does not contain a worksheet.");
  }

  const sheet = workbook.Sheets[firstSheet];
  if (!sheet) {
    throw new Error("The selected file could not be read.");
  }

  const rawRows =
    (utils.sheet_to_json(sheet, { defval: "" }) as Array<Record<string, unknown>>) ?? [];

  return rawRows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, ""),
        value,
      ]),
    ),
  );
}

/**
 * xlsx (~412KB) is loaded on demand rather than at module scope, so that
 * importing `calculateOutstandingRewardPoints` from this file — which the
 * Rewards page does on every visit — no longer ships a spreadsheet parser.
 * Already async, so the deferred import costs nothing at the call site.
 */
export async function readRewardCatalogImportRows(file: File) {
  const { read, utils } = await import("xlsx");
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv") {
    return readRewardCatalogImportRowsFromWorkbook(
      read(await file.text(), { type: "string" }),
      utils,
    );
  }

  return readRewardCatalogImportRowsFromWorkbook(
    read(await file.arrayBuffer(), { type: "array" }),
    utils,
  );
}

export function validateRewardCatalogImportRows(
  rawRows: Array<Record<string, unknown>>,
): RewardCatalogImportValidationResult {
  const normalizedRows: RewardCatalogImportRow[] = [];
  const errors: RewardCatalogImportError[] = [];

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const title = normalizeString(row.title);
    const description = normalizeString(row.description);
    const category = normalizeString(row.category);
    const availability = normalizeString(row.availability);
    const pointsCost = normalizeInteger(row.points_cost);
    const stock = normalizeInteger(row.stock);

    const rowErrors: string[] = [];
    if (!title) rowErrors.push("title is required");
    if (!description) rowErrors.push("description is required");
    if (!category) rowErrors.push("category is required");
    if (!availability) rowErrors.push("availability is required");
    if (!Number.isFinite(pointsCost) || pointsCost < 0)
      rowErrors.push("points_cost must be 0 or higher");
    if (!Number.isFinite(stock) || stock < 0) rowErrors.push("stock must be 0 or higher");

    if (rowErrors.length > 0) {
      errors.push({
        rowNumber,
        message: rowErrors.join(", "),
      });
      return;
    }

    normalizedRows.push({
      title,
      description,
      image_path: normalizeString(row.image_path) || null,
      category,
      points_cost: pointsCost,
      stock,
      availability,
    });
  });

  if (errors.length > 0) {
    return { ok: false, rows: [], errors };
  }

  return { ok: true, rows: normalizedRows, errors: [] };
}

export function calculateOutstandingRewardPoints(
  events: Array<Pick<RewardPointEventRecord, "points_delta">>,
) {
  return sumRewardPoints(events);
}
