import { expect, test } from "bun:test";

import { canManageTicket } from "./ticket-permissions";

test("ticket management controls are limited to Super Admin and LIVEY Support", () => {
  expect(canManageTicket("super_admin")).toBe(true);
  expect(canManageTicket("livey_support")).toBe(true);
  expect(canManageTicket("rm")).toBe(false);
  expect(canManageTicket("pam")).toBe(false);
  expect(canManageTicket("kam")).toBe(false);
  expect(canManageTicket("isr")).toBe(false);
  expect(canManageTicket("partner_admin")).toBe(false);
  expect(canManageTicket("partner_user")).toBe(false);
  expect(canManageTicket("restricted_distributor")).toBe(false);
  expect(canManageTicket(null)).toBe(false);
});
