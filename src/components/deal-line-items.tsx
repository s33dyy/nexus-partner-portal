import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Trash2 } from "lucide-react";
import { removeDealLineItem, freezePricingRevision } from "@/integrations/local/pricing-commands";
import { toast } from "sonner";
import { formatMoney } from "@/lib/money";
import { supabase } from "@/integrations/local/client";

type LineItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  msrp_usd: string;
  dtp_usd: string;
};

export function DealLineItems({ dealId, dealStage }: { dealId: string; dealStage: string }) {
  const [items, setItems] = useState<LineItemRow[]>([]);
  const [loading, setLoading] = useState(false);

  const canEdit = ["sourced", "demo", "testing", "qualified", "proposal"].includes(dealStage);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("deal_line_items")
        .select("id, product_id, quantity, msrp_usd, dtp_usd")
        .eq("deal_id", dealId);
      if (error) throw error;
      setItems((data as LineItemRow[] | null) ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRemove = async (lineItemId: string) => {
    setLoading(true);
    try {
      const res = await removeDealLineItem({ dealId, lineItemId });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success("Removed line item");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove line item");
      setLoading(false);
    }
  };

  const handleFreeze = async () => {
    setLoading(true);
    try {
      const res = await freezePricingRevision({ dealId });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success("Pricing revision frozen");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to freeze pricing revision");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Line Items & Pricing</h3>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {canEdit && items.length > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleFreeze()}
              disabled={loading}
            >
              Freeze Pricing
            </Button>
          )}
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>MSRP</TableHead>
              <TableHead>DTP</TableHead>
              {canEdit && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                  No line items yet.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.product_id}</TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>{formatMoney(item.msrp_usd, "USD")}</TableCell>
                  <TableCell>{formatMoney(item.dtp_usd, "USD")}</TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500"
                        onClick={() => void handleRemove(item.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
