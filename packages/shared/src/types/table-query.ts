export type QueryFilter = {
  column: string;
  value: unknown;
  operator: "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte" | "ilike";
};

export type QueryOrder = {
  column: string;
  ascending?: boolean;
};

/**
 * The client-supplied half of a table query — everything the frontend's
 * supabase.from(...) builder can express. The read-scope narrowing the policy
 * layer adds lives only in the backend's own TableQuery, so it can never be
 * set from a request body.
 */
export type TableQuery = {
  table: string;
  operation: "select" | "insert" | "update" | "delete" | "count";
  filters?: QueryFilter[];
  order?: QueryOrder;
  values?: Record<string, unknown> | Array<Record<string, unknown>>;
  single?: "single" | "maybeSingle" | null;
  limit?: number;
  select?: string;
};
