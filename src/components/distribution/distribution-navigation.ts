/**
 * Where Distribution is allowed to appear, and what the Deal/Customer
 * contextual action should say.
 *
 * Pure and shared, so the sidebar, the command palette, Deals, and Customers
 * cannot drift apart. Every one of them needs BOTH gates: the role permission
 * matrix says who may see Distribution, and the server-evaluated surface flag
 * says whether it is switched on in this deployment. A second navigation
 * source with its own rules is how a hidden route ends up linked from
 * somewhere nobody checked.
 */
export type DistributionAccess = {
  canRead: boolean;
  canCreate: boolean;
  surfaceEnabled: boolean;
};

export function showDistributionNavigation(access: DistributionAccess): boolean {
  return access.surfaceEnabled && access.canRead;
}

export type ContextualStockAction = {
  label: "Request stock" | "Track stock";
  intent: "create" | "track";
};

/**
 * The action a Deal or Customer offers.
 *
 * `null` means render nothing at all — not a disabled button. A permanently
 * disabled action reads as "you lack permission" when the truth is usually
 * "this is not switched on", and neither is something the reader can fix by
 * clicking.
 *
 * Only an actor who may create a request is offered one; everyone else who
 * can read Distribution gets the read-only view of that record's requests,
 * which is a real destination rather than a dead end.
 */
export function contextualStockAction(access: DistributionAccess): ContextualStockAction | null {
  if (!showDistributionNavigation(access)) return null;
  return access.canCreate
    ? { label: "Request stock", intent: "create" }
    : { label: "Track stock", intent: "track" };
}
