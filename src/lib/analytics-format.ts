/**
 * Display formatting for the Analytics dashboard.
 *
 * Split from the components that use them so the module exports only
 * functions — mixing the two breaks React Fast Refresh, and these are also
 * wanted by the Excel export, which has no business importing a component.
 *
 * The important one is `formatPercent`: it renders null as an em-dash rather
 * than 0%. "We won 0% of our deals" and "nothing has been decided yet" are
 * different claims, and printing 0 for the second makes the first.
 */

export function formatUsd(value: number, compact = true): string {
  const useCompact = compact && Math.abs(value) >= 10_000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: useCompact ? "compact" : "standard",
    maximumFractionDigits: useCompact ? 1 : 0,
  }).format(value);
}

export function formatPercent(value: number | null, digits = 1): string {
  return value === null ? "—" : `${value.toFixed(digits)}%`;
}

export function formatDays(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}
