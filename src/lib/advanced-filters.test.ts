import { describe, expect, it } from "vitest";
import {
  countActiveFilters,
  matchesAdvancedFilters,
  matchesExactOption,
  normalizeFilterText,
} from "./advanced-filters";

describe("advanced filter primitives", () => {
  it("matches text without case or whitespace sensitivity", () => {
    expect(normalizeFilterText("  Partner Admin ")).toBe("partner admin");
    expect(matchesAdvancedFilters({ name: "North Star" }, { text: "star" }, ["name"])).toBe(true);
  });

  it("applies exact options and inclusive numeric ranges", () => {
    expect(matchesExactOption("Open", "open")).toBe(false);
    expect(
      matchesAdvancedFilters(
        { status: "open", amount: 100 },
        { status: "open", amountMin: 100, amountMax: 200 },
        ["status"],
      ),
    ).toBe(true);
    expect(
      matchesAdvancedFilters(
        { status: "closed", amount: 300 },
        { status: "open", amountMax: 200 },
        ["status"],
      ),
    ).toBe(false);
    expect(matchesAdvancedFilters({ amount: 100 }, { amountMin: "not-a-number" }, [])).toBe(false);
    expect(matchesAdvancedFilters({ amount: 100 }, { amountMin: true }, [])).toBe(false);
    expect(matchesAdvancedFilters({ amount: 100 }, { amountMin: [100] }, [])).toBe(false);
    expect(matchesAdvancedFilters({ amount: 0 }, { amountMin: 0, amountMax: 0 }, [])).toBe(true);
  });

  it("applies inclusive ISO-date ranges", () => {
    expect(
      matchesAdvancedFilters(
        { closeDate: "2026-10-15" },
        { dateFrom: "2026-10-15", dateTo: "2026-10-15" },
        ["closeDate"],
        { dateFields: ["closeDate"] },
      ),
    ).toBe(true);
    expect(
      matchesAdvancedFilters(
        { closeDate: "2026-10-14" },
        { dateFrom: "2026-10-15" },
        ["closeDate"],
        { dateFields: ["closeDate"] },
      ),
    ).toBe(false);
    expect(
      matchesAdvancedFilters(
        { closeDate: "2026-10-15T23:59:59.000Z" },
        { dateFrom: "2026-10-15", dateTo: "2026-10-15" },
        ["closeDate"],
        { dateFields: ["closeDate"] },
      ),
    ).toBe(true);
    expect(
      matchesAdvancedFilters(
        { createdDate: "2026-10-15" },
        { dateFrom: "2026-10-15", dateTo: "2026-10-15" },
        ["closeDate"],
        { dateFields: ["closeDate"] },
      ),
    ).toBe(false);
    expect(
      matchesAdvancedFilters(
        { date: "2026-10-15", closeDate: "2026-10-14" },
        { dateFrom: "2026-10-15" },
        ["date"],
        { dateFields: ["closeDate"] },
      ),
    ).toBe(false);
    expect(
      matchesAdvancedFilters(
        { closeDate: "2026-10-15" },
        { dateFrom: "2026-10-15", dateTo: "2026-10-15" },
        ["closeDate"],
      ),
    ).toBe(false);
  });

  it("ignores empty filter values and preserves zero as active", () => {
    expect(
      matchesAdvancedFilters(
        { name: "North Star", status: "open", amount: 0 },
        { text: "", status: "", amountMin: 0 },
        ["name"],
      ),
    ).toBe(true);
    expect(countActiveFilters({ query: "", status: "open", amountMin: undefined, amountMax: 100 })).toBe(2);
    expect(countActiveFilters({ amountMin: 0, amountMax: null, empty: "   " })).toBe(1);
    expect(matchesExactOption("open", ["", "open"])).toBe(true);
    expect(matchesExactOption("open", [""])).toBe(false);
    expect(matchesAdvancedFilters({ status: "open" }, { missing: "value" }, [])).toBe(false);
    expect(matchesAdvancedFilters({ amount: 100 }, { missingMin: 0 }, [])).toBe(false);
  });
});
