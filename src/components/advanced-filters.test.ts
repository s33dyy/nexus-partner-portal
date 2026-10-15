import { expect, test } from "bun:test";

import { filterAdvancedFilterOptions, type AdvancedFilterOption } from "./advanced-filters.utils";

test("filters empty select option values so the placeholder owns the empty state", () => {
  const options: AdvancedFilterOption[] = [
    { label: "All statuses", value: "" },
    { label: "Open", value: "open" },
  ];

  expect(filterAdvancedFilterOptions(options)).toEqual([{ label: "Open", value: "open" }]);
});
