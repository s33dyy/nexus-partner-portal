import { expect, test } from "bun:test";

import { createBrowserId } from "@/lib/browser-id";

test("createBrowserId uses randomUUID when the browser provides it", () => {
  expect(createBrowserId({ randomUUID: () => "browser-uuid" })).toBe("browser-uuid");
});

test("createBrowserId returns a UUID-shaped fallback without randomUUID", () => {
  const id = createBrowserId({
    getRandomValues: (values: Uint8Array) => {
      values.fill(7);
      return values;
    },
  });

  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("createBrowserId ignores a non-callable randomUUID property", () => {
  const id = createBrowserId({ randomUUID: "unsupported" as unknown as () => string });
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
