import { expect, test } from "bun:test";

import { PROD_DEMO_PARTNERS, PROD_DEMO_PROFILES, PROD_DEMO_USER_ROLES } from "./prod-demo-fixtures";

test("prod demo fixtures provide five logins per portal role", () => {
  expect(PROD_DEMO_PROFILES).toHaveLength(15);
  expect(PROD_DEMO_PARTNERS).toHaveLength(5);
  expect(PROD_DEMO_USER_ROLES.filter((row) => row.role === "super_admin")).toHaveLength(5);
  expect(PROD_DEMO_USER_ROLES.filter((row) => row.role === "partner_admin")).toHaveLength(5);
  expect(PROD_DEMO_USER_ROLES.filter((row) => row.role === "partner_user")).toHaveLength(5);
});
