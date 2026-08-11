import { expect, test } from "bun:test";

import {
  buildCatalogInsertRow,
  filterCatalogItemsByKind,
  getCatalogKindLabel,
  getCatalogKindPluralLabel,
  getCatalogImportTemplateColumns,
  buildCatalogCreateValues,
  pickCatalogInsertColumns,
  normalizeCatalogKind,
  validateCatalogImportRows,
} from "./catalog";

test("normalizeCatalogKind defaults unknown values to product", () => {
  expect(normalizeCatalogKind("combo")).toBe("combo");
  expect(normalizeCatalogKind("weird")).toBe("product");
  expect(normalizeCatalogKind(null)).toBe("product");
});

test("catalog import rows inherit the current module kind and normalize values", () => {
  const result = validateCatalogImportRows(
    [
      {
        sku: "  BX-100 ",
        product_name: "  Bundle X ",
        category: "  Services ",
        partner_tier: " Gold ",
        list_price: " $1,200 ",
        margin: " 25% ",
        stock: "12",
        availability: " In stock ",
        benefits: "  Cross sell ",
        catalog_kind: "combo",
      },
    ],
    { kind: "combo" },
  );

  expect(getCatalogImportTemplateColumns({ kind: "product" }).map((column) => column.key)).toEqual([
    "sku",
    "product_name",
    "category",
    "partner_tier",
    "list_price",
    "margin",
    "stock",
    "availability",
    "benefits",
    "catalog_kind",
  ]);
  expect(result.errors).toEqual([]);
  expect(result.rows).toEqual([
    {
      sku: "BX-100",
      product_name: "Bundle X",
      category: "Services",
      partner_tier: "Gold",
      list_price: "$1,200",
      margin: "25%",
      stock: 12,
      availability: "In stock",
      benefits: "Cross sell",
      catalog_kind: "combo",
    },
  ]);
});

test("catalog import rows accept human-readable CSV headers from the template", () => {
  const result = validateCatalogImportRows(
    [
      {
        SKU: "LIVEY-STD-011",
        "Product Name": "LIVEY Collaboration Kit",
        Category: "Accessories",
        "Partner Tier": "Silver",
        "List Price": "$350",
        Margin: "20%",
        Stock: "14",
        Availability: "In stock",
        Benefits: "Meeting-ready accessory pack",
        "Catalog Kind": "combo",
      },
    ],
    { kind: "combo" },
  );

  expect(result.errors).toEqual([]);
  expect(result.rows).toEqual([
    {
      sku: "LIVEY-STD-011",
      product_name: "LIVEY Collaboration Kit",
      category: "Accessories",
      partner_tier: "Silver",
      list_price: "$350",
      margin: "20%",
      stock: 14,
      availability: "In stock",
      benefits: "Meeting-ready accessory pack",
      catalog_kind: "combo",
    },
  ]);
});

test("catalog kind labels stay singular and plural for the new module split", () => {
  expect(getCatalogKindLabel("product")).toBe("Product");
  expect(getCatalogKindLabel("combo")).toBe("Combo");
  expect(getCatalogKindPluralLabel("product")).toBe("Products");
  expect(getCatalogKindPluralLabel("combo")).toBe("Combos");
});

test("buildCatalogCreateValues turns dropdown creates into real catalog rows", () => {
  expect(
    buildCatalogCreateValues({
      product_name: "  LIVEY Studio Bar ",
      catalog_kind: "combo",
      category: "  Hardware ",
      partner_tier: " Gold ",
      list_price: " $2,400 ",
      margin: " 32% ",
      stock: 8,
      availability: " In stock ",
      benefits: "  Video and audio ",
    }),
  ).toEqual({
    sku: "LIVEY-STUDIO-BAR",
    product_name: "LIVEY Studio Bar",
    category: "Hardware",
    partner_tier: "Gold",
    list_price: "$2,400",
    margin: "32%",
    stock: 8,
    availability: "In stock",
    benefits: "Video and audio",
    catalog_kind: "combo",
  });
});

test("catalog insert helpers skip columns that are missing in older databases", () => {
  const row = buildCatalogInsertRow(
    buildCatalogCreateValues({
      product_name: "New Product 001",
      catalog_kind: "combo",
    }),
  );

  const insert = pickCatalogInsertColumns(row, [
    "id",
    "sku",
    "product_name",
    "category",
    "partner_tier",
    "list_price",
    "margin",
    "stock",
    "availability",
    "benefits",
    "is_seed",
    "created_at",
    "updated_at",
  ]);

  expect(insert.columns).not.toContain("catalog_kind");
  expect(insert.columns).toContain("product_name");
  expect(insert.values).toHaveLength(insert.columns.length);
});

test("catalog filtering splits products and combos cleanly", () => {
  const items: Array<{ id: string; catalog_kind?: string | null; product_name: string }> = [
    { id: "1", catalog_kind: "product", product_name: "Camera" },
    { id: "2", catalog_kind: "combo", product_name: "Camera + Mic Bundle" },
  ];

  expect(filterCatalogItemsByKind(items, "product").map((item) => item.id)).toEqual(["1"]);
  expect(filterCatalogItemsByKind(items, "combo").map((item) => item.id)).toEqual(["2"]);
});

test("legacy catalog imports keep the old export shape even when canonical pricing fields appear", () => {
  const result = validateCatalogImportRows(
    [
      {
        SKU: "LIVEY-LEGACY-001",
        "Product Name": "LIVEY Legacy Bundle",
        Category: "Hardware",
        "Partner Tier": "Gold",
        "List Price": "$350",
        Margin: "20%",
        Stock: "14",
        Availability: "In stock",
        Benefits: "Compatibility check",
        "Catalog Kind": "combo",
        price_book_code: "PB-LEGACY",
        additional_discount: "$15",
      },
    ],
    { kind: "combo" },
  );

  expect(result.errors).toEqual([]);
  expect(result.rows).toEqual([
    {
      sku: "LIVEY-LEGACY-001",
      product_name: "LIVEY Legacy Bundle",
      category: "Hardware",
      partner_tier: "Gold",
      list_price: "$350",
      margin: "20%",
      stock: 14,
      availability: "In stock",
      benefits: "Compatibility check",
      catalog_kind: "combo",
    },
  ]);
});
