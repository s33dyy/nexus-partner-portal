import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { addDealLineItem, updateDealLineItem, removeDealLineItem, freezePricingRevision } from "@/integrations/local/pricing-commands";
import { toast } from "sonner";
import { formatMoney } from "@/lib/money";

export function DealLineItems({ dealId, dealStage }: { dealId: string, dealStage: string }) {
  const [items, setItems] = useState<any[]>([]); // In a real implementation this would be fetched from DB
  const [loading, setLoading] = useState(false);
  
  const canEdit = ["sourced", "demo", "testing", "qualified", "proposal"].includes(dealStage);

  const handleAdd = async () => {
    setLoading(true);
    try {
      const res = await addDealLineItem({
        dealId,
        productId: "dummy-product",
        quantity: 1,
        msrpUsd: 1000,
        ptpUsd: 800,
        discountPct: 0,
        dtpUsd: 800,
        proposedSellingPriceUsd: 900,
        rewardEligible: true,
      });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success("Added line item");
      // refresh items
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFreeze = async () => {
    setLoading(true);
    try {
      const res = await freezePricingRevision({ dealId });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success("Pricing revision frozen");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Line Items & Pricing</h3>
        {canEdit && (
          <div className="space-x-2">
            <Button variant="outline" size="sm" onClick={handleAdd} disabled={loading}>
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
            <Button variant="default" size="sm" onClick={handleFreeze} disabled={loading}>
              Freeze Pricing
            </Button>
          </div>
        )}
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
                  No line items yet. Add items to calculate deal value.
                </TableCell>
              </TableRow>
            ) : (
              items.map(item => (
                <TableRow key={item.id}>
                  <TableCell>{item.product_id}</TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>{formatMoney(item.msrp_usd, "USD")}</TableCell>
                  <TableCell>{formatMoney(item.dtp_usd, "USD")}</TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button variant="ghost" size="icon" className="text-red-500">
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
