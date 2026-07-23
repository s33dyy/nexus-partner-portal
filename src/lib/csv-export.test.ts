import { expect, test } from "bun:test";

import { buildCsv, normalizeCsvValue } from "@/lib/csv-export";

test("buildCsv escapes commas, quotes, arrays, and empty values", () => {
  const csv = buildCsv(
    [
      { key: "name", header: "Name" },
      { key: "tags", header: "Tags" },
      { key: "notes", header: "Notes" },
      { key: "empty", header: "Empty" },
    ],
    [
      {
        name: "ACME, Inc.",
        tags: ["alpha", 0, false, null, undefined, "beta"],
        notes: 'He said "yes"',
        empty: null,
      },
    ],
  );

  expect(csv).toContain('"ACME, Inc."');
  expect(csv).toContain('"alpha; 0; false; beta"');
  expect(csv).toContain('"He said ""yes"""');
  expect(csv.split("\n")[1]).toBe('"ACME, Inc.","alpha; 0; false; beta","He said ""yes""",');
});

test("normalizeCsvValue joins arrays and serializes objects", () => {
  expect(normalizeCsvValue(["alpha", 0, false, null, undefined, "beta"])).toBe(
    "alpha; 0; false; beta",
  );
  expect(normalizeCsvValue({ ok: true })).toBe(JSON.stringify({ ok: true }));
});

test("normalizeCsvValue safely falls back for circular objects", () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;

  expect(normalizeCsvValue(circular)).toBe("[object Object]");
});
