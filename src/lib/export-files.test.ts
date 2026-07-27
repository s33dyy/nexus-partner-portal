import { expect, test } from "bun:test";

import { buildExportFilename } from "@/lib/export-files";

test("buildExportFilename returns a stable dated export name", () => {
  expect(buildExportFilename("livey-customers", "csv", new Date("2026-07-27T00:00:00.000Z"))).toBe(
    "livey-customers-2026-07-27.csv",
  );
});
