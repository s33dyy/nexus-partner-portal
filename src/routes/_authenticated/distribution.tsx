import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Plus, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { InventoryTable } from "@/components/distribution/inventory-table";
import { MovementTable } from "@/components/distribution/movement-table";
import { StockRequestDialog } from "@/components/distribution/stock-request-dialog";
import { StockRequestTable } from "@/components/distribution/stock-request-table";
import {
  StockTrackingPanel,
  type QuantityDraft,
  type ReviewLineDraft,
  type TrackingAction,
} from "@/components/distribution/stock-tracking-panel";
import {
  DISTRIBUTION_TABS,
  MOVEMENT_TYPE_FILTERS,
  STOCK_REQUEST_STATUS_FILTERS,
  buildStockRequestFilters,
  movementTypeLabel,
  parseDistributionSearch,
  stockRequestStatusLabel,
  type DistributionTab,
  type MovementTypeFilter,
  type StockRequestStatusFilter,
} from "@/components/distribution/distribution-view";
import { EmptyState, PageHeader, Toolbar } from "@/components/page-header";
import { AccessDeniedPage, FeatureUnavailablePage } from "@/components/route-placeholder";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  DistributionExceptionView,
  InventoryBalanceView,
  InventoryMovementView,
  RequestableProductSkuView,
  StockLocationView,
  StockRequestAction,
  StockRequestView,
  SubmitStockRequestInput,
} from "@/domain/contracts/distribution";
import { useAuth } from "@/hooks/use-auth";
import {
  allocateStockRequest,
  cancelStockRequest,
  dispatchStockRequest,
  getStockRequest,
  listDistributionExceptions,
  listInventoryBalances,
  listInventoryMovements,
  listRequestableProductSkus,
  listStockLocations,
  listStockRequests,
  receiveStockRequest,
  reportStockRequestException,
  resolveStockRequestException,
  reviewStockRequest,
  submitStockRequest,
} from "@/integrations/local/distribution";
import type { StockRequestListRow } from "@/server/distribution-queries.server";

const distributionSearchSchema = z.object({
  tab: z.enum(DISTRIBUTION_TABS).optional(),
  newRequest: z.boolean().optional(),
  dealId: z.string().optional(),
  customerId: z.string().optional(),
  requestId: z.string().optional(),
  productSkuId: z.string().optional(),
  locationId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/distribution")({
  validateSearch: distributionSearchSchema,
  component: DistributionPage,
});

type CommandResult = Awaited<ReturnType<typeof submitStockRequest>>;

/** One place that turns a command result into user-facing feedback, so a
 * policy denial reads as "Access denied" and a validation failure reads as
 * the field message the server wrote — never a raw error object. */
function reportCommand(result: CommandResult, successMessage: string): boolean {
  if (result.ok) {
    toast.success(successMessage);
    return true;
  }
  const failure = result.failure;
  const message =
    failure.code === "VALIDATION_FAILED"
      ? (failure.fieldErrors[0]?.message ?? failure.message)
      : failure.code === "OPTIMISTIC_CONFLICT"
        ? "Someone else changed this request. Reload and try again."
        : failure.message;
  toast.error(message);
  return false;
}

function DistributionPage() {
  const navigate = useNavigate();
  const rawSearch = useSearch({ from: "/_authenticated/distribution" });
  const search = useMemo(
    () => parseDistributionSearch(rawSearch as Record<string, unknown>),
    [rawSearch],
  );
  const { can, surfaces } = useAuth();

  const enabled = surfaces.distributionCore;
  const canRead = can("distribution", "read");

  const [requests, setRequests] = useState<StockRequestListRow[]>([]);
  const [balances, setBalances] = useState<InventoryBalanceView[]>([]);
  const [movements, setMovements] = useState<InventoryMovementView[]>([]);
  const [exceptions, setExceptions] = useState<DistributionExceptionView[]>([]);
  const [skus, setSkus] = useState<RequestableProductSkuView[]>([]);
  const [destinations, setDestinations] = useState<StockLocationView[]>([]);
  const [sourceLocations, setSourceLocations] = useState<StockLocationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StockRequestStatusFilter>("open");
  const [movementFilter, setMovementFilter] = useState<MovementTypeFilter>("all");
  const [createOpen, setCreateOpen] = useState(search.newRequest);
  const [trackedRequest, setTrackedRequest] = useState<StockRequestView | null>(null);
  const [trackedMovements, setTrackedMovements] = useState<InventoryMovementView[]>([]);
  const [trackingAction, setTrackingAction] = useState<TrackingAction>(null);
  const [trackingOpen, setTrackingOpen] = useState(false);

  const setTab = (tab: DistributionTab) => {
    void navigate({ to: "/distribution", search: { ...rawSearch, tab } });
  };

  const load = useCallback(async () => {
    // Nothing is fetched while the surface is off or the actor lacks read —
    // a hidden page must be hidden in the network tab too.
    if (!enabled || !canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [
        requestResult,
        balanceResult,
        movementResult,
        exceptionResult,
        skuResult,
        destinationResult,
        locationResult,
      ] = await Promise.all([
        listStockRequests(buildStockRequestFilters({ search, statusFilter })),
        listInventoryBalances({
          locationId: search.locationId ?? null,
          productSkuId: search.productSkuId ?? null,
        }),
        listInventoryMovements({
          requestId: search.requestId ?? null,
          productSkuId: search.productSkuId ?? null,
          locationId: search.locationId ?? null,
          movementType: movementFilter === "all" ? null : movementFilter,
        }),
        listDistributionExceptions({}),
        listRequestableProductSkus(null),
        listStockLocations({ destinationsOnly: true }),
        listStockLocations({}),
      ]);

      setRequests(requestResult.ok ? requestResult.rows : []);
      setBalances(balanceResult.ok ? balanceResult.rows : []);
      setMovements(movementResult.ok ? movementResult.rows : []);
      setExceptions(exceptionResult.ok ? exceptionResult.rows : []);
      setSkus(skuResult.ok ? skuResult.rows : []);
      setDestinations(destinationResult.ok ? destinationResult.rows : []);
      setSourceLocations(locationResult.ok ? locationResult.rows : []);
    } catch (error) {
      console.error("Failed to load distribution data", error);
      toast.error("Could not load distribution data");
    } finally {
      setLoading(false);
    }
  }, [enabled, canRead, search, statusFilter, movementFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openTracking = useCallback(async (requestId: string) => {
    setTrackingOpen(true);
    setTrackingAction(null);
    setTrackedRequest(null);
    const [detail, history] = await Promise.all([
      getStockRequest(requestId),
      listInventoryMovements({ requestId }),
    ]);
    setTrackedRequest(detail.ok ? detail.request : null);
    setTrackedMovements(history.ok ? history.rows : []);
    if (!detail.ok) toast.error("That request is not accessible");
  }, []);

  // A deep link that names a request opens it directly, so a Notification's
  // action URL lands on the record rather than on a table to search through.
  useEffect(() => {
    if (search.requestId && search.tab === "requests") {
      void openTracking(search.requestId);
    }
  }, [search.requestId, search.tab, openTracking]);

  const runCommand = async (
    run: () => Promise<CommandResult>,
    successMessage: string,
  ): Promise<void> => {
    setBusy(true);
    try {
      const result = await run();
      if (reportCommand(result, successMessage)) {
        setTrackingAction(null);
        await load();
        if (trackedRequest) await openTracking(trackedRequest.id);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRowAction = async (row: StockRequestListRow, action: StockRequestAction) => {
    await openTracking(row.id);
    setTrackingAction(action);
  };

  if (!enabled) {
    return (
      <FeatureUnavailablePage
        title="Distribution"
        description="Stock requests and inventory are not enabled in this workspace."
      />
    );
  }

  if (!canRead) {
    return (
      <AccessDeniedPage
        title="Distribution"
        roleLabel="Distributor, Regional Manager, Partner Account Manager, or Super Admin"
      />
    );
  }

  const contextLabel = search.dealId
    ? "Filtered to one deal"
    : search.customerId
      ? "Filtered to one customer"
      : null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Distribution"
        icon={<Boxes className="h-3.5 w-3.5" />}
        title="Stock requests and inventory"
        description="Request product, track what is reserved and in transit, and confirm what arrives."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
            {destinations.length > 0 ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Request stock
              </Button>
            ) : null}
          </>
        }
      />

      <Tabs value={search.tab} onValueChange={(value) => setTab(value as DistributionTab)}>
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="stock">Stock</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
          <TabsTrigger value="exceptions">
            Exceptions{exceptions.length > 0 ? ` (${exceptions.length})` : ""}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {contextLabel ? (
        <Toolbar>
          <span className="text-[13px] text-muted-foreground">{contextLabel}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void navigate({ to: "/distribution", search: { tab: search.tab } })}
          >
            Clear
          </Button>
        </Toolbar>
      ) : null}

      {search.tab === "requests" ? (
        <Card>
          <div className="border-b p-3">
            <Toolbar>
              <Select
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value as StockRequestStatusFilter)}
              >
                <SelectTrigger className="w-52" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STOCK_REQUEST_STATUS_FILTERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value === "open"
                        ? "Open requests"
                        : value === "all"
                          ? "All requests"
                          : stockRequestStatusLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Toolbar>
          </div>
          <StockRequestTable
            rows={requests}
            loading={loading}
            busyRequestId={busy && trackedRequest ? trackedRequest.id : null}
            onOpen={(row) => void openTracking(row.id)}
            onAction={(row, action) => void handleRowAction(row, action)}
          />
        </Card>
      ) : null}

      {search.tab === "stock" ? (
        <Card>
          <InventoryTable
            rows={balances}
            loading={loading}
            onTrack={(row) =>
              void navigate({
                to: "/distribution",
                search: {
                  tab: "movements",
                  productSkuId: row.productSkuId,
                  locationId: row.locationId,
                },
              })
            }
          />
        </Card>
      ) : null}

      {search.tab === "movements" ? (
        <Card>
          <div className="border-b p-3">
            <Toolbar>
              <Select
                value={movementFilter}
                onValueChange={(value) => setMovementFilter(value as MovementTypeFilter)}
              >
                <SelectTrigger className="w-52" aria-label="Filter by movement type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOVEMENT_TYPE_FILTERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value === "all" ? "All movement types" : movementTypeLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Toolbar>
          </div>
          <MovementTable rows={movements} loading={loading} />
        </Card>
      ) : null}

      {search.tab === "exceptions" ? (
        <Card>
          {exceptions.length === 0 ? (
            <EmptyState
              title="Nothing needs recovering"
              description="No stock request in your scope is in an exception state."
            />
          ) : (
            <div className="divide-y">
              {exceptions.map((row) => (
                <div
                  key={row.requestId}
                  className="flex flex-wrap items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-[12px] font-medium">{row.humanId}</div>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{row.problem}</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      {row.currentOwnerLabel ?? "Unassigned"} · open {row.ageHours}h ·{" "}
                      {row.nextAction}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void openTracking(row.requestId)}
                  >
                    Open
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      <StockRequestDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        skus={skus}
        destinations={destinations}
        dealId={search.dealId}
        customerId={search.customerId}
        busy={busy}
        onSubmit={async (input: SubmitStockRequestInput) => {
          setBusy(true);
          try {
            const result = await submitStockRequest(input);
            if (reportCommand(result, "Stock request submitted")) {
              setCreateOpen(false);
              await load();
            }
          } finally {
            setBusy(false);
          }
        }}
      />

      <StockTrackingPanel
        open={trackingOpen}
        onOpenChange={(open) => {
          setTrackingOpen(open);
          if (!open) setTrackingAction(null);
        }}
        request={trackedRequest}
        movements={trackedMovements}
        sourceLocations={sourceLocations}
        loading={trackingOpen && !trackedRequest}
        busy={busy}
        action={trackingAction}
        onActionChange={setTrackingAction}
        onReview={(decision, reason, lines: ReviewLineDraft[]) => {
          if (!trackedRequest) return;
          void runCommand(
            () =>
              reviewStockRequest({
                requestId: trackedRequest.id,
                expectedVersion: trackedRequest.version,
                decision,
                reason,
                lines: lines.map((line) => ({
                  lineId: line.lineId,
                  approvedQuantity: Number(line.approvedQuantity || 0),
                  sourceLocationId: line.sourceLocationId || null,
                })),
              }),
            decision === "approve" ? "Request approved" : "Request rejected",
          );
        }}
        onAllocate={(lines: QuantityDraft[]) => {
          if (!trackedRequest) return;
          void runCommand(
            () =>
              allocateStockRequest({
                requestId: trackedRequest.id,
                expectedVersion: trackedRequest.version,
                lines: lines.map((line) => ({
                  lineId: line.lineId,
                  quantity: Number(line.quantity),
                })),
                idempotencyKey: `allocate:${trackedRequest.id}:${trackedRequest.version}`,
              }),
            "Stock allocated",
          );
        }}
        onDispatch={(lines: QuantityDraft[]) => {
          if (!trackedRequest) return;
          void runCommand(
            () =>
              dispatchStockRequest({
                requestId: trackedRequest.id,
                expectedVersion: trackedRequest.version,
                lines: lines.map((line) => ({
                  lineId: line.lineId,
                  quantity: Number(line.quantity),
                })),
                idempotencyKey: `dispatch:${trackedRequest.id}:${trackedRequest.version}`,
              }),
            "Stock dispatched",
          );
        }}
        onReceive={(lines: QuantityDraft[]) => {
          if (!trackedRequest) return;
          void runCommand(
            () =>
              receiveStockRequest({
                requestId: trackedRequest.id,
                expectedVersion: trackedRequest.version,
                lines: lines.map((line) => ({
                  lineId: line.lineId,
                  quantity: Number(line.quantity),
                })),
                idempotencyKey: `receive:${trackedRequest.id}:${trackedRequest.version}`,
              }),
            "Receipt confirmed",
          );
        }}
        onCancel={(reason) => {
          if (!trackedRequest) return;
          void runCommand(
            () =>
              cancelStockRequest({
                requestId: trackedRequest.id,
                expectedVersion: trackedRequest.version,
                reason,
              }),
            "Request withdrawn",
          );
        }}
        onReportException={(reason) => {
          if (!trackedRequest) return;
          void runCommand(
            () =>
              reportStockRequestException({
                requestId: trackedRequest.id,
                expectedVersion: trackedRequest.version,
                reason,
              }),
            "Problem reported",
          );
        }}
        onResolveException={(reason) => {
          if (!trackedRequest) return;
          void runCommand(
            () =>
              resolveStockRequestException({
                requestId: trackedRequest.id,
                expectedVersion: trackedRequest.version,
                reason,
              }),
            "Exception resolved",
          );
        }}
      />
    </div>
  );
}
