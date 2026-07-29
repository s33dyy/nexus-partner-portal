import { expect, test } from "bun:test";

import {
  filterCatalogItemsByKind,
  getCatalogKindLabel,
  getCatalogKindPluralLabel,
  getCatalogImportTemplateColumns,
  buildCatalogCreateValues,
  normalizeCatalogKind,
  validateCatalogImportRows,
} from "@/lib/catalog";

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

test("catalog filtering splits products and combos cleanly", () => {
  const items: Array<{ id: string; catalog_kind?: string | null; product_name: string }> = [
    { id: "1", catalog_kind: "product", product_name: "Camera" },
    { id: "2", catalog_kind: "combo", product_name: "Camera + Mic Bundle" },
  ];

  expect(filterCatalogItemsByKind(items, "product").map((item) => item.id)).toEqual(["1"]);
  expect(filterCatalogItemsByKind(items, "combo").map((item) => item.id)).toEqual(["2"]);
});
