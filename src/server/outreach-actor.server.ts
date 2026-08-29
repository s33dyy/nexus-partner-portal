import { resolveOutreachActor } from "@/server/outreach-policy.server";

/**
 * Resolves the authenticated governed actor for an outreach server function.
 *
 * Lives in a `.server` module rather than beside the server-function
 * wrappers for the same reason distribution-actor.server.ts does: the
 * TanStack plugin strips `createServerFn().handler()` bodies from the client
 * bundle, so a server import is safe INSIDE a handler and unsafe in a
 * module-level helper the handlers merely call — the helper stays in the
 * module and its import edge with it. The wrappers import this dynamically,
 * inside their handlers, and the client graph never touches the session, the
 * pool, or the policy layer.
 */
export async function resolveOutreachActorFromSession() {
  const { getAuthContext } = await import("@/server/livey-service.server");
  const authContext = await getAuthContext();
  return resolveOutreachActor({
    userId: authContext.session?.user.id ?? null,
    assignment: authContext.assignment,
    activeContext: authContext.activeContext,
  });
}
