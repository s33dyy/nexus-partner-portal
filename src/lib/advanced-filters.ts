export type FilterScalar = string | number | boolean | null | undefined;

export type AdvancedFilterValues = Record<string, FilterScalar | readonly unknown[]>;

export type NumericRange = {
  min?: number | null;
  max?: number | null;
};

export type IsoDateRange = {
  from?: string | null;
  to?: string | null;
};

const RANGE_SUFFIXES = ["Min", "Max", "From", "To"] as const;

export function normalizeFilterText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

export function isEmptyFilterValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return normalizeFilterText(value) === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function matchesExactOption(value: unknown, expected: unknown): boolean {
  if (isEmptyFilterValue(expected)) return true;
  if (Array.isArray(expected)) {
    return expected.some((option) => matchesExactOption(value, option));
  }
  if (typeof value === "string" && typeof expected === "string") {
    return normalizeFilterText(value) === normalizeFilterText(expected);
  }
  return value === expected;
}

export function matchesInclusiveNumericRange(value: unknown, range: NumericRange): boolean {
  if (isEmptyFilterValue(value)) return false;
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return false;

  if (range.min !== null && range.min !== undefined && numericValue < range.min) return false;
  if (range.max !== null && range.max !== undefined && numericValue > range.max) return false;
  return true;
}

export function matchesInclusiveIsoDateRange(value: unknown, range: IsoDateRange): boolean {
  if (isEmptyFilterValue(value)) return false;
  const dateValue = Date.parse(String(value));
  if (!Number.isFinite(dateValue)) return false;

  if (!isEmptyFilterValue(range.from)) {
    const from = Date.parse(String(range.from));
    if (!Number.isFinite(from) || dateValue < from) return false;
  }
  if (!isEmptyFilterValue(range.to)) {
    const to = Date.parse(String(range.to));
    if (!Number.isFinite(to) || dateValue > to) return false;
  }
  return true;
}

function getRecordField<T extends Record<string, unknown>>(record: T, base: string): string | undefined {
  if (base in record) return base;
  if (base === "date") {
    const dateField = Object.keys(record).find((key) => key.toLocaleLowerCase().endsWith("date"));
    return dateField;
  }
  return undefined;
}

function getRangeBase(key: string): { base: string; suffix: (typeof RANGE_SUFFIXES)[number] } | undefined {
  const suffix = RANGE_SUFFIXES.find((candidate) => key.endsWith(candidate));
  if (!suffix) return undefined;
  return { base: key.slice(0, -suffix.length), suffix };
}

function hasRangeValue(filters: AdvancedFilterValues, base: string, suffix: "Min" | "Max" | "From" | "To") {
  return !isEmptyFilterValue(filters[`${base}${suffix}`]);
}

export function matchesAdvancedFilters<T extends Record<string, unknown>>(
  record: T,
  filters: AdvancedFilterValues,
  textFields: readonly (keyof T & string)[],
): boolean {
  const text = filters.text;
  if (!isEmptyFilterValue(text)) {
    const normalizedText = normalizeFilterText(text);
    const textMatches = textFields.some((field) => normalizeFilterText(record[field]).includes(normalizedText));
    if (!textMatches) return false;
  }

  for (const [key, expected] of Object.entries(filters)) {
    if (key === "text" || isEmptyFilterValue(expected)) continue;

    const range = getRangeBase(key);
    if (range) {
      const field = getRecordField(record, range.base);
      if (!field) continue;

      const hasNumericRange = hasRangeValue(filters, range.base, "Min") || hasRangeValue(filters, range.base, "Max");
      const hasDateRange = hasRangeValue(filters, range.base, "From") || hasRangeValue(filters, range.base, "To");
      if (hasNumericRange && (range.suffix === "Min" || range.suffix === "Max")) {
        if (
          !matchesInclusiveNumericRange(record[field], {
            min: filters[`${range.base}Min`] as number | null | undefined,
            max: filters[`${range.base}Max`] as number | null | undefined,
          })
        ) {
          return false;
        }
      } else if (hasDateRange && (range.suffix === "From" || range.suffix === "To")) {
        if (
          !matchesInclusiveIsoDateRange(record[field], {
            from: filters[`${range.base}From`] as string | null | undefined,
            to: filters[`${range.base}To`] as string | null | undefined,
          })
        ) {
          return false;
        }
      }
      continue;
    }

    if (key in record && !matchesExactOption(record[key], expected)) return false;
  }

  return true;
}

export function countActiveFilters(filters: AdvancedFilterValues): number {
  return Object.values(filters).filter((value) => !isEmptyFilterValue(value)).length;
}
