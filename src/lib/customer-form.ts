/** Employee Count is optional on the Customers create form. */
export function normalizeOptionalEmployeeCount(value: string): string {
  return value.trim();
}

/** Renewal Type is optional; when supplied it remains a trimmed value. */
export function normalizeOptionalRenewalType(value: string): string {
  return value.trim();
}
