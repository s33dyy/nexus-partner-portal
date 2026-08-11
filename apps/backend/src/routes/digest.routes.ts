import { Hono } from "hono";

import { getUserDigest } from "@/server/digest.server";

export const digestRoutes = new Hono();

digestRoutes.get("/get-user-digest", async (c) => c.json(await getUserDigest()));
