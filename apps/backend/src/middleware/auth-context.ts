import { AsyncLocalStorage } from "node:async_hooks";

import type { MiddlewareHandler } from "hono";

import { readSessionToken } from "@/lib/session-cookie";

type RequestState = {
  token: string | null;
};

const requestContext = new AsyncLocalStorage<RequestState>();

export function getRequestToken(): string | null {
  return requestContext.getStore()?.token ?? null;
}

export const sessionAuthMiddleware: MiddlewareHandler = (c, next) => {
  return requestContext.run({ token: readSessionToken(c.req.raw) }, next);
};
