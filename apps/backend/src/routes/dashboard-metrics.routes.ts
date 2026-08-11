import { Hono } from "hono";

import { loadDashboardPipelineMetrics } from "@/server/dashboard-metrics.server";
import { getAuthContext } from "@/server/livey-service.server";
import type { RegionFilterValue } from "@livey/shared/lib/region-filter";

export const dashboardMetricsRoutes = new Hono();

dashboardMetricsRoutes.get("/load-dashboard-pipeline", async (c) => {
  const context = await getAuthContext();
  return c.json(
    await loadDashboardPipelineMetrics({
      selectedRegion: (c.req.query("selectedRegion") ?? "all") as RegionFilterValue,
      auth: {
        userId: context.session?.user.id ?? null,
        roles: context.roles,
        partnerId: context.profile?.partner_id ?? null,
        companyName: context.profile?.company_name ?? null,
        hasGovernedContext: Boolean(context.activeContext),
        governedRoleKey: context.assignment?.roleKey ?? null,
        geographyCeilingNodeId: context.assignment?.geographyCeilingNodeId ?? null,
      },
    }),
  );
});
