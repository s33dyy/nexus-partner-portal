import { expect, test } from "bun:test";

import {
  contextualStockAction,
  showDistributionNavigation,
  type DistributionAccess,
} from "@/components/distribution/distribution-navigation";

function access(overrides: Partial<DistributionAccess> = {}): DistributionAccess {
  return { canRead: true, canCreate: true, surfaceEnabled: true, ...overrides };
}

test("Distribution appears only when the surface flag AND the role permission both allow it", () => {
  expect(showDistributionNavigation(access())).toBe(true);
  expect(showDistributionNavigation(access({ surfaceEnabled: false }))).toBe(false);
  expect(showDistributionNavigation(access({ canRead: false }))).toBe(false);
  // A role with create but no read is a misconfiguration, not a shortcut in.
  expect(showDistributionNavigation(access({ canRead: false, canCreate: true }))).toBe(false);
});

test("the contextual action is absent rather than disabled when Distribution is hidden", () => {
  expect(contextualStockAction(access({ surfaceEnabled: false }))).toBeNull();
  expect(contextualStockAction(access({ canRead: false }))).toBeNull();
});

test("only an actor who may create a request is offered one", () => {
  expect(contextualStockAction(access())).toEqual({ label: "Request stock", intent: "create" });
  // A manager can see the record's requests but does not raise them.
  expect(contextualStockAction(access({ canCreate: false }))).toEqual({
    label: "Track stock",
    intent: "track",
  });
});
