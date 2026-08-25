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
    // Wide tables scroll inside their own container so the page body never
    // scrolls sideways on a phone.
    <div className="overflow-x-auto">
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
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {PRIMARY_ACTIONS.filter((action) => hasAction(row.allowedActions, action)).map(
                      (action) => (
                        <Button
                          key={action}
                          size="sm"
                          variant={action === "resolve_exception" ? "default" : "secondary"}
                          disabled={busy}
                          onClick={() => onAction(row, action)}
                        >
                          {ACTION_LABEL[action]}
                        </Button>
                      ),
                    )}
                    {(["cancel", "report_exception"] as StockRequestAction[])
                      .filter((action) => hasAction(row.allowedActions, action))
                      .map((action) => (
                        <Fragment key={action}>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => onAction(row, action)}
                          >
                            {ACTION_LABEL[action]}
                          </Button>
                        </Fragment>
                      ))}
                    <Button size="sm" variant="ghost" onClick={() => onOpen(row)}>
                      Track stock
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
