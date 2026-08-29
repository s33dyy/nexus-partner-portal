import { Fragment } from "react";

import { EmptyState } from "@/components/page-header";
import {
  hasAction,
  requestProgressLabel,
  requestProgressPercent,
  stockRequestStatusLabel,
  stockRequestStatusTone,
} from "@/components/distribution/distribution-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { StockRequestAction } from "@/domain/contracts/distribution";
import type { StockRequestListRow } from "@/server/distribution-queries.server";
import { formatDateLabel, formatDateTimeLabel } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

/**
 * The Requests tab.
 *
 * Actions come from each row's server-supplied `allowedActions`. Nothing here
 * consults a role, and the server re-checks the same authority when the
 * command runs — so a row that renders no buttons is not a UI decision about
 * seniority, it is what this actor may actually do to this record right now.
 */
const ACTION_LABEL: Record<StockRequestAction, string> = {
  review: "Review",
  allocate: "Allocate",
  dispatch: "Dispatch",
  receive: "Confirm receipt",
  cancel: "Cancel",
  report_exception: "Report problem",
  resolve_exception: "Resolve",
};

const PRIMARY_ACTIONS: StockRequestAction[] = [
  "review",
  "allocate",
  "dispatch",
  "receive",
  "resolve_exception",
];

/**
 * The row's action set, rendered identically by the card and table layouts.
 *
 * Shared rather than duplicated on purpose: which buttons appear is a
 * statement about this actor's authority over this record, so the two layouts
 * must never be able to drift into offering different things.
 */
function RequestActions({
  row,
  busy,
  onAction,
  onOpen,
  className,
}: {
  row: StockRequestListRow;
  busy: boolean;
  onAction: (row: StockRequestListRow, action: StockRequestAction) => void;
  onOpen: (row: StockRequestListRow) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {PRIMARY_ACTIONS.filter((action) => hasAction(row.allowedActions, action)).map((action) => (
        <Button
          key={action}
          size="sm"
          variant={action === "resolve_exception" ? "default" : "secondary"}
          disabled={busy}
          onClick={() => onAction(row, action)}
        >
          {ACTION_LABEL[action]}
        </Button>
      ))}
      {(["cancel", "report_exception"] as StockRequestAction[])
        .filter((action) => hasAction(row.allowedActions, action))
        .map((action) => (
          <Fragment key={action}>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction(row, action)}>
              {ACTION_LABEL[action]}
            </Button>
          </Fragment>
        ))}
      <Button size="sm" variant="ghost" onClick={() => onOpen(row)}>
        Track stock
      </Button>
    </div>
  );
}

export function StockRequestTable({
  rows,
  loading,
  onOpen,
  onAction,
  busyRequestId,
  emptyDescription,
}: {
  rows: StockRequestListRow[];
  loading: boolean;
  onOpen: (row: StockRequestListRow) => void;
  onAction: (row: StockRequestListRow, action: StockRequestAction) => void;
  busyRequestId: string | null;
  emptyDescription?: string;
}) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No stock requests"
        description={emptyDescription ?? "Nothing matches the current filters."}
      />
    );
  }

  return (
    <>
      {/* Cards below lg, the ten-column table above it (product.md 4.3: data
          tables need a mobile card or detail-sheet alternative). Sideways
          dragging is a poor way to read a queue you are meant to act on — and
          the actions were the column furthest off-screen. */}
      <div className="divide-y lg:hidden">
        {rows.map((row) => {
          const percent = requestProgressPercent(row);
          const busy = busyRequestId === row.id;
          return (
            <article key={row.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onOpen(row)}
                  // The card's own open affordance, so it carries the 44px
                  // touch height the table row does not need.
                  className="-my-2 inline-flex min-h-11 items-center font-mono text-[13px] font-medium underline-offset-2 hover:underline"
                >
                  {row.humanId}
                </button>
                <Badge tone={stockRequestStatusTone(row.status)} className="shrink-0">
                  {stockRequestStatusLabel(row.status)}
                </Badge>
              </div>

              <div className="flex items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"
                  role="presentation"
                >
                  <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
                </div>
                <span className="shrink-0 text-[12px] text-muted-foreground">
                  {requestProgressLabel(row)}
                </span>
              </div>

              {/* A definition list, so each value keeps the label that gave it
                  meaning — the thing a stripped-down card usually loses. */}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Distributor
                  </dt>
                  <dd>{row.requesterName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Manager
                  </dt>
                  <dd>{row.managerName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Needed by
                  </dt>
                  <dd>{formatDateLabel(row.requiredBy)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Lines
                  </dt>
                  <dd>
                    {row.lineCount} line{row.lineCount === 1 ? "" : "s"} · {row.requestedTotal} unit
                    {row.requestedTotal === 1 ? "" : "s"}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Next owner
                  </dt>
                  <dd>{row.nextOwnerLabel ?? "—"}</dd>
                </div>
              </dl>

              <RequestActions row={row} busy={busy} onAction={onAction} onOpen={onOpen} />

              <p className="text-[12px] text-muted-foreground">
                Updated {formatDateTimeLabel(row.updatedAt)}
              </p>
            </article>
          );
        })}
      </div>

      {/* Wide tables scroll inside their own container so the page body never
          scrolls sideways. */}
      <div className="hidden overflow-x-auto lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Request</TableHead>
              <TableHead>Distributor</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead>Needed by</TableHead>
              <TableHead>Lines</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Next owner</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const percent = requestProgressPercent(row);
              const busy = busyRequestId === row.id;
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => onOpen(row)}
                      className="font-mono text-[12px] font-medium underline-offset-2 hover:underline"
                    >
                      {row.humanId}
                    </button>
                  </TableCell>
                  <TableCell className="text-[13px]">{row.requesterName ?? "—"}</TableCell>
                  <TableCell className="text-[13px]">{row.managerName ?? "—"}</TableCell>
                  <TableCell className="text-[13px]">{formatDateLabel(row.requiredBy)}</TableCell>
                  <TableCell className="text-[13px]">
                    {row.lineCount} line{row.lineCount === 1 ? "" : "s"} · {row.requestedTotal} unit
                    {row.requestedTotal === 1 ? "" : "s"}
                  </TableCell>
                  <TableCell className="min-w-[140px]">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-secondary"
                        role="presentation"
                      >
                        <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
                      </div>
                      <span className="text-[12px] text-muted-foreground">
                        {requestProgressLabel(row)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge tone={stockRequestStatusTone(row.status)}>
                      {stockRequestStatusLabel(row.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {row.nextOwnerLabel ?? "—"}
                  </TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {formatDateTimeLabel(row.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <RequestActions
                      row={row}
                      busy={busy}
                      onAction={onAction}
                      onOpen={onOpen}
                      className="justify-end"
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
