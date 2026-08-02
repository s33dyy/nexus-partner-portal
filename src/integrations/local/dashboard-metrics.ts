import { createServerFn } from "@tanstack/react-start";

import type { RegionFilterValue } from "@/lib/region-filter";
import type { DashboardPipelineResult } from "@/server/dashboard-metrics.server";

const loadDashboardPipelineFn = createServerFn({ method: "GET" })
  .validator((input: { selectedRegion: RegionFilterValue }) => input)
  .handler(async ({ data }): Promise<DashboardPipelineResult> => {
    const { getAuthContext } = await import("@/server/livey-service.server");
    const { loadDashboardPipelineMetrics } = await import("@/server/dashboard-metrics.server");
    const context = await getAuthContext();
    return loadDashboardPipelineMetrics({
      selectedRegion: data.selectedRegion,
      auth: {
        userId: context.session?.user.id ?? null,
        roles: context.roles,
        partnerId: context.profile?.partner_id ?? null,
        companyName: context.profile?.company_name ?? null,
        hasGovernedContext: Boolean(context.activeContext),
        governedRoleKey: context.assignment?.roleKey ?? null,
        geographyCeilingNodeId: context.assignment?.geographyCeilingNodeId ?? null,
      },
    });
  });

export function loadDashboardPipeline(
  selectedRegion: RegionFilterValue,
): Promise<DashboardPipelineResult> {
  return loadDashboardPipelineFn({ data: { selectedRegion } });
}
