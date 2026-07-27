import { read, utils } from "xlsx";

import { buildCsv, downloadCsv } from "@/lib/csv-export";
import { buildExportFilename } from "@/lib/export-files";

export type SpreadsheetRow = Record<string, unknown>;

export type ParsedSpreadsheet = {
  headers: string[];
  rows: SpreadsheetRow[];
};

export type TemplateColumnDefinition = {
  key: string;
  header: string;
};

export type ImportValidationError = {
  rowNumber: number;
  messages: string[];
};

export type ImportValidationResult<TRow> = {
  successCount: number;
  rows: TRow[];
  errors: ImportValidationError[];
};

export function parseSpreadsheetRows(
  input: ArrayBufferLike,
  filename = "",
): Array<Record<string, unknown>> {
  return parseSpreadsheetFile(input, filename).rows;
}

export function parseSpreadsheetFile(
  input: ArrayBufferLike,
  filename = "",
): ParsedSpreadsheet {
  const lowerName = filename.trim().toLowerCase();
  const workbook = lowerName.endsWith(".csv")
    ? read(new TextDecoder().decode(new Uint8Array(input)), { type: "string" })
    : read(input, { type: "array" });
  const [firstSheetName] = workbook.SheetNames;
  if (!firstSheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return { headers: [], rows: [] };

  const headerMatrix = utils.sheet_to_json<Array<unknown>>(sheet, { header: 1, defval: "" }) as Array<
    Array<unknown>
  >;
  const headers = (headerMatrix[0] ?? [])
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0);
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  return { headers, rows };
}

export function downloadTemplateCsv(input: {
  filenameStem: string;
  columns: readonly TemplateColumnDefinition[];
  sampleRows: Array<Record<string, unknown>>;
}) {
  const csv = buildCsv(
    input.columns.map((column) => ({ key: column.key, header: column.header })),
    input.sampleRows,
  );
  downloadCsv(buildExportFilename(`${input.filenameStem}-template`, "csv"), csv);
}

export function buildImportValidationResult<TRow>(input: {
  rows: TRow[];
  errors: ImportValidationError[];
}): ImportValidationResult<TRow> {
  const rows = input.errors.length > 0 ? [] : input.rows;
  return {
    successCount: input.errors.length > 0 ? 0 : rows.length,
    rows,
    errors: input.errors,
  };
}

export function validateImportTemplate(
  parsed: ParsedSpreadsheet,
  columns: readonly TemplateColumnDefinition[],
): ImportValidationError[] {
  const normalizedHeaders = new Set(parsed.headers.map((header) => header.trim().toLowerCase()));
  const missingColumns = columns
    .map((column) => column.header.trim())
    .filter((header) => !normalizedHeaders.has(header.toLowerCase()));

  if (missingColumns.length > 0) {
    return [
      {
        rowNumber: 1,
        messages: [`Missing required columns: ${missingColumns.join(", ")}`],
      },
    ];
  }

  if (parsed.rows.length === 0) {
    return [
      {
        rowNumber: 2,
        messages: ["Add at least one data row before importing this file."],
      },
    ];
  }

  return [];
}

export function buildImportSummaryMessage(count: number, singularLabel: string, filename: string) {
  return `${count} ${count === 1 ? singularLabel : `${singularLabel}s`} imported from ${filename}.`;
}
