import { describe, expect, it } from "vitest";

import { filterAdminRoles, filterAdminUsers } from "./admin-filters";

describe("admin filters", () => {
  it("combines user text and exact account filters", () => {
    const users = [
      {
        full_name: "Asha Mehta",
        email: "asha@example.com",
        company_name: "North Star",
        partner_id: "partner-1",
        region: "india",
        country: "IN",
        account_status: "approved",
        verification_status: "verified",
        roles: ["partner_admin"],
      },
      {
        full_name: "Bala Rao",
        email: "bala@example.com",
        company_name: "North Star",
        partner_id: null,
        region: "europe",
        country: "DE",
        account_status: "submitted",
        verification_status: "unverified",
        roles: ["rm"],
      },
    ];

    expect(
      filterAdminUsers(users, {
        text: "asha",
        partner: "partner-1",
        region: "india",
        country: "IN",
        accountStatus: "approved",
        verificationStatus: "verified",
      }),
    ).toEqual([users[0]]);
  });

  it("combines role search, scope, and capability state", () => {
    const roles = [
      {
        roleKey: "rm",
        label: "Relationship Manager",
        scope: "livey_internal",
        capabilityState: "full",
      },
      {
        roleKey: "partner_user",
        label: "Partner User",
        scope: "partner_external",
        capabilityState: "partial",
      },
      {
        roleKey: "isr",
        label: "Inside Sales Representative",
        scope: "livey_internal",
        capabilityState: "none",
      },
    ];

    expect(
      filterAdminRoles(roles, {
        text: "manager",
        scope: "livey_internal",
        capabilityState: "full",
      }),
    ).toEqual([roles[0]]);
  });
});
