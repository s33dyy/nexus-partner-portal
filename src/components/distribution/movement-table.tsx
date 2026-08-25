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
    <div className="overflow-x-auto">
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
  );
}
