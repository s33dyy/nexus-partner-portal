import { ArrowRight } from "lucide-react";

import { EmptyState } from "@/components/page-header";
import { movementTypeLabel, movementTypeTone } from "@/components/distribution/distribution-view";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InventoryMovementView } from "@/domain/contracts/distribution";
import { formatDateTimeLabel } from "@/lib/date-utils";

/**
 * The Movements tab: the append-only ledger (§24.2), newest first.
 *
 * Read-only by construction — there is no edit or delete affordance because
 * there is no edit or delete command. A mistake is corrected by posting a
 * compensating movement, which shows up here as its own row.
 */
export function MovementTable({
  rows,
  loading,
  emptyDescription,
}: {
  rows: InventoryMovementView[];
  loading: boolean;
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
        title="No stock movements"
        description={emptyDescription ?? "Nothing has moved in or out of a location you can see."}
      />
    );
  }

  return (
    <>
      {/* Cards below lg, the ledger table above it.
          product.md section 4.3 asks that data tables have a mobile card or
          detail-sheet alternative, and nine columns is 1012px — readable only
          by dragging the row sideways, which loses the When/Type anchor
          columns exactly when you need them. Same rows, same order, no extra
          query: the two branches render the identical `rows` array. */}
      <div className="divide-y lg:hidden">
        {rows.map((row) => (
          <article key={row.id} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <Badge tone={movementTypeTone(row.movementType)}>
                {movementTypeLabel(row.movementType)}
              </Badge>
              <span className="shrink-0 text-base font-medium tabular-nums">{row.quantity}</span>
            </div>

            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-mono text-[12px]">{row.skuCode}</span>
              <span className="text-[12px] text-muted-foreground">
                {formatDateTimeLabel(row.occurredAt)}
              </span>
            </div>

            {/* The endpoints are the point of a movement, so they get their own
                line rather than being squeezed onto the SKU row. */}
            <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
              <span>{row.sourceLocationName ?? "—"}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>{row.destinationLocationName ?? "—"}</span>
            </div>

            {/* Provenance is secondary — shown only when there is something to
                show, so an unremarkable row stays two lines tall. */}
            {(row.requestHumanId || row.actorName || row.reason) && (
              <dl className="space-y-0.5 text-[12px] text-muted-foreground">
                {row.requestHumanId && (
                  <div className="flex gap-1.5">
                    <dt>Request</dt>
                    <dd className="font-mono">{row.requestHumanId}</dd>
                  </div>
                )}
                {row.actorName && (
                  <div className="flex gap-1.5">
                    <dt>Actor</dt>
                    <dd>{row.actorName}</dd>
                  </div>
                )}
                {row.reason && <p className="pt-0.5">{row.reason}</p>}
              </dl>
            )}
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Request</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-[13px] text-muted-foreground">
                  {formatDateTimeLabel(row.occurredAt)}
                </TableCell>
                <TableCell>
                  <Badge tone={movementTypeTone(row.movementType)}>
                    {movementTypeLabel(row.movementType)}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-[12px]">{row.skuCode}</TableCell>
                <TableCell className="text-[13px]">{row.sourceLocationName ?? "—"}</TableCell>
                <TableCell className="text-[13px]">{row.destinationLocationName ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{row.quantity}</TableCell>
                <TableCell className="font-mono text-[12px]">{row.requestHumanId ?? "—"}</TableCell>
                <TableCell className="text-[13px]">{row.actorName ?? "—"}</TableCell>
                <TableCell className="max-w-[220px] truncate text-[13px] text-muted-foreground">
                  {row.reason ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
