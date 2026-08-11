import { Hono } from "hono";

import { queryTable } from "@/server/livey-service.server";
import type { TableQuery as ClientTableQuery } from "@livey/shared/types/table-query";

export const queryRoutes = new Hono();

// Single generic gateway backing the frontend's supabase.from(table) shim.
// Per-table/per-role/per-operation authorization already lives in
// table-policy.server.ts, applied inside queryTable.
queryRoutes.post("/", async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>;
  // Types alone can't stop a request body carrying the policy layer's own
  // read-scope fields, so drop them before queryTable sees them.
  delete body.scopeAnyColumnEquals;
  delete body.scopeOwnerOrParticipantTag;
  return c.json(await queryTable(body as unknown as ClientTableQuery));
});
