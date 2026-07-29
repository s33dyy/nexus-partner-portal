import { randomUUID } from "node:crypto";

export const CATALOG_KINDS = ["product", "combo"] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

export type CatalogItemRecord = {
  id: string;
  sku: string;
  product_name: string;
  category: string;
  partner_tier: string;
  list_price: string;
  margin: string;
  stock: number;
  availability: string;
  benefits: string;
  catalog_kind?: string | null;
  is_seed?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type CatalogImportRow = {
  sku: string;
  product_name: string;
  category: string;
  partner_tier: string;
  list_price: string;
  margin: string;
  stock: number;
  availability: string;
  benefits: string;
  catalog_kind: CatalogKind;
};

export type CatalogImportOptions = {
  kind: CatalogKind;
};

export type CatalogCreateValues = {
  sku: string;
  product_name: string;
  category: string;
  partner_tier: string;
  list_price: string;
  margin: string;
  stock: number;
  availability: string;
  benefits: string;
  catalog_kind: CatalogKind;
};

export function normalizeCatalogKind(value: string | null | undefined): CatalogKind {
  const normalized = value?.trim().toLowerCase();
  return normalized === "combo" ? "combo" : "product";
}

export function getCatalogKindLabel(kind: CatalogKind) {
  return kind === "combo" ? "Combo" : "Product";
}

export function getCatalogKindPluralLabel(kind: CatalogKind) {
  return kind === "combo" ? "Combos" : "Products";
}

export function filterCatalogItemsByKind<T extends { catalog_kind?: string | null }>(
  items: T[],
  kind: CatalogKind,
) {
  return items.filter((item) => normalizeCatalogKind(item.catalog_kind) === kind);
}

export function getCatalogImportTemplateColumns(_options: CatalogImportOptions) {
  return [
    { key: "sku", header: "SKU" },
    { key: "product_name", header: "Product Name" },
    { key: "category", header: "Category" },
    { key: "partner_tier", header: "Partner Tier" },
    { key: "list_price", header: "List Price" },
    { key: "margin", header: "Margin" },
    { key: "stock", header: "Stock" },
    { key: "availability", header: "Availability" },
    { key: "benefits", header: "Benefits" },
    { key: "catalog_kind", header: "Catalog Kind" },
  ] as const;
}

export function getCatalogImportTemplateSample(options: CatalogImportOptions) {
  return [
    {
      sku: "LIVEY-STD-001",
      product_name: options.kind === "combo" ? "LIVEY Studio Bundle" : "LIVEY Smart Cam",
      category: "Hardware",
      partner_tier: "Registered",
      list_price: "$1,200",
      margin: "25%",
      stock: 10,
      availability: "In stock",
      benefits: "Ready-to-sell starter configuration",
      catalog_kind: options.kind,
    },
  ];
}

function normalizeString(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeInteger(value: unknown) {
  const numeric = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

export function validateCatalogImportRows(
  rows: Array<Record<string, unknown>>,
  options: CatalogImportOptions,
) {
  const normalizedRows: CatalogImportRow[] = [];
  const errors: Array<{ rowNumber: number; messages: string[] }> = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const sku = normalizeString(row.sku);
    const productName = normalizeString(row.product_name);
    const category = normalizeString(row.category) || "General";
    const partnerTier = normalizeString(row.partner_tier) || "Registered";
    const listPrice = normalizeString(row.list_price) || "$0";
    const margin = normalizeString(row.margin) || "0%";
    const stock = normalizeInteger(row.stock);
    const availability = normalizeString(row.availability) || "In stock";
    const benefits = normalizeString(row.benefits);
    const catalogKind = normalizeCatalogKind(normalizeString(row.catalog_kind) || options.kind);
    const rowErrors: string[] = [];

    if (!sku) rowErrors.push("sku is required");
    if (!productName) rowErrors.push("product_name is required");
    if (!Number.isFinite(stock) || stock < 0) rowErrors.push("stock must be 0 or higher");

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, messages: rowErrors });
      return;
    }

    normalizedRows.push({
      sku,
      product_name: productName,
      category,
      partner_tier: partnerTier,
      list_price: listPrice,
      margin,
      stock,
      availability,
      benefits,
      catalog_kind: catalogKind,
    });
  });

  return {
    successCount: errors.length > 0 ? 0 : normalizedRows.length,
    rows: errors.length > 0 ? [] : normalizedRows,
    errors,
  };
}

function normalizeSku(value: string) {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return normalized || `CAT-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export function buildCatalogCreateValues(input: {
  product_name: string;
  sku?: string;
  category?: string;
  partner_tier?: string;
  list_price?: string;
  margin?: string;
  stock?: number;
  availability?: string;
  benefits?: string;
  catalog_kind?: CatalogKind;
}): CatalogCreateValues {
  const productName = input.product_name.trim();
  return {
    sku: normalizeSku(input.sku ?? productName),
    product_name: productName,
    category: input.category?.trim() || "General",
    partner_tier: input.partner_tier?.trim() || "Registered",
    list_price: input.list_price?.trim() || "$0",
    margin: input.margin?.trim() || "0%",
    stock: Number.isFinite(Number(input.stock)) ? Number(input.stock) : 0,
    availability: input.availability?.trim() || "In stock",
    benefits: input.benefits?.trim() || "",
    catalog_kind: normalizeCatalogKind(input.catalog_kind),
  };
}
