import { createServerFn } from "@tanstack/react-start";

import {
  RECOMMENDATION_EMPTY_COPY,
  type ProductRecommendationResult,
  type RecommendationSurface,
} from "@/domain/contracts/recommendations";

/**
 * The recommendation surfaces' entire server surface.
 *
 * Each handler resolves the governed actor itself, via a dynamic import
 * inside the handler body — the plugin strips those from the client bundle,
 * whereas a shared module-level helper would drag the pool and policy graph
 * into the browser. (See src/server/distribution-actor.server.ts for the
 * long version of why.)
 *
 * A denial and an empty result are deliberately the same shape to the caller:
 * either way there is nothing to show, and the panel says so. Nothing here
 * reports WHY it is empty beyond that, because "the flag is off" and "your
 * history is thin" are not things a product surface owes a browser.
 */
export type RecommendationPanelData = ProductRecommendationResult;

function emptyFor(surface: RecommendationSurface): RecommendationPanelData {
  return { surface, recommendations: [], insufficientHistory: true };
}

export { RECOMMENDATION_EMPTY_COPY };

const stockRequestRecommendationsFn = createServerFn({ method: "POST" })
  .validator(
    (input: { destinationLocationId: string; chosenProductSkuIds?: string[]; limit?: number }) =>
      input,
  )
  .handler(async ({ data }): Promise<RecommendationPanelData> => {
    const { resolveDistributionActorFromSession } =
      await import("@/server/distribution-actor.server");
    const actor = await resolveDistributionActorFromSession();
    if (!actor.ok) return emptyFor("stock_request");
    const { recommendStockRequestItems } = await import("@/server/recommendation-queries.server");
    const result = await recommendStockRequestItems(actor.actor, data);
    return result.ok ? result : emptyFor("stock_request");
  });

const dealRecommendationsFn = createServerFn({ method: "POST" })
  .validator((input: { dealId: string; chosenSkus?: string[]; limit?: number }) => input)
  .handler(async ({ data }): Promise<RecommendationPanelData> => {
    const { resolveDistributionActorFromSession } =
      await import("@/server/distribution-actor.server");
    const actor = await resolveDistributionActorFromSession();
    if (!actor.ok) return emptyFor("deal");
    const { recommendDealProducts } = await import("@/server/recommendation-queries.server");
    const result = await recommendDealProducts(actor.actor, data);
    return result.ok ? result : emptyFor("deal");
  });

const catalogueRecommendationsFn = createServerFn({ method: "POST" })
  .validator((input: { sku: string; limit?: number }) => input)
  .handler(async ({ data }): Promise<RecommendationPanelData> => {
    const { resolveDistributionActorFromSession } =
      await import("@/server/distribution-actor.server");
    const actor = await resolveDistributionActorFromSession();
    const { recommendRelatedCatalogueItems } =
      await import("@/server/recommendation-queries.server");
    const result = await recommendRelatedCatalogueItems(actor.ok ? actor.actor : null, data);
    return result.ok ? result : emptyFor("catalogue");
  });

export async function getStockRequestRecommendations(input: {
  destinationLocationId: string;
  chosenProductSkuIds?: string[];
  limit?: number;
}): Promise<RecommendationPanelData> {
  return stockRequestRecommendationsFn({ data: input });
}

export async function getDealRecommendations(input: {
  dealId: string;
  chosenSkus?: string[];
  limit?: number;
}): Promise<RecommendationPanelData> {
  return dealRecommendationsFn({ data: input });
}

export async function getCatalogueRecommendations(input: {
  sku: string;
  limit?: number;
}): Promise<RecommendationPanelData> {
  return catalogueRecommendationsFn({ data: input });
}
