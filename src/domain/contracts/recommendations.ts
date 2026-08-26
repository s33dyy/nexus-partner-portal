/**
 * Product recommendations — product.md §25.
 *
 * Deterministic and explainable by construction. Every suggestion is the sum
 * of named reasons, each carrying the real numbers that produced it, and a
 * candidate with no reasons is rejected rather than shown: a recommendation
 * nobody can explain is indistinguishable from one that was invented, and
 * this codebase does not ship those.
 *
 * There is no model here, no learned weights, and no score the reader cannot
 * reconstruct from the sentence next to it. The weights below are a declared
 * editorial ordering — "you order these together" outranks "this category is
 * adjacent" — not a fitted parameter.
 *
 * Pure and dependency-free, so the ranking is testable without a database and
 * evaluable in the browser.
 */

export const RECOMMENDATION_REASON_CODES = [
  "ordered_together",
  "won_deal_attach",
  "frequently_reordered",
  "running_low",
  "category_peer",
] as const;

export type RecommendationReasonCode = (typeof RECOMMENDATION_REASON_CODES)[number];

/**
 * Weights are an ordering, not a probability.
 *
 * Direct evidence about THIS buyer's own behaviour ranks above aggregate
 * market-basket evidence, which ranks above "same category". They are round
 * numbers on purpose: a reader comparing two suggestions should be able to
 * see which reason did the work, and a weight of 37.4 would only imply a
 * precision nothing here has.
 */
export const RECOMMENDATION_REASON_WEIGHTS: Record<RecommendationReasonCode, number> = {
  ordered_together: 40,
  won_deal_attach: 35,
  frequently_reordered: 30,
  running_low: 25,
  category_peer: 10,
};

export const RECOMMENDATION_REASON_LABELS: Record<RecommendationReasonCode, string> = {
  ordered_together: "Ordered together",
  won_deal_attach: "Included in won deals",
  frequently_reordered: "You reorder this",
  running_low: "Running low",
  category_peer: "Same category",
};

/**
 * The minimum number of distinct sources an AGGREGATE signal must draw on
 * before it may be shown.
 *
 * Market-basket evidence is computed across requests and deals the viewer
 * cannot see, which is fine as a statistic and not fine as a disclosure: with
 * a cohort of one, "commonly ordered with X" tells you precisely what one
 * other Distributor or one other deal did. Three is the floor at which the
 * sentence stops being about anybody in particular.
 *
 * Signals derived from the viewer's OWN history need no floor — they are
 * already theirs.
 */
export const MIN_AGGREGATE_COHORT = 3;

export function isAggregateReason(code: RecommendationReasonCode): boolean {
  return code === "ordered_together" || code === "won_deal_attach" || code === "category_peer";
}

export type RecommendationReason = {
  code: RecommendationReasonCode;
  /** The sentence shown to the reader. Must contain the numbers behind it —
   * "in 4 of your last 6 requests", not "frequently". */
  detail: string;
  /** How many distinct requests, deals, or locations this reason counted.
   * Aggregate reasons below MIN_AGGREGATE_COHORT are dropped. */
  cohort: number;
};

export type ProductRecommendationCandidate = {
  /** Opaque id in whichever product vocabulary the surface uses — a
   * product_skus.id for stock requests, a portal_catalog_items.id for deals
   * and the catalogue. */
  itemId: string;
  itemCode: string;
  itemName: string;
  category: string | null;
  reasons: RecommendationReason[];
};

export type ProductRecommendation = ProductRecommendationCandidate & {
  score: number;
  /** The single strongest reason, for a one-line summary. */
  primaryReason: RecommendationReason;
};

export const DEFAULT_RECOMMENDATION_LIMIT = 4;

/** A candidate must clear at least one whole reason's weight, so a lone
 * "same category" never surfaces on its own — that is a fact about the
 * catalogue, not a recommendation. */
export const MIN_RECOMMENDATION_SCORE = RECOMMENDATION_REASON_WEIGHTS.running_low;

export function scoreOf(reasons: readonly RecommendationReason[]): number {
  return reasons.reduce(
    (total, reason) => total + (RECOMMENDATION_REASON_WEIGHTS[reason.code] ?? 0),
    0,
  );
}

/** Drops aggregate reasons that do not clear the k-anonymity floor, and any
 * reason whose code is not one we know. */
export function admissibleReasons(
  reasons: readonly RecommendationReason[],
): RecommendationReason[] {
  return reasons.filter((reason) => {
    if (!RECOMMENDATION_REASON_CODES.includes(reason.code)) return false;
    if (!reason.detail?.trim()) return false;
    if (isAggregateReason(reason.code) && reason.cohort < MIN_AGGREGATE_COHORT) return false;
    return true;
  });
}

function strongestReason(reasons: readonly RecommendationReason[]): RecommendationReason {
  return [...reasons].sort((left, right) => {
    const byWeight =
      RECOMMENDATION_REASON_WEIGHTS[right.code] - RECOMMENDATION_REASON_WEIGHTS[left.code];
    if (byWeight !== 0) return byWeight;
    return right.cohort - left.cohort;
  })[0]!;
}

/**
 * Turns candidates into a ranked, explainable list.
 *
 * A candidate with no admissible reason left is dropped, never shown with an
 * empty explanation. Ties break on cohort size and then item code, so the
 * same inputs always produce the same order — a list that reshuffles between
 * renders reads as noise.
 */
export function rankRecommendations(
  candidates: readonly ProductRecommendationCandidate[],
  options: { limit?: number; minScore?: number; exclude?: readonly string[] } = {},
): ProductRecommendation[] {
  const limit = options.limit ?? DEFAULT_RECOMMENDATION_LIMIT;
  const minScore = options.minScore ?? MIN_RECOMMENDATION_SCORE;
  const excluded = new Set(options.exclude ?? []);

  const ranked: ProductRecommendation[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate.itemId || excluded.has(candidate.itemId) || seen.has(candidate.itemId)) {
      continue;
    }
    const reasons = admissibleReasons(candidate.reasons);
    if (reasons.length === 0) continue;
    const score = scoreOf(reasons);
    if (score < minScore) continue;
    seen.add(candidate.itemId);
    ranked.push({ ...candidate, reasons, score, primaryReason: strongestReason(reasons) });
  }

  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.primaryReason.cohort !== left.primaryReason.cohort) {
      return right.primaryReason.cohort - left.primaryReason.cohort;
    }
    return left.itemCode.localeCompare(right.itemCode);
  });

  return ranked.slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------------------
// Reason phrasing
// ---------------------------------------------------------------------------

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * The sentences shown to the reader.
 *
 * Centralised so every surface says the same thing the same way, and so the
 * numbers are never dropped in favour of a vague adverb — "in 4 of your last
 * 6 requests" is checkable by the person reading it, "frequently" is not.
 */
export const recommendationReasonText = {
  orderedTogether(withItemName: string, cohort: number): string {
    return `Ordered alongside ${withItemName} on ${plural(cohort, "past request")}`;
  },
  wonDealAttach(cohort: number): string {
    return `Included in ${plural(cohort, "won deal")} with a similar shape`;
  },
  frequentlyReordered(times: number, outOf: number): string {
    return `On ${times} of your last ${outOf} requests`;
  },
  runningLow(available: number, typicalOrder: number): string {
    return available === 0
      ? "None available at this location"
      : `Only ${available} available, and you usually order ${typicalOrder}`;
  },
  categoryPeer(category: string, cohort: number): string {
    return `Also in ${category}, stocked by ${plural(cohort, "location")}`;
  },
} as const;

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export const RECOMMENDATION_SURFACES = ["stock_request", "deal", "catalogue"] as const;
export type RecommendationSurface = (typeof RECOMMENDATION_SURFACES)[number];

/** What an empty result means, per surface — said plainly rather than filled
 * with filler suggestions. */
export const RECOMMENDATION_EMPTY_COPY: Record<RecommendationSurface, string> = {
  stock_request:
    "No suggestions yet — these appear once you have a few past requests to learn from.",
  deal: "No suggestions yet — these appear once similar deals have closed with line items.",
  catalogue: "No related products yet — these appear once this SKU has appeared on enough deals.",
};

export type ProductRecommendationResult = {
  surface: RecommendationSurface;
  recommendations: ProductRecommendation[];
  /** True when the surface ran but the history was too thin to say anything.
   * Distinct from an error, and the UI must say so rather than render an
   * empty box. */
  insufficientHistory: boolean;
};
