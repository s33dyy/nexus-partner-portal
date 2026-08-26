import type { PolicyDenialErrorContract } from "@/domain/contracts/commands";
import {
  MIN_AGGREGATE_COHORT,
  rankRecommendations,
  recommendationReasonText,
  type ProductRecommendationCandidate,
  type ProductRecommendationResult,
  type RecommendationReason,
} from "@/domain/contracts/recommendations";
import type { QueryRunner } from "@/server/command-runtime.server";
import {
  authorizeDistribution,
  type AuthorizeDistributionDeps,
  type DistributionActor,
} from "@/server/distribution-policy.server";
import { resolveProductSurface } from "@/server/feature-gates.server";
import { pool } from "@/server/postgres.server";

/**
 * Product recommendation read models — product.md §25.
 *
 * Three surfaces, one contract. Each query gathers evidence and hands raw
 * candidates to rankRecommendations(), which does the scoring, the
 * k-anonymity floor, and the ordering. Nothing here decides relevance by
 * itself, and nothing here writes.
 *
 * Two vocabularies, because this product has two: stock requests speak in
 * product_skus (the governed pricing catalogue the DMS moves), while deals and
 * the catalogue speak in portal_catalog_items.sku (the commercial catalogue
 * deal line items reference). They are not merged here — pretending one id
 * space existed would silently mis-attribute every signal.
 *
 * The aggregate signals deliberately span requests and deals the viewer
 * cannot see. That is sound as a statistic and unsound as a disclosure, so
 * every aggregate reason carries its cohort size and the contract drops any
 * that falls below MIN_AGGREGATE_COHORT before it can be rendered.
 */

export type RecommendationDeps = AuthorizeDistributionDeps & {
  query?: QueryRunner["query"];
  resolveRecommendationSurface?: (key: "product-recommendations") => Promise<boolean>;
};

export type RecommendationReadResult =
  | ({ ok: true } & ProductRecommendationResult)
  | { ok: false; failure: PolicyDenialErrorContract };

function runner(deps: RecommendationDeps): QueryRunner["query"] {
  return deps.query ?? ((sql, params) => pool.query(sql, params as unknown[]));
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function surfaceEnabled(deps: RecommendationDeps): Promise<boolean> {
  const resolve = deps.resolveRecommendationSurface ?? resolveProductSurface;
  return resolve("product-recommendations");
}

async function denial(reason: string): Promise<{ ok: false; failure: PolicyDenialErrorContract }> {
  const { makePolicyDenial } = await import("@/domain/contracts/commands");
  return { ok: false, failure: makePolicyDenial(null, reason) };
}

/** How many recent requests the "you reorder this" window looks back over.
 * Short enough that a Distributor's current pattern dominates, long enough
 * that a quarterly reorder still registers. */
const REORDER_WINDOW = 6;

// ---------------------------------------------------------------------------
// Surface 1: stock request reorder suggestions
// ---------------------------------------------------------------------------

export type StockRequestRecommendationInput = {
  destinationLocationId: string;
  /** SKUs already on the draft, so the panel never suggests what is in front
   * of the reader. */
  chosenProductSkuIds?: readonly string[];
  limit?: number;
};

/**
 * What this Distributor should probably add to the request they are drafting.
 *
 * Three kinds of evidence, in the order the weights rank them:
 *   - co-occurrence with what is already on the draft, across all requests
 *     (aggregate, k-floored);
 *   - the SKUs they themselves reorder most across their last few requests
 *     (their own history, no floor);
 *   - what is low or absent at the destination relative to how much they
 *     usually order (their own stock, no floor).
 */
export async function recommendStockRequestItems(
  actor: DistributionActor,
  input: StockRequestRecommendationInput,
  deps: RecommendationDeps = {},
): Promise<RecommendationReadResult> {
  if (!(await surfaceEnabled(deps))) {
    return denial("Product recommendations are not enabled in this workspace");
  }
  // Recommendations are a view of stock data, so they inherit the stock
  // domain's gate rather than inventing a second one.
  const authorized = await authorizeDistribution(actor, "read", deps);
  if (!authorized.ok) return authorized;

  const query = runner(deps);
  const chosen = [...new Set((input.chosenProductSkuIds ?? []).filter(Boolean))];
  const assignmentId = actor.assignment.assignmentId;

  const [ownHistory, coOccurrence, lowStock] = await Promise.all([
    // --- their own reorder cadence -------------------------------------
    query(
      `WITH recent AS (
         SELECT r.id
         FROM stock_requests r
         WHERE r.distributor_assignment_id = $1
         ORDER BY r.created_at DESC
         LIMIT $2
       )
       SELECT l.product_sku_id,
              sku.sku_code,
              product.product_name,
              COUNT(DISTINCT l.request_id)::int AS times,
              (SELECT COUNT(*)::int FROM recent) AS window_size,
              ROUND(AVG(l.requested_quantity))::int AS typical_quantity
       FROM stock_request_lines l
       JOIN recent ON recent.id = l.request_id
       JOIN product_skus sku ON sku.id = l.product_sku_id
       JOIN product_variants variant ON variant.id = sku.product_variant_id
       JOIN products product ON product.id = variant.product_id
       WHERE sku.status = 'active' AND sku.archived_at IS NULL
       GROUP BY l.product_sku_id, sku.sku_code, product.product_name
       ORDER BY times DESC
       LIMIT 20`,
      [assignmentId, REORDER_WINDOW],
    ),

    // --- market basket, across everyone, k-floored ---------------------
    chosen.length === 0
      ? Promise.resolve({ rows: [] })
      : query(
          `SELECT other.product_sku_id,
                  sku.sku_code,
                  product.product_name,
                  anchor_sku.sku_code AS anchor_code,
                  anchor_product.product_name AS anchor_name,
                  COUNT(DISTINCT other.request_id)::int AS cohort
           FROM stock_request_lines anchor
           JOIN stock_request_lines other
             ON other.request_id = anchor.request_id
            AND other.product_sku_id <> anchor.product_sku_id
           JOIN product_skus sku ON sku.id = other.product_sku_id
           JOIN product_variants variant ON variant.id = sku.product_variant_id
           JOIN products product ON product.id = variant.product_id
           JOIN product_skus anchor_sku ON anchor_sku.id = anchor.product_sku_id
           JOIN product_variants anchor_variant ON anchor_variant.id = anchor_sku.product_variant_id
           JOIN products anchor_product ON anchor_product.id = anchor_variant.product_id
           WHERE anchor.product_sku_id = ANY($1)
             AND NOT (other.product_sku_id = ANY($1))
             AND sku.status = 'active' AND sku.archived_at IS NULL
           GROUP BY other.product_sku_id, sku.sku_code, product.product_name,
                    anchor_sku.sku_code, anchor_product.product_name
           HAVING COUNT(DISTINCT other.request_id) >= $2
           ORDER BY cohort DESC
           LIMIT 20`,
          [chosen, MIN_AGGREGATE_COHORT],
        ),

    // --- what is low at this destination ------------------------------
    query(
      `SELECT b.product_sku_id,
              sku.sku_code,
              product.product_name,
              (b.on_hand_quantity - b.reserved_quantity - b.damaged_quantity) AS available
       FROM inventory_balances b
       JOIN stock_locations loc ON loc.id = b.location_id
       JOIN product_skus sku ON sku.id = b.product_sku_id
       JOIN product_variants variant ON variant.id = sku.product_variant_id
       JOIN products product ON product.id = variant.product_id
       WHERE b.location_id = $1
         AND loc.distributor_assignment_id = $2
         AND sku.status = 'active' AND sku.archived_at IS NULL
       ORDER BY available ASC
       LIMIT 20`,
      [input.destinationLocationId, assignmentId],
    ),
  ]);

  const byItem = new Map<string, ProductRecommendationCandidate>();
  const typicalQuantity = new Map<string, number>();

  const upsert = (
    row: Record<string, unknown>,
    reason: RecommendationReason,
    idKey = "product_sku_id",
  ) => {
    const itemId = String(row[idKey]);
    const existing = byItem.get(itemId);
    if (existing) {
      existing.reasons.push(reason);
      return;
    }
    byItem.set(itemId, {
      itemId,
      itemCode: String(row.sku_code ?? ""),
      itemName: String(row.product_name ?? ""),
      category: null,
      reasons: [reason],
    });
  };

  for (const row of ownHistory.rows as Array<Record<string, unknown>>) {
    typicalQuantity.set(String(row.product_sku_id), Math.max(1, num(row.typical_quantity)));
    const times = num(row.times);
    const windowSize = Math.max(times, num(row.window_size));
    upsert(row, {
      code: "frequently_reordered",
      cohort: times,
      detail: recommendationReasonText.frequentlyReordered(times, windowSize),
    });
  }

  for (const row of coOccurrence.rows as Array<Record<string, unknown>>) {
    upsert(row, {
      code: "ordered_together",
      cohort: num(row.cohort),
      detail: recommendationReasonText.orderedTogether(
        String(row.anchor_name ?? row.anchor_code ?? "this order"),
        num(row.cohort),
      ),
    });
  }

  for (const row of lowStock.rows as Array<Record<string, unknown>>) {
    const available = num(row.available);
    const typical = typicalQuantity.get(String(row.product_sku_id)) ?? 0;
    // Low only means something relative to how much they actually order. With
    // no order history there is no "low", so this stays silent rather than
    // calling every small number a shortage.
    if (typical <= 0 || available >= typical) continue;
    upsert(row, {
      code: "running_low",
      cohort: 1,
      detail: recommendationReasonText.runningLow(available, typical),
    });
  }

  const recommendations = rankRecommendations([...byItem.values()], {
    limit: input.limit,
    exclude: chosen,
  });

  return {
    ok: true,
    surface: "stock_request",
    recommendations,
    insufficientHistory: recommendations.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Surface 2: deal cross-sell
// ---------------------------------------------------------------------------

export type DealRecommendationInput = {
  dealId: string;
  /** Catalogue SKU codes already on the deal. */
  chosenSkus?: readonly string[];
  limit?: number;
};

/**
 * What tends to be sold alongside what is already on this deal.
 *
 * Evidence comes from won deals only: an open deal's line items are a
 * proposal, and a lost deal's are a counter-example. Both are aggregate and
 * therefore k-floored — the reader learns "included in 4 won deals", never
 * which four.
 */
export async function recommendDealProducts(
  actor: DistributionActor,
  input: DealRecommendationInput,
  deps: RecommendationDeps = {},
): Promise<RecommendationReadResult> {
  if (!(await surfaceEnabled(deps))) {
    return denial("Product recommendations are not enabled in this workspace");
  }

  const query = runner(deps);

  // The deal must be one this actor can already see. Recommendations must not
  // become a side channel that confirms a deal exists.
  // The participant clause matches the one the table policy uses verbatim
  // (appendOwnerOrParticipantTagScope in livey-service.server.ts): an active
  // tag is participant_user_id with valid_to IS NULL. Diverging from it here
  // would let recommendations disagree with the deal's own visibility rules.
  const visible = await query(
    `SELECT d.id
     FROM portal_deals d
     WHERE d.id = $1
       AND ($2 = TRUE OR d.user_id = $3 OR EXISTS (
         SELECT 1 FROM deal_participants pt
         WHERE pt.deal_id = d.id
           AND pt.participant_user_id = $3
           AND pt.valid_to IS NULL
       ))`,
    [input.dealId, actor.assignment.roleKey === "super_admin", actor.userId],
  );
  if (!visible.rows[0]) {
    return denial("That deal is not accessible");
  }

  const chosen = [...new Set((input.chosenSkus ?? []).filter(Boolean))];

  const [coOccurrence, categoryPeers] = await Promise.all([
    chosen.length === 0
      ? Promise.resolve({ rows: [] })
      : query(
          `SELECT c.id AS item_id,
                  c.sku,
                  c.product_name,
                  c.category,
                  COUNT(DISTINCT other.deal_id)::int AS cohort
           FROM deal_line_items anchor
           JOIN portal_deals d ON d.id = anchor.deal_id AND d.stage = 'won'
           JOIN deal_line_items other
             ON other.deal_id = anchor.deal_id
            AND other.product_id <> anchor.product_id
           JOIN portal_catalog_items c ON c.sku = other.product_id
           WHERE anchor.product_id = ANY($1)
             AND NOT (other.product_id = ANY($1))
             AND c.archived_at IS NULL
             AND c.product_status = 'active'
           GROUP BY c.id, c.sku, c.product_name, c.category
           HAVING COUNT(DISTINCT other.deal_id) >= $2
           ORDER BY cohort DESC
           LIMIT 20`,
          [chosen, MIN_AGGREGATE_COHORT],
        ),

    // Products that show up on won deals generally — the fallback when this
    // deal has no lines yet to anchor on.
    query(
      `SELECT c.id AS item_id,
              c.sku,
              c.product_name,
              c.category,
              COUNT(DISTINCT li.deal_id)::int AS cohort
       FROM deal_line_items li
       JOIN portal_deals d ON d.id = li.deal_id AND d.stage = 'won'
       JOIN portal_catalog_items c ON c.sku = li.product_id
       WHERE c.archived_at IS NULL
         AND c.product_status = 'active'
         AND NOT (li.product_id = ANY($1))
       GROUP BY c.id, c.sku, c.product_name, c.category
       HAVING COUNT(DISTINCT li.deal_id) >= $2
       ORDER BY cohort DESC
       LIMIT 20`,
      [chosen.length > 0 ? chosen : [""], MIN_AGGREGATE_COHORT],
    ),
  ]);

  const byItem = new Map<string, ProductRecommendationCandidate>();
  const add = (row: Record<string, unknown>, reason: RecommendationReason) => {
    const itemId = String(row.item_id);
    const existing = byItem.get(itemId);
    if (existing) {
      existing.reasons.push(reason);
      return;
    }
    byItem.set(itemId, {
      itemId,
      itemCode: String(row.sku ?? ""),
      itemName: String(row.product_name ?? ""),
      category: row.category == null ? null : String(row.category),
      reasons: [reason],
    });
  };

  for (const row of coOccurrence.rows as Array<Record<string, unknown>>) {
    add(row, {
      code: "ordered_together",
      cohort: num(row.cohort),
      detail: recommendationReasonText.wonDealAttach(num(row.cohort)),
    });
  }
  for (const row of categoryPeers.rows as Array<Record<string, unknown>>) {
    add(row, {
      code: "won_deal_attach",
      cohort: num(row.cohort),
      detail: recommendationReasonText.wonDealAttach(num(row.cohort)),
    });
  }

  const recommendations = rankRecommendations([...byItem.values()], { limit: input.limit });
  return {
    ok: true,
    surface: "deal",
    recommendations,
    insufficientHistory: recommendations.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Surface 3: catalogue browse
// ---------------------------------------------------------------------------

export type CatalogueRecommendationInput = {
  /** The catalogue SKU code being viewed. */
  sku: string;
  limit?: number;
};

/**
 * Related products for one catalogue item.
 *
 * The catalogue is public-read in this product (PUBLIC_READ_TABLES), so this
 * needs no per-record scope — but it still needs the surface flag, and it
 * still k-floors its aggregate evidence.
 */
export async function recommendRelatedCatalogueItems(
  actor: DistributionActor | null,
  input: CatalogueRecommendationInput,
  deps: RecommendationDeps = {},
): Promise<RecommendationReadResult> {
  if (!(await surfaceEnabled(deps))) {
    return denial("Product recommendations are not enabled in this workspace");
  }
  void actor;

  const query = runner(deps);
  const sku = input.sku?.trim();
  if (!sku) return denial("A product is required");

  const [coOccurrence, sameCategory] = await Promise.all([
    query(
      `SELECT c.id AS item_id,
              c.sku,
              c.product_name,
              c.category,
              COUNT(DISTINCT other.deal_id)::int AS cohort
       FROM deal_line_items anchor
       JOIN deal_line_items other
         ON other.deal_id = anchor.deal_id AND other.product_id <> anchor.product_id
       JOIN portal_catalog_items c ON c.sku = other.product_id
       WHERE anchor.product_id = $1
         AND c.archived_at IS NULL
         AND c.product_status = 'active'
       GROUP BY c.id, c.sku, c.product_name, c.category
       HAVING COUNT(DISTINCT other.deal_id) >= $2
       ORDER BY cohort DESC
       LIMIT 20`,
      [sku, MIN_AGGREGATE_COHORT],
    ),
    query(
      `SELECT peer.id AS item_id,
              peer.sku,
              peer.product_name,
              peer.category,
              (SELECT COUNT(*)::int FROM portal_catalog_items sibling
                WHERE sibling.category = peer.category
                  AND sibling.archived_at IS NULL) AS cohort
       FROM portal_catalog_items anchor
       JOIN portal_catalog_items peer
         ON peer.category = anchor.category AND peer.sku <> anchor.sku
       WHERE anchor.sku = $1
         AND peer.archived_at IS NULL
         AND peer.product_status = 'active'
       ORDER BY peer.product_name ASC
       LIMIT 20`,
      [sku],
    ),
  ]);

  const byItem = new Map<string, ProductRecommendationCandidate>();
  const add = (row: Record<string, unknown>, reason: RecommendationReason) => {
    const itemId = String(row.item_id);
    const existing = byItem.get(itemId);
    if (existing) {
      existing.reasons.push(reason);
      return;
    }
    byItem.set(itemId, {
      itemId,
      itemCode: String(row.sku ?? ""),
      itemName: String(row.product_name ?? ""),
      category: row.category == null ? null : String(row.category),
      reasons: [reason],
    });
  };

  for (const row of coOccurrence.rows as Array<Record<string, unknown>>) {
    add(row, {
      code: "ordered_together",
      cohort: num(row.cohort),
      detail: recommendationReasonText.wonDealAttach(num(row.cohort)),
    });
  }
  // Category alone cannot clear the score floor, so these only ever sharpen
  // an item that already has real evidence behind it.
  for (const row of sameCategory.rows as Array<Record<string, unknown>>) {
    add(row, {
      code: "category_peer",
      cohort: num(row.cohort),
      detail: recommendationReasonText.categoryPeer(
        String(row.category ?? "this category"),
        num(row.cohort),
      ),
    });
  }

  const recommendations = rankRecommendations([...byItem.values()], { limit: input.limit });
  return {
    ok: true,
    surface: "catalogue",
    recommendations,
    insufficientHistory: recommendations.length === 0,
  };
}
