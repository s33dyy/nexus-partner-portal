import type { UserDigest } from "@/domain/contracts/digest";

import { apiFetch } from "./api-client";

export async function getUserDigest(): Promise<UserDigest> {
  return apiFetch("GET", "/api/digest/get-user-digest");
}
