import { expect, test } from "bun:test";

import {
  getDealInrAmount,
  normalizeDealCurrencyCode,
  parseDealAmount,
  requiresSuperAdminApproval,
} from "@/lib/portal-records";

test("parseDealAmount strips currency formatting before comparing thresholds", () => {
  expect(parseDealAmount("$5,000.01")).toBe(5000.01);
  expect(parseDealAmount("₹9,20,000")).toBe(920000);
});

test("requiresSuperAdminApproval only requires review for deals strictly above $5,000", () => {
  expect(requiresSuperAdminApproval(4999.99)).toBe(false);
  expect(requiresSuperAdminApproval(5000)).toBe(false);
  expect(requiresSuperAdminApproval("$5,000.01")).toBe(true);
});

test("normalizeDealCurrencyCode uppercases values and defaults blanks to INR", () => {
  expect(normalizeDealCurrencyCode(" usd ")).toBe("USD");
  expect(normalizeDealCurrencyCode("")).toBe("INR");
  expect(normalizeDealCurrencyCode(null)).toBe("INR");
});

test("getDealInrAmount prefers stored INR equivalents and falls back to parsing the raw amount", () => {
  expect(getDealInrAmount({ amount: "$10", amount_inr: 834.5 })).toBe(834.5);
  expect(getDealInrAmount({ amount: "₹9,20,000", amount_inr: null })).toBe(920000);
});
