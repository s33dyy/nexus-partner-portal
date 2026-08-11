import { createServerFn } from "@tanstack/react-start";

import type { LookupValueRow } from "@/server/lookup-values.server";

const listLookupValuesFn = createServerFn({ method: "GET" })
  .validator((input: { fieldName: string }) => input)
  .handler(async ({ data }) => {
    const { listLookupValues } = await import("@/server/lookup-values.server");
    return listLookupValues(data.fieldName);
  });

const upsertLookupValueFn = createServerFn({ method: "POST" })
  .validator((input: { fieldName: string; value: string }) => input)
  .handler(async ({ data }) => {
    const { upsertLookupValue } = await import("@/server/lookup-values.server");
    return upsertLookupValue(data.fieldName, data.value);
  });

export async function listLookupValues(fieldName: string): Promise<LookupValueRow[]> {
  return listLookupValuesFn({ data: { fieldName } });
}

export async function upsertLookupValue(fieldName: string, value: string): Promise<LookupValueRow> {
  return upsertLookupValueFn({ data: { fieldName, value } });
}
