/**
 * Universal UUID generation.
 *
 * `crypto.randomUUID` exists on `globalThis` in both Node (18.17+/19+) and
 * every browser this app targets, so importing it from `node:crypto` buys
 * nothing and costs a great deal: any module that does so is poisoned for the
 * client bundle, and Vite serves a browser-externalized stub that throws at
 * import time. Three modules in the client graph — governance.ts, catalog.ts
 * and pricing-domain.ts — did exactly that, and together with telemetry.ts
 * they were why `bun run dev` rendered the error boundary on every route.
 *
 * Lives in domain/contracts (the lowest layer) rather than lib/ so the
 * contract modules can use it without inverting the dependency direction.
 */
export function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  // Only reached on a runtime without WebCrypto. Not cryptographically
  // strong, and deliberately shaped like a UUID so it can't be mistaken for
  // one in a log.
  const rand = () => Math.random().toString(16).slice(2, 10);
  return `${rand()}-${rand().slice(0, 4)}-4${rand().slice(0, 3)}-a${rand().slice(0, 3)}-${rand()}${rand().slice(0, 4)}`;
}
