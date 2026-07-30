import { expect, test } from "bun:test";

import { PROD_DEMO_PROFILES, buildProdDemoGovernanceSeedRows } from "./prod-demo-fixtures";

test("prod demo governance covers every seeded login", () => {
  const superAdminIds = PROD_DEMO_PROFILES.filter((profile) =>
    profile.roles.includes("super_admin"),
  ).map((profile) => profile.id);

  const governance = buildProdDemoGovernanceSeedRows({ superAdminUserIds: superAdminIds });

  expect(governance.assignments).toHaveLength(15);
  expect(governance.activeContexts).toHaveLength(15);
  expect(governance.assignments.filter((row) => row.roleKey === "super_admin")).toHaveLength(5);
  expect(governance.assignments.filter((row) => row.roleKey === "partner_admin")).toHaveLength(5);
  expect(governance.assignments.filter((row) => row.roleKey === "partner_user")).toHaveLength(5);
});
