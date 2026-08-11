export type DashboardPipelineResult =
  | {
      ok: true;
      metrics: {
        pipelineValueUsd: number;
        openDealCount: number;
        missingDtpCount: number;
      };
    }
  | { ok: false; code: "POLICY_DENIED" | "QUERY_FAILED"; message: string };
