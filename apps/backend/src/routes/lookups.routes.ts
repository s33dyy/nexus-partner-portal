import { Hono } from "hono";

import { listLookupValues, upsertLookupValue } from "@/server/lookup-values.server";

export const lookupRoutes = new Hono();

lookupRoutes.get("/list-lookup-values", async (c) =>
  c.json(await listLookupValues(c.req.query("fieldName") ?? "")),
);

lookupRoutes.post("/upsert-lookup-value", async (c) => {
  const body = await c.req.json<{ fieldName: string; value: string }>();
  return c.json(await upsertLookupValue(body.fieldName, body.value));
});
