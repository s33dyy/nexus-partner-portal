import { expect, test } from "bun:test";

import { listVisibleExportDatasets } from "@/lib/export-registry";

test("listVisibleExportDatasets hides admin-only exports from partner users", () => {
  const visible = listVisibleExportDatasets("partner_user").map((dataset) => dataset.id);

  expect(visible).not.toContain("portal-audit-events");
  expect(visible).not.toContain("admin-users");
  expect(visible).toContain("portal-deals");
});
