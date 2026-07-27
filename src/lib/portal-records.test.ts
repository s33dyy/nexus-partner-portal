import { expect, test } from "bun:test";

import { parseDealAmount, requiresSuperAdminApproval } from "@/lib/portal-records";

test("parseDealAmount strips currency formatting before comparing thresholds", () => {
  expect(parseDealAmount("$5,000.01")).toBe(5000.01);
  expect(parseDealAmount("₹9,20,000")).toBe(920000);
});

test("requiresSuperAdminApproval only requires review for deals strictly above $5,000", () => {
  expect(requiresSuperAdminApproval(4999.99)).toBe(false);
  expect(requiresSuperAdminApproval(5000)).toBe(false);
  expect(requiresSuperAdminApproval("$5,000.01")).toBe(true);
});
