import { resolveDistributionActor } from "@/server/distribution-policy.server";

/**
 * Resolves the authenticated governed actor for a Distribution server
 * function.
 *
 * This lives in a `.server` module rather than beside the server-function
 * wrappers because of how the client bundle is built: a wrapper module is
 * reachable from the route, and Vite's import protection rejects any path
 * from client code into `**\/server/**`. The plugin strips
 * `createServerFn().handler()` bodies, so a server import is safe INSIDE a
 * handler and unsafe in a module-level helper the handlers merely call — the
 * helper stays in the module and its import edge with it.
 *
 * So the wrappers import this dynamically, inside their handlers, and the
 * client graph never touches the session, the pool, or the policy layer.
 */
export async function resolveDistributionActorFromSession() {
  const { getAuthContext } = await import("@/server/livey-service.server");
  const authContext = await getAuthContext();
  return resolveDistributionActor({
    userId: authContext.session?.user.id ?? null,
    assignment: authContext.assignment,
    activeContext: authContext.activeContext,
  });
}
