import { expect, test } from "bun:test";

import { getAuthenticatedGateState, getAuthenticatedRedirect } from "@/lib/auth-routing";

test("redirects users with must_reset_password to settings until they update it", () => {
  expect(
    getAuthenticatedRedirect({
      hasSession: true,
      pathname: "/dashboard",
      roles: ["partner_admin"],
      profile: {
        partner_status: "approved",
        must_reset_password: true,
      },
    }),
  ).toBe("/settings?passwordReset=1");
});

test("keeps forced-reset users on settings so they can complete the change", () => {
  expect(
    getAuthenticatedRedirect({
      hasSession: true,
      pathname: "/settings",
      roles: ["partner_admin"],
      profile: {
        partner_status: "approved",
        must_reset_password: true,
      },
    }),
  ).toBeNull();
});

test("still routes pending partner admins into onboarding when password reset is not required", () => {
  expect(
    getAuthenticatedRedirect({
      hasSession: true,
      pathname: "/dashboard",
      roles: ["partner_admin"],
      profile: {
        partner_status: "submitted",
        must_reset_password: false,
      },
    }),
  ).toBe("/partner/onboarding");
});

test("gate state flags missing governed context after profile load", () => {
  expect(
    getAuthenticatedGateState({
      hasSession: true,
      pathname: "/dashboard",
      roles: ["partner_admin"],
      profile: {
        partner_status: "approved",
        must_reset_password: false,
      },
      hasGovernedContext: false,
    }),
  ).toBe("context-pending");
});

test("gate state treats a governed super-admin session as ready", () => {
  expect(
    getAuthenticatedGateState({
      hasSession: true,
      pathname: "/dashboard",
      roles: ["super_admin"],
      profile: {
        partner_status: "approved",
        must_reset_password: false,
      },
      hasGovernedContext: true,
    }),
  ).toBe("ready");
});
