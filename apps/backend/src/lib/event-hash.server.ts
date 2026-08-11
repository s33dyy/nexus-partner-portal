import { createHash } from "node:crypto";

export function createEventHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
