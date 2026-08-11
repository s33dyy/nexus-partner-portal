import { expect, test } from "bun:test";

import {
  addMoney,
  calculateDiscountedTransferPrice,
  calculateMsrpTotal,
  calculatePartnerTransferPrice,
  calculateRewardEligibleDtpTotal,
  calculateWeightedPipeline,
  divideMoney,
  formatMoney,
  meetsPartnerTierRequirement,
  multiplyMoney,
  parseMoney,
  quoteFxSnapshotAmount,
  roundMoney,
  subtractMoney,
} from "@/lib/money";

test("money helpers preserve fixed-point precision and display formatting", () => {
  const parsed = parseMoney("1234.567", "USD");

  expect(parsed).toEqual({
    amount: "1234.567",
    currencyCode: "USD",
    scale: 3,
  });
  expect(formatMoney(parsed)).toBe("USD 1,234.567");
  expect(() => parseMoney("1,234.567", "USD")).toThrow(
    "Money string must be a plain decimal without separators or symbols",
  );
  expect(addMoney(parseMoney("10.10", "USD"), parseMoney("0.20", "USD"))).toEqual({
    amount: "10.30",
    currencyCode: "USD",
    scale: 2,
  });
  expect(subtractMoney(parseMoney("10.10", "USD"), parseMoney("0.20", "USD"))).toEqual({
    amount: "9.90",
    currencyCode: "USD",
    scale: 2,
  });
  expect(multiplyMoney(parseMoney("10.10", "USD"), "1.25")).toEqual({
    amount: "12.63",
    currencyCode: "USD",
    scale: 2,
  });
  expect(divideMoney(parseMoney("10.00", "USD"), "3")).toEqual({
    amount: "3.33",
    currencyCode: "USD",
    scale: 2,
  });
  expect(roundMoney(parseMoney("1234.565", "USD"), 2)).toEqual({
    amount: "1234.57",
    currencyCode: "USD",
    scale: 2,
  });
});

test("pricing helpers derive totals from the governed money contract", () => {
  const msrpTotal = calculateMsrpTotal({
    unitMsrp: parseMoney("99.50", "USD"),
    quantity: 3,
  });

  expect(msrpTotal).toEqual({
    amount: "298.50",
    currencyCode: "USD",
    scale: 2,
  });

  const partnerTransferPrice = calculatePartnerTransferPrice({
    msrpTotal,
    partnerTier: "gold",
  });

  expect(partnerTransferPrice).toEqual({
    amount: "268.65",
    currencyCode: "USD",
    scale: 2,
  });

  const discountedTransferPrice = calculateDiscountedTransferPrice({
    partnerTransferPrice,
    additionalDiscount: parseMoney("18.65", "USD"),
  });

  expect(discountedTransferPrice).toEqual({
    amount: "250.00",
    currencyCode: "USD",
    scale: 2,
  });

  expect(
    calculateRewardEligibleDtpTotal([
      { discountedTransferPrice, approved: true },
      { discountedTransferPrice: parseMoney("10.00", "USD"), approved: false },
    ]),
  ).toEqual({
    amount: "250.00",
    currencyCode: "USD",
    scale: 2,
  });

  expect(
    calculateWeightedPipeline({
      amount: parseMoney("1000.00", "USD"),
      probability: "0.275",
    }),
  ).toEqual({
    amount: "275.00",
    currencyCode: "USD",
    scale: 2,
  });
});

test("FX snapshot quoting uses the stored snapshot and not a live rate", () => {
  const snapshot = {
    snapshotId: "fx-2026-07-30-001",
    sourceCurrencyCode: "USD",
    targetCurrencyCode: "INR",
    rate: "83.25",
    asOf: "2026-07-30T12:00:00Z",
  } as const;

  const quoted = quoteFxSnapshotAmount({
    sourceAmount: parseMoney("10.00", "USD"),
    snapshot,
  });

  expect(quoted).toEqual({
    amount: "832.50",
    currencyCode: "INR",
    scale: 2,
  });
});

test("meetsPartnerTierRequirement has no gate when no tier is required", () => {
  expect(meetsPartnerTierRequirement(null, null)).toBe(true);
  expect(meetsPartnerTierRequirement("registered", "")).toBe(true);
});

test("meetsPartnerTierRequirement compares actual vs required tier, case-insensitively", () => {
  expect(meetsPartnerTierRequirement("Gold", "Gold")).toBe(true);
  expect(meetsPartnerTierRequirement("platinum", "gold")).toBe(true);
  expect(meetsPartnerTierRequirement("silver", "Gold")).toBe(false);
  expect(meetsPartnerTierRequirement("registered", "Gold")).toBe(false);
});

test("meetsPartnerTierRequirement treats a missing partner tier as registered (the lowest tier)", () => {
  expect(meetsPartnerTierRequirement(null, "registered")).toBe(true);
  expect(meetsPartnerTierRequirement(null, "silver")).toBe(false);
});

test("meetsPartnerTierRequirement fails closed on an unrecognised required tier", () => {
  expect(meetsPartnerTierRequirement("platinum", "diamond")).toBe(false);
});
