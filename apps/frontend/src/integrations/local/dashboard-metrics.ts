import type { RegionFilterValue } from "@/lib/region-filter";
import type { DashboardPipelineResult } from "@livey/shared/types/dashboard-metrics";

import { apiFetch } from "./api-client";

export function loadDashboardPipeline(
  selectedRegion: RegionFilterValue,
): Promise<DashboardPipelineResult> {
  return apiFetch("GET", "/api/dashboard-metrics/load-dashboard-pipeline", undefined, {
    query: { selectedRegion },
  });
}
