import { useEffect, useMemo, useState } from "react";

import { MovementTable } from "@/components/distribution/movement-table";
import {
  hasAction,
  stockRequestStatusLabel,
  stockRequestStatusTone,
} from "@/components/distribution/distribution-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type {
  InventoryMovementView,
  StockLocationView,
  StockRequestAction,
  StockRequestView,
} from "@/domain/contracts/distribution";
import { formatDateLabel } from "@/lib/date-utils";

/**
 * Track Stock: one request's lines, its movement history, and whichever
 * action this actor may take on it.
 *
 * The action forms live here rather than in the route so Deals and Customers
 * can deep-link straight to a request without any of them owning stock form
 * state. Which action is offered comes from the server's `allowedActions`;
 * this file never inspects a role.
 */
export type ReviewLineDraft = {
  lineId: string;
  approvedQuantity: string;
  sourceLocationId: string;
};

export type QuantityDraft = { lineId: string; quantity: string };

export type TrackingAction = StockRequestAction | null;

const ACTION_TITLE: Record<StockRequestAction, string> = {
  review: "Review this request",
  allocate: "Allocate stock",
  dispatch: "Dispatch stock",
  receive: "Confirm what arrived",
  cancel: "Withdraw this request",
  report_exception: "Report a problem",
  resolve_exception: "Resolve the problem",
};

export function StockTrackingPanel({
  open,
  onOpenChange,
  request,
  movements,
  sourceLocations,
  loading,
  busy,
  action,
  onActionChange,
  onReview,
  onAllocate,
  onDispatch,
  onReceive,
  onCancel,
  onReportException,
  onResolveException,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: StockRequestView | null;
  movements: InventoryMovementView[];
  sourceLocations: StockLocationView[];
  loading: boolean;
  busy: boolean;
  action: TrackingAction;
  onActionChange: (action: TrackingAction) => void;
  onReview: (decision: "approve" | "reject", reason: string, lines: ReviewLineDraft[]) => void;
  onAllocate: (lines: QuantityDraft[]) => void;
  onDispatch: (lines: QuantityDraft[]) => void;
  onReceive: (lines: QuantityDraft[]) => void;
  onCancel: (reason: string) => void;
  onReportException: (reason: string) => void;
  onResolveException: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [reviewLines, setReviewLines] = useState<ReviewLineDraft[]>([]);
  const [quantityLines, setQuantityLines] = useState<QuantityDraft[]>([]);

  useEffect(() => {
    if (!request) return;
    setReason("");
    setReviewLines(
      request.lines.map((line) => ({
        lineId: line.lineId,
        approvedQuantity: String(line.requestedQuantity),
        sourceLocationId: line.sourceLocationId ?? "",
      })),
    );
    setQuantityLines(request.lines.map((line) => ({ lineId: line.lineId, quantity: "" })));
  }, [request, action]);

  const warehouses = useMemo(
    () => sourceLocations.filter((location) => location.locationType === "livey_warehouse"),
    [sourceLocations],
  );

  const availableActions = useMemo(() => {
    if (!request) return [] as StockRequestAction[];
    return (
      [
        "review",
        "allocate",
        "dispatch",
        "receive",
        "resolve_exception",
        "report_exception",
        "cancel",
      ] as StockRequestAction[]
    ).filter((candidate) => hasAction(request.allowedActions, candidate));
  }, [request]);

  const quantityDrafts = () =>
    quantityLines
      .filter((line) => line.quantity.trim() !== "")
      .map((line) => ({ lineId: line.lineId, quantity: Number(line.quantity) }))
      .filter((line) => Number.isSafeInteger(line.quantity) && line.quantity > 0)
      .map((line) => ({ lineId: line.lineId, quantity: String(line.quantity) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{request?.humanId ?? "Stock request"}</span>
            {request ? (
              <Badge tone={stockRequestStatusTone(request.status)}>
                {stockRequestStatusLabel(request.status)}
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {request
              ? `Needed by ${formatDateLabel(request.requiredBy)} · ${request.destinationLocationName}`
              : "Loading the request…"}
          </DialogDescription>
        </DialogHeader>

        {loading || !request ? (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-md border bg-secondary/40 p-3 text-[13px]">
              <div className="font-medium">Why it was requested</div>
              <p className="mt-1 text-muted-foreground">{request.reason}</p>
              {request.decisionReason ? (
                <>
                  <div className="mt-2 font-medium">Manager&apos;s decision</div>
                  <p className="mt-1 text-muted-foreground">{request.decisionReason}</p>
                </>
              ) : null}
              {request.exceptionReason ? (
                <>
                  <div className="mt-2 font-medium text-destructive">Reported problem</div>
                  <p className="mt-1 text-muted-foreground">{request.exceptionReason}</p>
                </>
              ) : null}
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Requested</TableHead>
                    <TableHead className="text-right">Approved</TableHead>
                    <TableHead className="text-right">Reserved</TableHead>
                    <TableHead className="text-right">Dispatched</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {request.lines.map((line) => (
                    <TableRow key={line.lineId}>
                      <TableCell className="text-[13px]">
                        {line.productName}
                        <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                          {line.skuCode}
                        </span>
                      </TableCell>
                      <TableCell className="text-[13px]">
                        {line.sourceLocationName ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.requestedQuantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.approvedQuantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.reservedQuantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.dispatchedQuantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {line.receivedQuantity}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {availableActions.length > 0 ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex flex-wrap gap-1.5">
                  {availableActions.map((candidate) => (
                    <Button
                      key={candidate}
                      size="sm"
                      variant={action === candidate ? "default" : "secondary"}
                      onClick={() => onActionChange(action === candidate ? null : candidate)}
                    >
                      {ACTION_TITLE[candidate]}
                    </Button>
                  ))}
                </div>

                {action === "review" ? (
                  <div className="space-y-3">
                    {request.lines.map((line, index) => (
                      <div key={line.lineId} className="flex flex-wrap items-end gap-2">
                        <div className="min-w-[140px] flex-1 text-[13px]">
                          {line.productName}
                          <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                            {line.skuCode}
                          </span>
                        </div>
                        <div>
                          <Label className="text-xs" htmlFor={`approve-${line.lineId}`}>
                            Approve
                          </Label>
                          <Input
                            id={`approve-${line.lineId}`}
                            className="w-24"
                            type="number"
                            min={0}
                            max={line.requestedQuantity}
                            value={reviewLines[index]?.approvedQuantity ?? ""}
                            onChange={(event) =>
                              setReviewLines((current) =>
                                current.map((draft, position) =>
                                  position === index
                                    ? { ...draft, approvedQuantity: event.target.value }
                                    : draft,
                                ),
                              )
                            }
                          />
                        </div>
                        <div className="min-w-[180px]">
                          <Label className="text-xs">Source</Label>
                          <Select
                            value={reviewLines[index]?.sourceLocationId ?? ""}
                            onValueChange={(value) =>
                              setReviewLines((current) =>
                                current.map((draft, position) =>
                                  position === index
                                    ? { ...draft, sourceLocationId: value }
                                    : draft,
                                ),
                              )
                            }
                          >
                            <SelectTrigger aria-label={`Source location for ${line.skuCode}`}>
                              <SelectValue placeholder="Choose a warehouse" />
                            </SelectTrigger>
                            <SelectContent>
                              {warehouses.map((location) => (
                                <SelectItem key={location.id} value={location.id}>
                                  {location.locationName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                    <Textarea
                      rows={2}
                      placeholder="Reason for this decision"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={busy || !reason.trim()}
                        onClick={() => onReview("approve", reason, reviewLines)}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={busy || !reason.trim()}
                        onClick={() => onReview("reject", reason, reviewLines)}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ) : null}

                {action === "allocate" || action === "dispatch" || action === "receive" ? (
                  <div className="space-y-3">
                    <p className="text-[13px] text-muted-foreground">
                      {action === "allocate"
                        ? "Leave the quantities blank to reserve everything available."
                        : action === "dispatch"
                          ? "Leave the quantities blank to dispatch everything reserved."
                          : "Leave the quantities blank to confirm everything that was dispatched."}
                    </p>
                    {request.lines.map((line, index) => (
                      <div key={line.lineId} className="flex flex-wrap items-end gap-2">
                        <div className="min-w-[140px] flex-1 text-[13px]">
                          {line.productName}
                          <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                            {line.skuCode}
                          </span>
                        </div>
                        <Input
                          className="w-28"
                          type="number"
                          min={0}
                          placeholder="All"
                          aria-label={`Quantity for ${line.skuCode}`}
                          value={quantityLines[index]?.quantity ?? ""}
                          onChange={(event) =>
                            setQuantityLines((current) =>
                              current.map((draft, position) =>
                                position === index
                                  ? { ...draft, quantity: event.target.value }
                                  : draft,
                              ),
                            )
                          }
                        />
                      </div>
                    ))}
                    <Button
                      disabled={busy}
                      onClick={() => {
                        const drafts = quantityDrafts();
                        if (action === "allocate") onAllocate(drafts);
                        else if (action === "dispatch") onDispatch(drafts);
                        else onReceive(drafts);
                      }}
                    >
                      {ACTION_TITLE[action]}
                    </Button>
                  </div>
                ) : null}

                {action === "cancel" ||
                action === "report_exception" ||
                action === "resolve_exception" ? (
                  <div className="space-y-3">
                    <Textarea
                      rows={2}
                      placeholder={
                        action === "cancel"
                          ? "Why are you withdrawing this request?"
                          : action === "report_exception"
                            ? "What went wrong?"
                            : "How was it resolved?"
                      }
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                    <Button
                      variant={action === "cancel" ? "destructive" : "default"}
                      disabled={busy || !reason.trim()}
                      onClick={() => {
                        if (action === "cancel") onCancel(reason);
                        else if (action === "report_exception") onReportException(reason);
                        else onResolveException(reason);
                      }}
                    >
                      {ACTION_TITLE[action]}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Stock movements
              </div>
              <div className="rounded-md border">
                <MovementTable
                  rows={movements}
                  loading={false}
                  emptyDescription="No stock has moved for this request yet."
                />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
