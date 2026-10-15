import { describe, expect, it } from "vitest";

import { isTaskDateOnlySentinel, serializeTaskDateInput } from "./task-filters";

describe("task date serialization", () => {
  it("serializes a date-only input to a stable UTC-noon persisted value", () => {
    expect(serializeTaskDateInput("2026-10-10")).toBe("2026-10-10T12:00:00.000Z");
    expect(isTaskDateOnlySentinel("2026-10-10T12:00:00.000Z")).toBe(true);
  });

  it("does not classify a precise timestamp as a date-only sentinel", () => {
    expect(isTaskDateOnlySentinel("2026-10-10T12:00:00.001Z")).toBe(false);
  });
});
