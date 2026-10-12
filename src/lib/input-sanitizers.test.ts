import { expect, test } from "bun:test";

import {
  sanitizeDecimal,
  sanitizeSignedWholeNumber,
  sanitizeWholeNumber,
} from "@/lib/input-sanitizers";

test("sanitizeWholeNumber keeps only ASCII digits", () => {
  expect(sanitizeWholeNumber("12e+3abc! 4")).toBe("1234");
});

test("sanitizeWholeNumber removes non-ASCII digits", () => {
  expect(sanitizeWholeNumber("१२3٤５")).toBe("3");
});

test("sanitizeDecimal keeps one decimal point and digits", () => {
  expect(sanitizeDecimal("1e+2.50.4abc")).toBe("12.504");
});

test("sanitizeDecimal rejects signs and other punctuation", () => {
  expect(sanitizeDecimal("-12,345..67%")).toBe("12345.67");
});

test("sanitizeSignedWholeNumber preserves one leading minus for signed deltas", () => {
  expect(sanitizeSignedWholeNumber("-12abc+3")).toBe("-123");
  expect(sanitizeSignedWholeNumber("-")).toBe("-");
});

test("empty numeric input stays empty", () => {
  expect(sanitizeWholeNumber("")).toBe("");
  expect(sanitizeDecimal("")).toBe("");
});
