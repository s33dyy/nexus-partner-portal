import { createHash } from "node:crypto";

/**
 * Stable content hash for an event payload, for idempotency keys and
 * tamper-evidence on the outbox.
 *
 * Lives here rather than alongside the rest of the telemetry contract because
 * it is the one helper in that group that needs a node: builtin, and
 * `domain/contracts/telemetry.ts` is reachable from the client module graph —
 * see the note at the top of that file for what its `node:crypto` import used
 * to do to `bun run dev`.
 */
export function createEventHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
