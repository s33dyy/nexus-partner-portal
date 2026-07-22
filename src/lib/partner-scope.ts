export function applyPartnerScope<T>(
  query: T,
  input: {
    isSuperAdmin: boolean;
    partnerId?: string | null;
    userId?: string | null;
    fallbackColumn?: string;
  },
) {
  const scopedQuery = query as T & { eq: (column: string, value: string) => T };

  if (input.isSuperAdmin) {
    return query;
  }

  if (input.partnerId) {
    return scopedQuery.eq("partner_id", input.partnerId);
  }

  if (input.userId) {
    return scopedQuery.eq(input.fallbackColumn ?? "user_id", input.userId);
  }

  return query;
}
