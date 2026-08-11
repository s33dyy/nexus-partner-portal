import { expect, test } from "bun:test";

import {
  DEAL_PROBABILITY_OPTIONS,
  formatDealProbability,
  normalizeDealProbability,
} from "./deal-probability";

test("deal probability options expose the approved buckets and labels", () => {
  expect(DEAL_PROBABILITY_OPTIONS).toEqual([
    { value: 0, label: "0% - No chance" },
    { value: 25, label: "25% - Unlikely" },
    { value: 50, label: "50% - Likely" },
    { value: 100, label: "100% - Certain" },
  ]);
});

test("formatDealProbability uses the named label for approved bucket values", () => {
  expect(formatDealProbability(0)).toBe("0% - No chance");
  expect(formatDealProbability(25)).toBe("25% - Unlikely");
  expect(formatDealProbability(50)).toBe("50% - Likely");
  expect(formatDealProbability(100)).toBe("100% - Certain");
});

test("formatDealProbability falls back safely for legacy values", () => {
  expect(formatDealProbability(64)).toBe("64% probability");
});

test("normalizeDealProbability clamps and snaps to the nearest approved bucket", () => {
  expect(normalizeDealProbability(-10)).toBe(0);
  expect(normalizeDealProbability(13)).toBe(25);
  expect(normalizeDealProbability(64)).toBe(50);
  expect(normalizeDealProbability(101)).toBe(100);
});
