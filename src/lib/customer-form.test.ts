import { describe, expect, test } from "bun:test";

import { normalizeOptionalEmployeeCount, normalizeOptionalRenewalType } from "@/lib/customer-form";

describe("customer create form", () => {
  test("allows Employee Count to be omitted", () => {
    expect(normalizeOptionalEmployeeCount("")).toBe("");
    expect(normalizeOptionalEmployeeCount("   ")).toBe("");
  });

  test("trims an entered Employee Count before saving", () => {
    expect(normalizeOptionalEmployeeCount("  11-25  ")).toBe("11-25");
  });

  test("allows Renewal Type to be omitted while preserving a selected type", () => {
    expect(normalizeOptionalRenewalType("")).toBe("");
    expect(normalizeOptionalRenewalType("  RC  ")).toBe("RC");
  });
});
