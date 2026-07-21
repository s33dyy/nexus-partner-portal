export function toDateInputValue(value: string | Date | null | undefined): string {
  if (!value) return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return String(value);
  }

  return parsed.toISOString().slice(0, 10);
}

export function formatDateLabel(value: string | Date | null | undefined): string {
  if (!value) return "—";
  if (value instanceof Date) {
    return value.toLocaleDateString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return String(value);
  }

  return parsed.toLocaleDateString();
}

export function formatDateTimeLabel(value: string | Date | null | undefined): string {
  if (!value) return "—";
  if (value instanceof Date) {
    return value.toLocaleString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return String(value);
  }

  return parsed.toLocaleString();
}
