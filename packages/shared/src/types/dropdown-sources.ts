export type LineItemCatalogOption = {
  id: string;
  label: string;
  sku: string | null;
  msrpUsd: number | null;
  ptpUsd: number | null;
  dtpUsd: number | null;
  source: "governed" | "catalog";
};
