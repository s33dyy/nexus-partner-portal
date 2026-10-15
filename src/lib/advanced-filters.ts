export type FilterScalar = string | number | boolean | null | undefined;

export type AdvancedFilterValues = Record<string, FilterScalar | readonly unknown[]>;

export type NumericRange = {
  min?: number | string | null;
  max?: number | string | null;
};

export type IsoDateRange = {
  from?: string | null;
  to?: string | null;
};

export type AdvancedFilterMatchOptions<T extends Record<string, unknown>> = {
  /** Required when dateFrom/dateTo filters are active; never inferred from textFields. */
  dateFields: readonly (keyof T & string)[];
};

const RANGE_SUFFIXES = ["Min", "Max", "From", "To"] as const;

export function normalizeFilterText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isEmptyFilterValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return normalizeFilterText(value) === "";
  if (Array.isArray(value)) return value.every((item) => isEmptyFilterValue(item));
  return false;
}

export function matchesExactOption(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    const options = expected.filter((option) => !isEmptyFilterValue(option));
    return options.length > 0 && options.some((option) => matchesExactOption(value, option));
  }
  if (isEmptyFilterValue(expected)) return true;
  return value === expected;
}

export function matchesInclusiveNumericRange(value: unknown, range: NumericRange): boolean {
  const numericValue = parseNumericValue(value);
  if (numericValue === undefined || Number.isNaN(numericValue)) return false;

  const min = parseNumericRangeBound(range.min);
  const max = parseNumericRangeBound(range.max);
  if ((min !== undefined && Number.isNaN(min)) || (max !== undefined && Number.isNaN(max)))
    return false;
  if (min !== undefined && numericValue < min) return false;
  if (max !== undefined && numericValue > max) return false;
  return true;
}

function parseNumericRangeBound(value: number | string | null | undefined): number | undefined {
  return parseNumericValue(value);
}

function parseNumericValue(value: unknown): number | undefined {
  if (isEmptyFilterValue(value)) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value !== "string") return Number.NaN;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : Number.NaN;
}

export function matchesInclusiveIsoDateRange(value: unknown, range: IsoDateRange): boolean {
  const dateValue = normalizeCalendarDate(value);
  if (!dateValue) return false;

  if (!isEmptyFilterValue(range.from)) {
    const from = normalizeCalendarDate(range.from);
    if (!from || dateValue < from) return false;
  }
  if (!isEmptyFilterValue(range.to)) {
    const to = normalizeCalendarDate(range.to);
    if (!to || dateValue > to) return false;
  }
  return true;
}

/**
 * Returns the calendar date encoded by a date value rather than comparing
 * instants. This keeps a date-only filter boundary and a timestamp produced
 * from local noon on the same calendar day aligned across timezones.
 */
export function normalizeCalendarDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/.exec(trimmed);
    if (match?.[1] && isValidCalendarDate(match[1])) return match[1];
  }

  if (isEmptyFilterValue(value)) return undefined;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : undefined;
}

function isValidCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function getRecordField<T extends Record<string, unknown>>(
  record: T,
  base: string,
  options: AdvancedFilterMatchOptions<T>,
): string | undefined {
  if (base === "date") {
    return options.dateFields?.find((field) => field in record);
  }
  if (base in record) return base;
  return undefined;
}

function getRangeBase(
  key: string,
): { base: string; suffix: (typeof RANGE_SUFFIXES)[number] } | undefined {
  const suffix = RANGE_SUFFIXES.find((candidate) => key.endsWith(candidate));
  if (!suffix) return undefined;
  return { base: key.slice(0, -suffix.length), suffix };
}

function hasRangeValue(
  filters: AdvancedFilterValues,
  base: string,
  suffix: "Min" | "Max" | "From" | "To",
) {
  return !isEmptyFilterValue(filters[`${base}${suffix}`]);
}

export function matchesAdvancedFilters<T extends Record<string, unknown>>(
  record: T,
  filters: AdvancedFilterValues,
  textFields: readonly (keyof T & string)[],
  options: AdvancedFilterMatchOptions<T> = { dateFields: [] },
): boolean {
  const text = filters.text;
  if (!isEmptyFilterValue(text)) {
    const normalizedText = normalizeFilterText(text);
    const textMatches = textFields.some((field) =>
      normalizeFilterText(record[field]).includes(normalizedText),
    );
    if (!textMatches) return false;
  }

  for (const [key, expected] of Object.entries(filters)) {
    if (key === "text" || isEmptyFilterValue(expected)) continue;

    const range = getRangeBase(key);
    if (range) {
      const field = getRecordField(record, range.base, options);
      if (!field) return false;

      const hasNumericRange =
        hasRangeValue(filters, range.base, "Min") || hasRangeValue(filters, range.base, "Max");
      const hasDateRange =
        hasRangeValue(filters, range.base, "From") || hasRangeValue(filters, range.base, "To");
      if (hasNumericRange && (range.suffix === "Min" || range.suffix === "Max")) {
        if (
          !matchesInclusiveNumericRange(record[field], {
            min: filters[`${range.base}Min`] as NumericRange["min"],
            max: filters[`${range.base}Max`] as NumericRange["max"],
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

    if (!(key in record) || !matchesExactOption(record[key], expected)) return false;
  }

  return true;
}

export function countActiveFilters(filters: AdvancedFilterValues): number {
  return Object.values(filters).filter((value) => !isEmptyFilterValue(value)).length;
}
