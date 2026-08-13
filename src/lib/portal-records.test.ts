import { expect, test } from "bun:test";

import {
  getDealUsdAmount,
  getValidBackwardStages,
  isTerminalDealStage,
  nextDealStage,
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

test("normalizeDealCurrencyCode uppercases values and defaults blanks to USD", () => {
  expect(normalizeDealCurrencyCode(" usd ")).toBe("USD");
  expect(normalizeDealCurrencyCode("")).toBe("USD");
  expect(normalizeDealCurrencyCode(null)).toBe("USD");
});

test("getDealUsdAmount prefers stored USD equivalents and falls back to parsing the raw amount", () => {
  expect(getDealUsdAmount({ amount: "$10", amount_usd: 834.5 })).toBe(834.5);
  expect(getDealUsdAmount({ amount: "₹9,20,000", amount_usd: null })).toBe(920000);
});

test("9e: getValidBackwardStages returns every earlier non-terminal stage, mirroring moveDealStageBackward's own isBackwardMove check", () => {
  expect(getValidBackwardStages("sourced")).toEqual([]);
  expect(getValidBackwardStages("demo")).toEqual(["sourced"]);
  expect(getValidBackwardStages("negotiation")).toEqual([
    "sourced",
    "demo",
    "testing",
    "qualified",
    "proposal",
  ]);
  // Terminal stages have no valid backward target through this helper —
  // moveDealStageBackward itself also rejects moves into/out of won/lost.
  expect(getValidBackwardStages("won")).toEqual([]);
  expect(getValidBackwardStages("lost")).toEqual([]);
});

test("nextDealStage never advances out of a terminal stage", () => {
  expect(nextDealStage("sourced")).toBe("demo");
  expect(nextDealStage("proposal")).toBe("negotiation");
  // Negotiation still reports "won" — the pipeline branches on that to route
  // through markDealWon rather than an ordinary stage move.
  expect(nextDealStage("negotiation")).toBe("won");
  // The regression: "lost" follows "won" in DEAL_STAGE_ORDER, so a naive
  // index+1 turned "Move forward" on a won deal into "mark this lost".
  expect(nextDealStage("won")).toBe("won");
  expect(nextDealStage("lost")).toBe("lost");
});

test("isTerminalDealStage marks won and lost, and nothing else", () => {
  expect(isTerminalDealStage("won")).toBe(true);
  expect(isTerminalDealStage("lost")).toBe(true);
  expect(isTerminalDealStage("negotiation")).toBe(false);
  expect(isTerminalDealStage("sourced")).toBe(false);
});
