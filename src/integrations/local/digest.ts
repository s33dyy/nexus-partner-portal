import { createServerFn } from "@tanstack/react-start";

import type { UserDigest } from "@/domain/contracts/digest";

const getUserDigestFn = createServerFn({ method: "GET" }).handler(async (): Promise<UserDigest> => {
  const { getUserDigest } = await import("@/server/digest.server");
  return getUserDigest();
});

export async function getUserDigest(): Promise<UserDigest> {
  return getUserDigestFn();
}
