import { expect, test } from "bun:test";

import { canViewDeal } from "./deal-visibility";

const hiddenDeal = {
  id: "deal-123",
  user_id: "creator-1",
  partner_id: "partner-1",
  is_hidden_to_team: true,
};

test("creator can always see their hidden deal", () => {
  expect(
    canViewDeal(hiddenDeal, {
      viewerUserId: "creator-1",
      viewerRole: "partner_user",
      isSuperAdmin: false,
      isPartnerAdmin: false,
      collaboratorUserIds: ["collab-1"],
    }),
  ).toBe(true);
});

test("invited collaborator can see a hidden deal", () => {
  expect(
    canViewDeal(hiddenDeal, {
      viewerUserId: "collab-1",
      viewerRole: "partner_user",
      isSuperAdmin: false,
      isPartnerAdmin: false,
      collaboratorUserIds: ["collab-1"],
    }),
  ).toBe(true);
});

test("unrelated partner user cannot see a hidden deal", () => {
  expect(
    canViewDeal(hiddenDeal, {
      viewerUserId: "other-user",
      viewerRole: "partner_user",
      isSuperAdmin: false,
      isPartnerAdmin: false,
      collaboratorUserIds: ["collab-1"],
    }),
  ).toBe(false);
});

test("partner admins and super admins can see hidden deals", () => {
  expect(
    canViewDeal(hiddenDeal, {
      viewerUserId: "admin-1",
      viewerRole: "partner_admin",
      isSuperAdmin: false,
      isPartnerAdmin: true,
      collaboratorUserIds: [],
    }),
  ).toBe(true);

  expect(
    canViewDeal(hiddenDeal, {
      viewerUserId: "admin-2",
      viewerRole: "super_admin",
      isSuperAdmin: true,
      isPartnerAdmin: false,
      collaboratorUserIds: [],
    }),
  ).toBe(true);
});
