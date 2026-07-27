export const DEAL_PROBABILITY_OPTIONS = [
  { value: 0, label: "0% - No chance" },
  { value: 25, label: "25% - Unlikely" },
  { value: 50, label: "50% - Likely" },
  { value: 100, label: "100% - Certain" },
] as const;

export type DealProbability = (typeof DEAL_PROBABILITY_OPTIONS)[number]["value"];

const DEAL_PROBABILITY_VALUES = DEAL_PROBABILITY_OPTIONS.map((option) => option.value);

export function isDealProbability(value: number): value is DealProbability {
  return DEAL_PROBABILITY_VALUES.includes(value as DealProbability);
}

export function normalizeDealProbability(value: number): DealProbability {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  let closest = DEAL_PROBABILITY_OPTIONS[0];

  for (const option of DEAL_PROBABILITY_OPTIONS) {
    if (Math.abs(option.value - clamped) < Math.abs(closest.value - clamped)) {
      closest = option;
    }
  }

  return closest.value;
}

export function formatDealProbability(value: number): string {
  const option = DEAL_PROBABILITY_OPTIONS.find((candidate) => candidate.value === value);
  return option ? option.label : `${Math.round(value)}% probability`;
}
