import type { LookupValueRow } from "@livey/shared/types/lookup-values";

import { apiFetch } from "./api-client";

export async function listLookupValues(fieldName: string): Promise<LookupValueRow[]> {
  return apiFetch("GET", "/api/lookups/list-lookup-values", undefined, { query: { fieldName } });
}

export async function upsertLookupValue(fieldName: string, value: string): Promise<LookupValueRow> {
  return apiFetch("POST", "/api/lookups/upsert-lookup-value", { fieldName, value });
}
