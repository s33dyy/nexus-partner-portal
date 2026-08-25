import type { StatusTone } from "@/lib/status-tone";
import {
  INVENTORY_MOVEMENT_TYPES,
  STOCK_REQUEST_STATUSES,
  type InventoryMovementType,
  type StockRequestAction,
  type StockRequestStatus,
} from "@/domain/contracts/distribution";

/**
 * Pure presentation helpers for the Distribution workspace.
 *
 * Kept out of the components so they can be tested without a render harness,
 * and so nothing here can accidentally become an authority decision: the
 * server supplies `allowedActions`, and these functions only decide how to
 * draw what it already permitted.
 */

export const DISTRIBUTION_TABS = ["requests", "stock", "movements", "exceptions"] as const;
export type DistributionTab = (typeof DISTRIBUTION_TABS)[number];

export function isDistributionTab(value: unknown): value is DistributionTab {
  return typeof value === "string" && (DISTRIBUTION_TABS as readonly string[]).includes(value);
}

export const STOCK_REQUEST_STATUS_LABEL: Record<StockRequestStatus, string> = {
  submitted: "Submitted",
  approved: "Approved",
  awaiting_stock: "Awaiting stock",
  partially_allocated: "Partly allocated",
  allocated: "Allocated",
  dispatched: "Dispatched",
  partially_received: "Partly received",
  received: "Received",
  exception: "Exception",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/**
 * A status pill is a state, not a label.
 *
 * `awaiting_stock` and `partially_allocated` are warnings rather than
 * failures — the request is fine, the warehouse is short — while `exception`
 * and `rejected` are the two that need somebody to act or to stop looking.
 */
export const STOCK_REQUEST_STATUS_TONE: Record<StockRequestStatus, StatusTone> = {
  submitted: "info",
  approved: "brand",
  awaiting_stock: "warning",
  partially_allocated: "warning",
  allocated: "brand",
  dispatched: "brand",
  partially_received: "warning",
  received: "success",
  exception: "danger",
  rejected: "danger",
  cancelled: "neutral",
};

export const MOVEMENT_TYPE_LABEL: Record<InventoryMovementType, string> = {
  opening_balance: "Opening balance",
  receipt: "Receipt",
  reservation: "Reservation",
  reservation_release: "Reservation released",
  dispatch: "Dispatch",
  delivery: "Delivery",
  transfer: "Transfer",
  damage: "Damage",
  adjustment: "Adjustment",
};

export const MOVEMENT_TYPE_TONE: Record<InventoryMovementType, StatusTone> = {
  opening_balance: "neutral",
  receipt: "success",
  reservation: "info",
  reservation_release: "neutral",
  dispatch: "brand",
  delivery: "success",
  transfer: "info",
  damage: "danger",
  adjustment: "warning",
};

export function stockRequestStatusLabel(status: string): string {
  return (STOCK_REQUEST_STATUS_LABEL as Record<string, string>)[status] ?? status;
}

export function stockRequestStatusTone(status: string): StatusTone {
  return (STOCK_REQUEST_STATUS_TONE as Record<string, StatusTone>)[status] ?? "neutral";
}

export function movementTypeLabel(movementType: string): string {
  return (MOVEMENT_TYPE_LABEL as Record<string, string>)[movementType] ?? movementType;
}

export function movementTypeTone(movementType: string): StatusTone {
  return (MOVEMENT_TYPE_TONE as Record<string, StatusTone>)[movementType] ?? "neutral";
}

export type RequestTotals = {
  requestedTotal: number;
  approvedTotal: number;
  reservedTotal: number;
  dispatchedTotal: number;
  receivedTotal: number;
};

/**
 * Progress as a percentage of APPROVED units, not requested ones.
 *
 * A request for ten that was approved for four and fully delivered is done,
 * not 40% done — the six that were never approved were never promised. Before
 * approval there is no denominator at all, so progress reads as zero rather
 * than as a misleading fraction of a number nobody has agreed to.
 */
export function requestProgressPercent(totals: RequestTotals): number {
  if (totals.approvedTotal <= 0) return 0;
  return Math.min(100, Math.round((totals.receivedTotal / totals.approvedTotal) * 100));
}

export function requestProgressLabel(totals: RequestTotals): string {
  if (totals.approvedTotal <= 0) {
    return `${totals.requestedTotal} requested`;
  }
  return `${totals.receivedTotal}/${totals.approvedTotal} received`;
}

/** Whether the server told us this actor may take this action on this
 * record. The server checks again on the command; this only decides whether
 * to draw the button. */
export function hasAction(
  allowedActions: readonly StockRequestAction[] | undefined,
  action: StockRequestAction,
): boolean {
  return Boolean(allowedActions?.includes(action));
}

// ---------------------------------------------------------------------------
// Search parameters
// ---------------------------------------------------------------------------

export type DistributionSearch = {
  tab?: DistributionTab;
  newRequest?: boolean;
  dealId?: string;
  customerId?: string;
  requestId?: string;
  productSkuId?: string;
  locationId?: string;
};

/**
 * Normalises the URL into the workspace's own vocabulary.
 *
 * Contextual links from Deals and Customers arrive here, so an unknown tab
 * falls back to Requests rather than rendering nothing, and `newRequest` is
 * only honoured when it is literally true — a stray `?newRequest=maybe` must
 * not pop a create dialog.
 */
export function parseDistributionSearch(
  search: Record<string, unknown>,
): Required<Pick<DistributionSearch, "tab" | "newRequest">> & DistributionSearch {
  const raw = search ?? {};
  const text = (key: keyof DistributionSearch): string | undefined => {
    const value = raw[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };

  return {
    tab: isDistributionTab(raw.tab) ? raw.tab : "requests",
    newRequest: raw.newRequest === true || raw.newRequest === "true",
    dealId: text("dealId"),
    customerId: text("customerId"),
    requestId: text("requestId"),
    productSkuId: text("productSkuId"),
    locationId: text("locationId"),
  };
}

export type StockRequestQueryFilters = {
  status?: StockRequestStatus | null;
  dealId?: string | null;
  customerId?: string | null;
  locationId?: string | null;
  productSkuId?: string | null;
  openOnly?: boolean;
};

/**
 * Turns the workspace's own filter state plus the URL context into the
 * structured filter object the server function takes. Deliberately a fixed
 * set of named fields — there is no free-text query here, per §4.
 */
export function buildStockRequestFilters(input: {
  search: DistributionSearch;
  statusFilter: StockRequestStatus | "all" | "open";
}): StockRequestQueryFilters {
  const filters: StockRequestQueryFilters = {
    dealId: input.search.dealId ?? null,
    customerId: input.search.customerId ?? null,
    locationId: input.search.locationId ?? null,
    productSkuId: input.search.productSkuId ?? null,
  };
  if (input.statusFilter === "open") {
    filters.openOnly = true;
  } else if (input.statusFilter !== "all") {
    filters.status = input.statusFilter;
  }
  return filters;
}

export const STOCK_REQUEST_STATUS_FILTERS = ["open", "all", ...STOCK_REQUEST_STATUSES] as const;
export type StockRequestStatusFilter = (typeof STOCK_REQUEST_STATUS_FILTERS)[number];

export const MOVEMENT_TYPE_FILTERS = ["all", ...INVENTORY_MOVEMENT_TYPES] as const;
export type MovementTypeFilter = (typeof MOVEMENT_TYPE_FILTERS)[number];

/** Deep links the rest of the app uses to reach this workspace. Kept here so
 * Deals and Customers never hand-build a URL that drifts from what
 * parseDistributionSearch actually reads. */
export function newRequestForDealUrl(dealId: string): string {
  return `/distribution?tab=requests&newRequest=true&dealId=${encodeURIComponent(dealId)}`;
}
export function newRequestForCustomerUrl(customerId: string): string {
  return `/distribution?tab=requests&newRequest=true&customerId=${encodeURIComponent(customerId)}`;
}
export function trackStockForDealUrl(dealId: string): string {
  return `/distribution?tab=requests&dealId=${encodeURIComponent(dealId)}`;
}
export function trackStockForCustomerUrl(customerId: string): string {
  return `/distribution?tab=requests&customerId=${encodeURIComponent(customerId)}`;
}
export function trackMovementsForRequestUrl(requestId: string): string {
  return `/distribution?tab=movements&requestId=${encodeURIComponent(requestId)}`;
}
