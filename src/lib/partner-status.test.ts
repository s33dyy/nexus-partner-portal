import { expect, test } from "bun:test";

import {
  PARTNER_STATUSES,
  canAccessPartnerDocuments,
  canAccessDealDocuments,
  getPartnerAccessFlags,
  getStatusLabel,
  hasFullAccess,
  hasPartialAccess,
} from "@/lib/partner-status";

test("signed_pending_review is treated as basic access but not full access", () => {
  expect(PARTNER_STATUSES).toContain("signed_pending_review");
  expect(hasPartialAccess("signed_pending_review")).toBe(true);
  expect(hasFullAccess("signed_pending_review")).toBe(false);
  expect(getStatusLabel("signed_pending_review")).toBe("Signed - Awaiting Review");
});

test("partner users cannot access onboarding documents while admins can", () => {
  expect(canAccessPartnerDocuments("partner_user")).toBe(false);
  expect(canAccessPartnerDocuments("partner_admin")).toBe(true);
  expect(canAccessPartnerDocuments("super_admin")).toBe(true);
});

test("only approved partners can access deal documents", () => {
  expect(canAccessDealDocuments("submitted")).toBe(false);
  expect(canAccessDealDocuments("approved")).toBe(true);
});

test("partner access flags keep onboarding documents separate from deal documents", () => {
  const partnerAdmin = getPartnerAccessFlags({
    loading: false,
    status: "approved",
    roles: ["partner_admin"],
  });

  expect(partnerAdmin.canAccessPartnerDocuments).toBe(true);
  expect(partnerAdmin.canAccessDealDocuments).toBe(true);

  const partnerUser = getPartnerAccessFlags({
    loading: false,
    status: "approved",
    roles: ["partner_user"],
  });

  expect(partnerUser.canAccessPartnerDocuments).toBe(false);
  expect(partnerUser.canAccessDealDocuments).toBe(true);
});
