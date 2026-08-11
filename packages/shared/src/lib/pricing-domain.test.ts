import { expect, test } from "bun:test";

import {
  archivePricingRecord,
  buildComboComponentRecord,
  buildComboRecord,
  buildFxSnapshotRecord,
  buildPriceBookRecord,
  buildPriceRowRecord,
  buildProductRecord,
  buildProductSkuRecord,
  buildProductVariantRecord,
  calculateAdditionalDiscount,
  assertPricingRecordDeletionAllowed,
  validatePricingImportRows,
} from "./pricing-domain";

test("canonical builders create governed product, combo, and price-book records", () => {
  const product = buildProductRecord({
    product_code: "P-100",
    product_name: "Livey Camera",
    category: "Hardware",
  });
  const variant = buildProductVariantRecord({
    product_code: product.product_code,
    variant_code: "P-100-STD",
    variant_name: "Standard",
  });
  const sku = buildProductSkuRecord({
    product_code: product.product_code,
    variant_code: variant.variant_code,
    sku_code: "LIVEY-CAM-001",
    sku_name: "Livey Camera",
    is_primary: true,
  });
  const combo = buildComboRecord({
    combo_code: "B-100",
    combo_name: "Starter Bundle",
  });
  const component = buildComboComponentRecord({
    combo_code: combo.combo_code,
    component_sku_code: sku.sku_code,
    quantity: 2,
    sort_order: 1,
  });
  const priceBook = buildPriceBookRecord({
    price_book_code: "PB-2026-Q3",
    price_book_name: "Q3 Pricing",
    currency_code: "USD",
    effective_from: "2026-07-30",
  });
  const priceRow = buildPriceRowRecord({
    price_book_code: priceBook.price_book_code,
    price_row_code: "PB-2026-Q3-LIVEY-CAM-001",
    target_kind: "sku",
    target_code: sku.sku_code,
    currency_code: "USD",
    quantity: 1,
    legacy_price_count: 2,
    msrp: "199.99",
    partner_discount_percent: 25,
    partner_transfer_price: "149.99",
    additional_discount: "10.00",
    discounted_transfer_price: "139.99",
    reward_eligible_dtp: "129.99",
    weighted_probability: 0.25,
  });
  const fxSnapshot = buildFxSnapshotRecord({
    source_currency_code: "USD",
    target_currency_code: "INR",
    rate: "82.25",
    snapshot_at: "2026-07-30T00:00:00.000Z",
  });

  expect(product.record_type).toBe("product");
  expect(product.version).toBe(1);
  expect(variant.variant_code).toBe("P-100-STD");
  expect(sku.sku_code).toBe("LIVEY-CAM-001");
  expect(combo.combo_name).toBe("Starter Bundle");
  expect(component.quantity).toBe(2);
  expect(priceBook.version).toBe(1);
  expect(priceRow.discounted_transfer_price.amount).toBe("139.99");
  expect(fxSnapshot.rate).toBe("82.25");
});

test("archive guards prevent destructive deletion of referenced rows", () => {
  expect(() =>
    assertPricingRecordDeletionAllowed({
      recordLabel: "price book",
      referencedByCount: 1,
      referenceLabel: "price row",
    }),
  ).toThrow("cannot be deleted");

  const archived = archivePricingRecord(buildPriceBookRecord({
    price_book_code: "PB-2026-Q3",
    price_book_name: "Q3 Pricing",
    currency_code: "USD",
    effective_from: "2026-07-30",
  }));
  expect(archived.status).toBe("archived");
  expect(archived.archived_at).not.toBeNull();
});

test("pricing import validation performs row-level dry-run checks", () => {
  const result = validatePricingImportRows(
    [
      {
        product_code: "",
        product_name: "",
        variant_code: "VAR-1",
      },
    ],
    { kind: "product" },
  );

  expect(result.successCount).toBe(0);
  expect(result.errors[0]?.messages).toContain("product_code is required");
  expect(result.errors[0]?.messages).toContain("product_name is required");
});

test("pricing import validation supports price book rows and discount invariants", () => {
  const priceBookRows = validatePricingImportRows(
    [
      {
        price_book_code: "PB-2026-Q3",
        price_book_name: "Q3 Pricing",
        currency_code: "USD",
        effective_from: "2026-07-30",
      },
    ],
    { kind: "price_book" },
  );

  const priceRow = validatePricingImportRows(
    [
      {
        price_book_code: "PB-2026-Q3",
        price_row_code: "PB-2026-Q3-LIVEY-CAM-001",
        target_kind: "sku",
        target_code: "LIVEY-CAM-001",
        currency_code: "USD",
        msrp: "199.99",
        legacy_price_count: "1",
        partner_transfer_price: "149.99",
        additional_discount: "10.00",
      },
    ],
    { kind: "price_row" },
  );

  expect(priceBookRows.rows).toHaveLength(1);
  expect(priceRow.rows).toHaveLength(1);
  expect(
    calculateAdditionalDiscount({
      listPrice: "100.00",
      partnerTransferPrice: "80.00",
      legacyPriceCount: 1,
    }).amount,
  ).toBe("0.00");
  expect(
    calculateAdditionalDiscount({
      listPrice: "100.00",
      partnerTransferPrice: "80.00",
      legacyPriceCount: 2,
    }).amount,
  ).toBe("20.00");
});
