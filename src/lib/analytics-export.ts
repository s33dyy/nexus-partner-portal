import * as XLSX from "xlsx";

type AnalyticsWorkbookInput = {
  generatedAt: string;
  metrics: {
    pipelineValue: string;
    wonDeals: number;
    openDeals: number;
    avgHealth: string;
  };
  deals: Array<Record<string, unknown>>;
  customers: Array<Record<string, unknown>>;
  catalog: Array<Record<string, unknown>>;
};

function appendSheet(
  workbook: XLSX.WorkBook,
  name: string,
  rows: Array<Record<string, unknown>>,
) {
  const sheet =
    rows.length > 0 ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([["No data"]]);
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

export function buildAnalyticsWorkbook(input: AnalyticsWorkbookInput) {
  const workbook = XLSX.utils.book_new();

  appendSheet(workbook, "Summary", [
    {
      generated_at: input.generatedAt,
      pipeline_value: input.metrics.pipelineValue,
      won_deals: input.metrics.wonDeals,
      open_deals: input.metrics.openDeals,
      avg_health: input.metrics.avgHealth,
    },
  ]);
  appendSheet(workbook, "Deals", input.deals);
  appendSheet(workbook, "Customers", input.customers);
  appendSheet(workbook, "Catalog", input.catalog);

  return workbook;
}
