import { createServerFn } from "@tanstack/react-start";

import type { IntegrationDeliverySnapshot } from "@/server/integration-readiness.server";

export type { IntegrationDeliverySnapshot };

/**
 * Two gates, both server-side: the Integration Operations Centre surface
 * must be enabled, and the caller must be Super Admin. Hiding the nav entry
 * is not access control — this is.
 */
const getIntegrationDeliverySnapshotFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<IntegrationDeliverySnapshot> => {
    const [{ getAuthContext }, { resolveProductSurface }, { loadIntegrationDeliverySnapshot }] =
      await Promise.all([
        import("@/server/livey-service.server"),
        import("@/server/feature-gates.server"),
        import("@/server/integration-readiness.server"),
      ]);

    if (!(await resolveProductSurface("integration-operations-centre"))) {
      throw new Error("Access denied");
    }

    const authContext = await getAuthContext();
    if (!authContext.roles.includes("super_admin")) {
      throw new Error("Access denied");
    }

    return loadIntegrationDeliverySnapshot();
  },
);

export async function getIntegrationDeliverySnapshot(): Promise<IntegrationDeliverySnapshot> {
  return getIntegrationDeliverySnapshotFn();
}
