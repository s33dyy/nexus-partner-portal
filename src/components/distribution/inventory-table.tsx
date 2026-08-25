import { EmptyState } from "@/components/page-header";
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
import type { InventoryBalanceView } from "@/domain/contracts/distribution";
import { formatDateTimeLabel } from "@/lib/date-utils";

/**
 * The Stock tab: the five quantities from §24.2 for every (SKU, location)
 * pair in scope.
 *
 * Available is shown next to on hand rather than instead of it, because the
 * two answer different questions — "what is on the shelf" and "what can I
 * promise" — and a warehouse that reads 10 on hand but 0 available is the
 * single most common thing an operator needs explained.
 */
export function InventoryTable({
  rows,
  loading,
  onTrack,
}: {
  rows: InventoryBalanceView[];
  loading: boolean;
  onTrack: (row: InventoryBalanceView) => void;
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
        title="No stock on record"
        description="Nothing has been counted into a location you can see yet."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Product</TableHead>
            <TableHead>SKU</TableHead>
            <TableHead>Location</TableHead>
            <TableHead className="text-right">On hand</TableHead>
            <TableHead className="text-right">Reserved</TableHead>
            <TableHead className="text-right">Available</TableHead>
            <TableHead className="text-right">In transit</TableHead>
            <TableHead className="text-right">Damaged</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.productSkuId}:${row.locationId}`}>
              <TableCell className="text-[13px] font-medium">{row.productName}</TableCell>
              <TableCell className="font-mono text-[12px]">{row.skuCode}</TableCell>
              <TableCell className="text-[13px]">
                {row.locationName}
                <Badge tone="neutral" className="ml-2 text-[10px]">
                  {row.locationType === "distributor" ? "Distributor" : "Warehouse"}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.onHandQuantity}</TableCell>
              <TableCell className="text-right tabular-nums">{row.reservedQuantity}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {row.availableQuantity}
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.inTransitQuantity}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.damagedQuantity > 0 ? (
                  <span className="text-destructive">{row.damagedQuantity}</span>
                ) : (
                  0
                )}
              </TableCell>
              <TableCell className="text-[13px] text-muted-foreground">
                {formatDateTimeLabel(row.updatedAt)}
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="ghost" onClick={() => onTrack(row)}>
                  Track stock
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
