export type CsvColumn = {
  key: string;
  header: string;
};

export function formatCsvDate(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

export function normalizeCsvValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map(normalizeCsvValue).filter(Boolean).join("; ");
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function escapeCsvCell(value: unknown) {
  return `"${normalizeCsvValue(value).replace(/"/g, '""')}"`;
}

export function buildCsv(columns: CsvColumn[], rows: Array<Record<string, unknown>>) {
  const headerRow = columns.map((column) => column.header);
  const bodyRows = rows.map((row) => columns.map((column) => row[column.key]));

  return [headerRow, ...bodyRows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
