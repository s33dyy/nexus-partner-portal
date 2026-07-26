import { expect, test } from "bun:test";

import { PARTNER_STATUSES, getStatusLabel, hasFullAccess, hasPartialAccess } from "@/lib/partner-status";

test("signed_pending_review is treated as basic access but not full access", () => {
  expect(PARTNER_STATUSES).toContain("signed_pending_review");
  expect(hasPartialAccess("signed_pending_review")).toBe(true);
  expect(hasFullAccess("signed_pending_review")).toBe(false);
  expect(getStatusLabel("signed_pending_review")).toBe("Signed - Awaiting Review");
});
