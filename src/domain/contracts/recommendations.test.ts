import { expect, test } from "bun:test";

import {
  MIN_AGGREGATE_COHORT,
  MIN_RECOMMENDATION_SCORE,
  RECOMMENDATION_REASON_CODES,
  RECOMMENDATION_REASON_LABELS,
  RECOMMENDATION_REASON_WEIGHTS,
  RECOMMENDATION_SURFACES,
  RECOMMENDATION_EMPTY_COPY,
  admissibleReasons,
  isAggregateReason,
  rankRecommendations,
  recommendationReasonText,
  scoreOf,
  type ProductRecommendationCandidate,
  type RecommendationReason,
  type RecommendationReasonCode,
} from "@/domain/contracts/recommendations";

function reason(
  code: RecommendationReasonCode,
  cohort = MIN_AGGREGATE_COHORT,
  detail = "because of a real number",
): RecommendationReason {
  return { code, cohort, detail };
}

function candidate(
  overrides: Partial<ProductRecommendationCandidate> = {},
): ProductRecommendationCandidate {
  return {
    itemId: "item-1",
    itemCode: "LIV-AAA-100",
    itemName: "Thing One",
    category: "Software",
    reasons: [reason("frequently_reordered", 4, "On 4 of your last 6 requests")],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test("every reason code has a weight, a label, and an aggregate classification", () => {
  for (const code of RECOMMENDATION_REASON_CODES) {
    expect(RECOMMENDATION_REASON_WEIGHTS[code]).toBeGreaterThan(0);
    expect(RECOMMENDATION_REASON_LABELS[code]).toBeTruthy();
    expect(typeof isAggregateReason(code)).toBe("boolean");
  }
});

test("every surface has empty copy that explains the absence", () => {
  for (const surface of RECOMMENDATION_SURFACES) {
    expect(RECOMMENDATION_EMPTY_COPY[surface]).toContain("No");
    expect(RECOMMENDATION_EMPTY_COPY[surface].length).toBeGreaterThan(30);
  }
});

test("a buyer's own behaviour outranks aggregate evidence, which outranks category", () => {
  expect(RECOMMENDATION_REASON_WEIGHTS.ordered_together).toBeGreaterThan(
    RECOMMENDATION_REASON_WEIGHTS.category_peer,
  );
  expect(RECOMMENDATION_REASON_WEIGHTS.frequently_reordered).toBeGreaterThan(
    RECOMMENDATION_REASON_WEIGHTS.category_peer,
  );
  // A lone category match cannot clear the floor on its own — that is a fact
  // about the catalogue, not a recommendation.
  expect(RECOMMENDATION_REASON_WEIGHTS.category_peer).toBeLessThan(MIN_RECOMMENDATION_SCORE);
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

test("a score is the sum of its reasons and nothing else", () => {
  expect(scoreOf([reason("ordered_together"), reason("running_low")])).toBe(
    RECOMMENDATION_REASON_WEIGHTS.ordered_together + RECOMMENDATION_REASON_WEIGHTS.running_low,
  );
  expect(scoreOf([])).toBe(0);
});

test("an unknown reason code contributes nothing rather than NaN", () => {
  expect(
    scoreOf([{ code: "vibes" as RecommendationReasonCode, cohort: 9, detail: "trust me" }]),
  ).toBe(0);
});

// ---------------------------------------------------------------------------
// The k-anonymity floor
// ---------------------------------------------------------------------------

test("an aggregate reason below the cohort floor is dropped", () => {
  // "Ordered alongside X on 1 past request" tells you exactly what one other
  // Distributor did. Three is the floor at which the sentence stops being
  // about anybody in particular.
  const belowFloor = admissibleReasons([reason("ordered_together", MIN_AGGREGATE_COHORT - 1)]);
  expect(belowFloor).toHaveLength(0);

  const atFloor = admissibleReasons([reason("ordered_together", MIN_AGGREGATE_COHORT)]);
  expect(atFloor).toHaveLength(1);
});

test("the viewer's own history needs no cohort floor", () => {
  // A signal derived from their own requests is already theirs; suppressing
  // it below three would hide their own behaviour from them.
  expect(admissibleReasons([reason("frequently_reordered", 1)])).toHaveLength(1);
  expect(admissibleReasons([reason("running_low", 1)])).toHaveLength(1);
});

test("a reason with no stated detail is inadmissible", () => {
  expect(admissibleReasons([reason("running_low", 1, "   ")])).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

test("a candidate with no admissible reason is dropped, never shown blank", () => {
  const ranked = rankRecommendations([
    candidate({ itemId: "a", reasons: [] }),
    // Only an under-floor aggregate reason: nothing left once it is dropped.
    candidate({ itemId: "b", reasons: [reason("ordered_together", 1)] }),
  ]);
  expect(ranked).toEqual([]);
});

test("a candidate below the score floor is dropped", () => {
  const ranked = rankRecommendations([
    candidate({ itemId: "a", reasons: [reason("category_peer", 5, "Also in Software")] }),
  ]);
  expect(ranked).toEqual([]);
});

test("category alone is not enough, but category plus a real signal is", () => {
  const ranked = rankRecommendations([
    candidate({
      itemId: "a",
      reasons: [
        reason("category_peer", 5, "Also in Software"),
        reason("running_low", 1, "None available"),
      ],
    }),
  ]);
  expect(ranked).toHaveLength(1);
  // The stronger reason leads the explanation.
  expect(ranked[0]?.primaryReason.code).toBe("running_low");
});

test("higher scores rank first, and every result carries its reasons", () => {
  const ranked = rankRecommendations([
    candidate({
      itemId: "weak",
      itemCode: "B",
      reasons: [reason("running_low", 1, "None available")],
    }),
    candidate({
      itemId: "strong",
      itemCode: "A",
      reasons: [
        reason("ordered_together", 5, "with X on 5 requests"),
        reason("running_low", 1, "None available"),
      ],
    }),
  ]);
  expect(ranked.map((entry) => entry.itemId)).toEqual(["strong", "weak"]);
  expect(ranked[0]?.score).toBeGreaterThan(ranked[1]!.score);
  for (const entry of ranked) {
    expect(entry.reasons.length).toBeGreaterThan(0);
    expect(entry.primaryReason.detail).toBeTruthy();
  }
});

test("ties break deterministically on cohort then item code", () => {
  const first = rankRecommendations([
    candidate({ itemId: "b", itemCode: "LIV-BBB", reasons: [reason("running_low", 1, "d")] }),
    candidate({ itemId: "a", itemCode: "LIV-AAA", reasons: [reason("running_low", 1, "d")] }),
  ]);
  const second = rankRecommendations([
    candidate({ itemId: "a", itemCode: "LIV-AAA", reasons: [reason("running_low", 1, "d")] }),
    candidate({ itemId: "b", itemCode: "LIV-BBB", reasons: [reason("running_low", 1, "d")] }),
  ]);
  // Same inputs, same order regardless of arrival sequence: a list that
  // reshuffles between renders reads as noise.
  expect(first.map((entry) => entry.itemId)).toEqual(["a", "b"]);
  expect(second.map((entry) => entry.itemId)).toEqual(["a", "b"]);

  const byCohort = rankRecommendations([
    candidate({
      itemId: "thin",
      itemCode: "LIV-AAA",
      reasons: [reason("ordered_together", 3, "d")],
    }),
    candidate({
      itemId: "thick",
      itemCode: "LIV-ZZZ",
      reasons: [reason("ordered_together", 9, "d")],
    }),
  ]);
  expect(byCohort.map((entry) => entry.itemId)).toEqual(["thick", "thin"]);
});

test("already-chosen items are excluded", () => {
  const ranked = rankRecommendations(
    [
      candidate({ itemId: "chosen", reasons: [reason("running_low", 1, "d")] }),
      candidate({ itemId: "other", itemCode: "LIV-ZZZ", reasons: [reason("running_low", 1, "d")] }),
    ],
    { exclude: ["chosen"] },
  );
  expect(ranked.map((entry) => entry.itemId)).toEqual(["other"]);
});

test("duplicates collapse to the first occurrence", () => {
  const ranked = rankRecommendations([
    candidate({ itemId: "dup", reasons: [reason("ordered_together", 5, "d")] }),
    candidate({ itemId: "dup", reasons: [reason("running_low", 1, "d")] }),
  ]);
  expect(ranked).toHaveLength(1);
  expect(ranked[0]?.primaryReason.code).toBe("ordered_together");
});

test("the limit is respected and a zero limit yields nothing", () => {
  const many = Array.from({ length: 10 }, (_, index) =>
    candidate({
      itemId: `item-${index}`,
      itemCode: `LIV-${index}`,
      reasons: [reason("ordered_together", 10 - index, "d")],
    }),
  );
  expect(rankRecommendations(many, { limit: 3 })).toHaveLength(3);
  expect(rankRecommendations(many, { limit: 0 })).toHaveLength(0);
  expect(rankRecommendations(many, { limit: -5 })).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Phrasing
// ---------------------------------------------------------------------------

test("every reason sentence carries the numbers behind it", () => {
  expect(recommendationReasonText.orderedTogether("Cloud Suite", 4)).toBe(
    "Ordered alongside Cloud Suite on 4 past requests",
  );
  // Singular reads correctly too — "1 past requests" is the tell of a
  // template nobody checked.
  expect(recommendationReasonText.orderedTogether("Cloud Suite", 1)).toContain("1 past request");
  expect(recommendationReasonText.orderedTogether("Cloud Suite", 1)).not.toContain("requests");

  expect(recommendationReasonText.frequentlyReordered(4, 6)).toBe("On 4 of your last 6 requests");
  expect(recommendationReasonText.wonDealAttach(3)).toContain("3 won deals");
  expect(recommendationReasonText.categoryPeer("Software", 5)).toContain("5 locations");
});

test("running low reads differently at zero, because zero is a different problem", () => {
  expect(recommendationReasonText.runningLow(0, 6)).toBe("None available at this location");
  expect(recommendationReasonText.runningLow(2, 6)).toBe(
    "Only 2 available, and you usually order 6",
  );
});
