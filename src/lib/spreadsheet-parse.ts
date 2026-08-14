import { read, utils } from "xlsx";

import type { ParsedSpreadsheet } from "@/lib/spreadsheet-import";

/**
 * The only module in the app that touches `xlsx`, deliberately.
 *
 * xlsx is ~412KB minified. It used to sit at the top of spreadsheet-import.ts
 * alongside four pure helpers (template CSV download, validation, summary
 * strings) that don't need it — so every route importing any of those helpers
 * shipped the whole spreadsheet library. That was seven routes: Deals,
 * Customers, Analytics, Partner team, and three admin pages, none of which
 * need a spreadsheet parser until somebody actually picks a file.
 *
 * Splitting it makes the dependency structural rather than a rule each future
 * caller has to remember: importing the pure helpers can no longer drag xlsx
 * in, because they no longer live in the same module. Call sites reach this
 * file through `await import("@/lib/spreadsheet-parse")` inside the upload
 * handler, which is already async because it awaits `file.arrayBuffer()`.
 */

export function parseSpreadsheetRows(
  input: ArrayBufferLike,
  filename = "",
): Array<Record<string, unknown>> {
  return parseSpreadsheetFile(input, filename).rows;
}

export function parseSpreadsheetFile(input: ArrayBufferLike, filename = ""): ParsedSpreadsheet {
  const lowerName = filename.trim().toLowerCase();
  const workbook = lowerName.endsWith(".csv")
    ? read(new TextDecoder().decode(new Uint8Array(input)).replace(/^\uFEFF/, ""), {
        type: "string",
      })
    : read(input, { type: "array" });
  const [firstSheetName] = workbook.SheetNames;
  if (!firstSheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return { headers: [], rows: [] };

  const headerMatrix = utils.sheet_to_json<Array<unknown>>(sheet, {
    header: 1,
    defval: "",
  }) as Array<Array<unknown>>;
  const headers = (headerMatrix[0] ?? [])
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0);
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  return { headers, rows };
}
