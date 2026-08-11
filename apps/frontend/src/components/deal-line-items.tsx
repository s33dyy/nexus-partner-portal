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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Loader2, Percent, Plus, Trash2, X } from "lucide-react";
import {
  removeDealLineItem,
  freezePricingRevision,
  addDealLineItem,
  requestDiscount,
  approveDiscount,
} from "@/integrations/local/pricing-commands";
import { listLineItemCatalogOptions } from "@/integrations/local/dropdown-sources";
import { toast } from "sonner";
import { formatMoney } from "@/lib/money";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";

type LineItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  msrp_usd: string;
  dtp_usd: string;
};

type DiscountRequestRow = {
  id: string;
  deal_id: string;
  line_item_id: string;
  requested_discount_pct: string | number;
  status: string;
  reason: string | null;
};

type CatalogOption = {
  id: string;
  label: string;
  sku: string | null;
  msrpUsd: number | null;
  ptpUsd: number | null;
  dtpUsd: number | null;
  source: "governed" | "catalog";
};

const EMPTY_ADD_FORM = {
  catalogOptionId: "",
  quantity: "1",
  msrpUsd: "",
  ptpUsd: "",
  discountPct: "0",
  dtpUsd: "",
  proposedSellingPriceUsd: "",
  rewardEligible: true,
};

export function DealLineItems({ dealId, dealStage }: { dealId: string; dealStage: string }) {
  const { roleKey } = useAuth();
  const [items, setItems] = useState<LineItemRow[]>([]);
  const [loading, setLoading] = useState(false);

  const canEdit = ["sourced", "demo", "testing", "qualified", "proposal"].includes(dealStage);
  // 9h/§9.12: "At Proposal, authorised Partner users can request a
  // discount" — the server (requestDiscount) also allows Negotiation, so
  // this mirrors the command's own gate rather than narrowing it further.
  const canRequestDiscount = dealStage === "proposal" || dealStage === "negotiation";
  // Mirrors approveDiscount's own role check exactly (pricing-commands.
  // server.ts): "Only PAM or RM can approve discounts" (plus super_admin).
  const canReviewDiscounts = roleKey === "pam" || roleKey === "rm" || roleKey === "super_admin";

  // 9f/18d: catalog options for the "Add line item" form. 18c: prefers the
  // governed products/product_variants/product_skus tables when they have
  // rows, falling back to the legacy free-text portal_catalog_items
  // duplicate when they don't (listLineItemCatalogOptions on the server
  // decides which — see its own comment for why).
  const [catalogOptions, setCatalogOptions] = useState<CatalogOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [addSaving, setAddSaving] = useState(false);

  // 9h: requestDiscount/approveDiscount existed server-side with zero UI
  // callers anywhere. This is that UI's first real caller.
  const [discountRequests, setDiscountRequests] = useState<DiscountRequestRow[]>([]);
  const [discountDialogItem, setDiscountDialogItem] = useState<LineItemRow | null>(null);
  // Named distinctly from handleAdd's local `discountPct` (the Add-line-item
  // form's own field) below to avoid a confusing shadowed name.
  const [requestedDiscountPct, setRequestedDiscountPct] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [discountSaving, setDiscountSaving] = useState(false);
  const [reviewingRequestId, setReviewingRequestId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsRes, discountsRes] = await Promise.all([
        supabase
          .from("deal_line_items")
          .select("id, product_id, quantity, msrp_usd, dtp_usd")
          .eq("deal_id", dealId),
        supabase
          .from("discount_requests")
          .select("id, deal_id, line_item_id, requested_discount_pct, status, reason")
          .eq("deal_id", dealId),
      ]);
      if (itemsRes.error) throw itemsRes.error;
      setItems((itemsRes.data as LineItemRow[] | null) ?? []);
      // Discount-request reads can fail for a role with no "deals" read
      // grant on this deal (e.g. table-policy denial) without blocking the
      // line items themselves from rendering.
      setDiscountRequests(
        discountsRes.error ? [] : ((discountsRes.data as DiscountRequestRow[] | null) ?? []),
      );
    } catch {
      setItems([]);
      setDiscountRequests([]);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAdd = async () => {
    setAddForm(EMPTY_ADD_FORM);
    setAddOpen(true);
    setCatalogLoading(true);
    try {
      const options = await listLineItemCatalogOptions({});
      setCatalogOptions(options);
    } catch {
      setCatalogOptions([]);
    } finally {
      setCatalogLoading(false);
    }
  };

  const selectCatalogOption = (optionId: string) => {
    const option = catalogOptions.find((candidate) => candidate.id === optionId);
    setAddForm((current) => ({
      ...current,
      catalogOptionId: optionId,
      msrpUsd: option?.msrpUsd != null ? String(option.msrpUsd) : current.msrpUsd,
      ptpUsd: option?.ptpUsd != null ? String(option.ptpUsd) : current.ptpUsd,
      dtpUsd:
        option?.dtpUsd != null
          ? String(option.dtpUsd)
          : option?.ptpUsd != null
            ? String(option.ptpUsd)
            : current.dtpUsd,
      proposedSellingPriceUsd:
        option?.dtpUsd != null
          ? String(option.dtpUsd)
          : option?.ptpUsd != null
            ? String(option.ptpUsd)
            : current.proposedSellingPriceUsd,
    }));
  };

  const handleAdd = async () => {
    const selectedOption = catalogOptions.find((option) => option.id === addForm.catalogOptionId);
    if (!selectedOption) {
      toast.error("Select a product first");
      return;
    }
    const quantity = Number(addForm.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast.error("Quantity must be a positive number");
      return;
    }
    const msrpUsd = Number(addForm.msrpUsd) || 0;
    const ptpUsd = Number(addForm.ptpUsd) || 0;
    const discountPct = Number(addForm.discountPct) || 0;
    const dtpUsd = Number(addForm.dtpUsd) || 0;
    const proposedSellingPriceUsd = Number(addForm.proposedSellingPriceUsd) || 0;

    setAddSaving(true);
    try {
      // product_id has no FK (deal_line_items.product_id is plain TEXT) —
      // this app already treats "product" as a display label everywhere
      // else (portal_deals.product is the same shape), so store the
      // catalog option's own label/SKU rather than its internal id, which
      // would otherwise render as a raw UUID in the table below.
      const productLabel = selectedOption.sku
        ? `${selectedOption.label} (${selectedOption.sku})`
        : selectedOption.label;
      const res = await addDealLineItem({
        dealId,
        productId: productLabel,
        quantity,
        msrpUsd,
        ptpUsd,
        discountPct,
        dtpUsd,
        proposedSellingPriceUsd,
        rewardEligible: addForm.rewardEligible,
      });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success("Line item added");
      setAddOpen(false);
      setAddForm(EMPTY_ADD_FORM);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add line item");
    } finally {
      setAddSaving(false);
    }
  };

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

  const openDiscountDialog = (item: LineItemRow) => {
    setDiscountDialogItem(item);
    setRequestedDiscountPct("");
    setDiscountReason("");
  };

  const handleRequestDiscount = async () => {
    if (!discountDialogItem) return;
    const pct = Number(requestedDiscountPct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      toast.error("Discount % must be between 0 and 100");
      return;
    }
    setDiscountSaving(true);
    try {
      const res = await requestDiscount({
        dealId,
        lineItemId: discountDialogItem.id,
        requestedDiscountPct: pct,
        reason: discountReason.trim() || undefined,
      });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success("Discount requested");
      setDiscountDialogItem(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to request discount");
    } finally {
      setDiscountSaving(false);
    }
  };

  const handleReviewDiscount = async (requestId: string, approved: boolean) => {
    setReviewingRequestId(requestId);
    try {
      const res = await approveDiscount({ dealId, requestId, approved });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success(approved ? "Discount approved" : "Discount rejected");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to review discount request");
    } finally {
      setReviewingRequestId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Line Items & Pricing</h3>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => void openAdd()} disabled={loading}>
              <Plus className="mr-2 h-4 w-4" />
              Add line item
            </Button>
          )}
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
              {(canEdit || canRequestDiscount) && <TableHead></TableHead>}
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
                  {(canEdit || canRequestDiscount) && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {canRequestDiscount && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Request discount"
                            onClick={() => openDiscountDialog(item)}
                          >
                            <Percent className="w-4 h-4" />
                          </Button>
                        )}
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-500"
                            onClick={() => void handleRemove(item.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {discountRequests.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Discount requests</h4>
          <div className="border rounded-md divide-y">
            {discountRequests.map((request) => {
              const item = items.find((candidate) => candidate.id === request.line_item_id);
              return (
                <div
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                >
                  <div>
                    <div className="font-medium">
                      {item?.product_id ?? "Line item"} · {Number(request.requested_discount_pct)}%
                    </div>
                    {request.reason ? (
                      <div className="text-xs text-muted-foreground">{request.reason}</div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        request.status === "approved"
                          ? "default"
                          : request.status === "rejected"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {request.status}
                    </Badge>
                    {canReviewDiscounts && request.status === "pending" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reviewingRequestId === request.id}
                          onClick={() => void handleReviewDiscount(request.id, true)}
                        >
                          <Check className="mr-1 h-3.5 w-3.5" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reviewingRequestId === request.id}
                          onClick={() => void handleReviewDiscount(request.id, false)}
                        >
                          <X className="mr-1 h-3.5 w-3.5" />
                          Reject
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <Dialog
        open={discountDialogItem !== null}
        onOpenChange={(open) => {
          if (!open) setDiscountDialogItem(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request discount</DialogTitle>
            <DialogDescription>
              {discountDialogItem?.product_id ?? "Line item"} — captures percentage and reason for
              PAM/RM review (product.md §9.12).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="discount_pct">Requested discount %</Label>
              <Input
                id="discount_pct"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={requestedDiscountPct}
                onChange={(e) => setRequestedDiscountPct(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="discount_reason">Reason</Label>
              <Textarea
                id="discount_reason"
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                placeholder="Why does this deal need a discount?"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDiscountDialogItem(null)}
              disabled={discountSaving}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleRequestDiscount()} disabled={discountSaving}>
              {discountSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Request discount
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add line item</DialogTitle>
            <DialogDescription>
              Capture the product/SKU, quantity, and pricing basis for this deal (product.md
              §9.3–§9.6).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="line_item_product">Product / SKU</Label>
              {catalogLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading catalog...
                </div>
              ) : (
                <Select value={addForm.catalogOptionId} onValueChange={selectCatalogOption}>
                  <SelectTrigger id="line_item_product">
                    <SelectValue placeholder="Select a product or SKU" />
                  </SelectTrigger>
                  <SelectContent>
                    {catalogOptions.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        No catalog items available.
                      </div>
                    ) : (
                      catalogOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                          {option.sku ? ` (${option.sku})` : ""}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="line_item_quantity">Quantity</Label>
                <Input
                  id="line_item_quantity"
                  type="number"
                  min={1}
                  value={addForm.quantity}
                  onChange={(e) =>
                    setAddForm((current) => ({ ...current, quantity: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="line_item_msrp">MSRP (USD)</Label>
                <Input
                  id="line_item_msrp"
                  type="number"
                  min={0}
                  step="0.01"
                  value={addForm.msrpUsd}
                  onChange={(e) =>
                    setAddForm((current) => ({ ...current, msrpUsd: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="line_item_ptp">PTP (USD)</Label>
                <Input
                  id="line_item_ptp"
                  type="number"
                  min={0}
                  step="0.01"
                  value={addForm.ptpUsd}
                  onChange={(e) =>
                    setAddForm((current) => ({ ...current, ptpUsd: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="line_item_discount">Discount %</Label>
                <Input
                  id="line_item_discount"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={addForm.discountPct}
                  onChange={(e) =>
                    setAddForm((current) => ({ ...current, discountPct: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="line_item_dtp">DTP (USD)</Label>
                <Input
                  id="line_item_dtp"
                  type="number"
                  min={0}
                  step="0.01"
                  value={addForm.dtpUsd}
                  onChange={(e) =>
                    setAddForm((current) => ({ ...current, dtpUsd: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="line_item_proposed">Proposed selling price (USD)</Label>
                <Input
                  id="line_item_proposed"
                  type="number"
                  min={0}
                  step="0.01"
                  value={addForm.proposedSellingPriceUsd}
                  onChange={(e) =>
                    setAddForm((current) => ({
                      ...current,
                      proposedSellingPriceUsd: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="line_item_reward_eligible"
                checked={addForm.rewardEligible}
                onCheckedChange={(checked) =>
                  setAddForm((current) => ({ ...current, rewardEligible: Boolean(checked) }))
                }
              />
              <Label htmlFor="line_item_reward_eligible" className="font-normal">
                Reward eligible
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addSaving}>
              Cancel
            </Button>
            <Button onClick={() => void handleAdd()} disabled={addSaving}>
              {addSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add line item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
