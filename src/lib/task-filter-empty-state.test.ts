import { describe, expect, it } from "vitest";

import { getTaskEmptyState } from "./task-filters";

describe("task empty-state selection", () => {
  it("prefers clearing advanced filters over creating a task for an empty filtered view", () => {
    expect(getTaskEmptyState("all", { text: "missing" }).action).toBe("clearFilters");
    expect(getTaskEmptyState("all", { text: "missing" }).title).toBe(
      "No tasks match these filters",
    );
    expect(getTaskEmptyState("all", {}).action).toBe("createTask");
    expect(getTaskEmptyState("completed", {}).action).toBeNull();
  });
});
