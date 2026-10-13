import { expect, test } from "bun:test";

import { formatRegionalCurrency } from "@/lib/regional-display";

test("formats mapped INR, USD, GBP, and EUR using their requested symbols", () => {
  expect(formatRegionalCurrency(1234.5, "IN")).toBe("₹1,234.50");
  expect(formatRegionalCurrency(1234.5, "US")).toBe("$1,234.50");
  expect(formatRegionalCurrency(1234.5, "GB")).toBe("£1,234.50");
  expect(formatRegionalCurrency(1234.5, "DE")).toBe("€1,234.50");
});

test("formats other configured country currencies with Intl rather than a guessed region", () => {
  expect(formatRegionalCurrency(1234.5, "JP")).toContain("¥");
  expect(formatRegionalCurrency(1234.5, "CA")).toContain("CA$");
});
