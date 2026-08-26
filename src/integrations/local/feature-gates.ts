import { createServerFn } from "@tanstack/react-start";

import type { ProductSurfaceSnapshot } from "@/server/feature-gates.server";

export type { ProductSurfaceSnapshot };

/** The browser's fail-closed default: used before the fetch resolves and
 * whenever it fails, so a network hiccup can never reveal a hidden surface. */
export const ALL_SURFACES_OFF: ProductSurfaceSnapshot = {
  distributionCore: false,
  integrationOperationsCentre: false,
  learningLessonAuthoring: false,
  gyftrFulfillment: false,
  productRecommendations: false,
};

/**
 * The single read the browser gets of product-surface readiness.
 *
 * Deliberately returns four booleans and nothing else — no flag rows, no
 * dependency names, no environment variable names, no credential state, and
 * no reason a surface is off. Knowing *that* a surface is unavailable is
 * enough to render; knowing *why* would leak the deployment's configuration
 * to every authenticated user.
 */
const getProductSurfacesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<ProductSurfaceSnapshot> => {
    const { resolveProductSurfaceSnapshot } = await import("@/server/feature-gates.server");
    return resolveProductSurfaceSnapshot();
  },
);

export async function getProductSurfaces(): Promise<ProductSurfaceSnapshot> {
  return getProductSurfacesFn();
}
