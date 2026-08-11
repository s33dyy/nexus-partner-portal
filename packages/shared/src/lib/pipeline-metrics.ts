import { DEAL_STAGE_ORDER } from "./portal-records";

const TERMINAL_PIPELINE_STAGES = new Set(["won", "lost"]);
// Widened to Set<string>: isOpenPipelineStage below accepts arbitrary
// lowercase-normalized input, not just the narrow DealStage literal union.
const OPEN_STAGES: Set<string> = new Set(
  DEAL_STAGE_ORDER.filter((stage) => !TERMINAL_PIPELINE_STAGES.has(stage)),
);

export type PipelineMetricDeal = {
  id: string;
  stage: string;
  effectiveDtpUsd: number | null;
  amountUsd: number | null;
  amountValue: number | null;
  currencyCode: string | null;
};

function positiveFinite(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

export function isOpenPipelineStage(stage: string): boolean {
  return OPEN_STAGES.has(stage.toLowerCase());
}

// Never falls back to free-text `amount` parsing — only structured USD
// sources count toward the canonical metric (design doc §6.1).
export function resolvePipelineDtpUsd(deal: PipelineMetricDeal): number | null {
  return (
    positiveFinite(deal.effectiveDtpUsd) ??
    positiveFinite(deal.amountUsd) ??
    (deal.currencyCode?.toUpperCase() === "USD" ? positiveFinite(deal.amountValue) : null)
  );
}

export function summarizeOpenPipeline(deals: PipelineMetricDeal[]) {
  let pipelineValueUsd = 0;
  let openDealCount = 0;
  let missingDtpCount = 0;

  for (const deal of deals) {
    if (!isOpenPipelineStage(deal.stage)) continue;
    openDealCount += 1;
    const dtp = resolvePipelineDtpUsd(deal);
    if (dtp == null) missingDtpCount += 1;
    else pipelineValueUsd += dtp;
  }

  return { pipelineValueUsd, openDealCount, missingDtpCount };
}
