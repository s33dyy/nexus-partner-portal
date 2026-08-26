import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { ProductRecommendationList } from "@/components/recommendations/product-recommendation-list";

import { Button } from "@/components/ui/button";
import { Field, FieldGrid, FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ProductRecommendation } from "@/domain/contracts/recommendations";
import {
  STOCK_REQUEST_PRIORITIES,
  type RequestableProductSkuView,
  type StockLocationView,
  type StockRequestPriority,
  type SubmitStockRequestInput,
} from "@/domain/contracts/distribution";

/**
 * Request Stock.
 *
 * The idempotency key is generated once when the dialog opens and reused for
 * every submit attempt from that draft, so a double-click, an impatient
 * retry, or a flaky connection all converge on one request rather than three.
 * A fresh key is minted only when the dialog is reopened, which is the point
 * at which the user really does mean "another one".
 */
export type StockRequestDraftLine = { productSkuId: string; quantity: string };

const EMPTY_LINE: StockRequestDraftLine = { productSkuId: "", quantity: "1" };

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `req-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

export function StockRequestDialog({
  open,
  onOpenChange,
  skus,
  destinations,
  dealId,
  customerId,
  busy,
  onSubmit,
  loadRecommendations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skus: RequestableProductSkuView[];
  destinations: StockLocationView[];
  dealId?: string | null;
  customerId?: string | null;
  busy: boolean;
  onSubmit: (input: SubmitStockRequestInput) => Promise<void>;
  /** Omitted when the recommendation surface is off, in which case the panel
   * is not rendered and no request is made for it. */
  loadRecommendations?: (input: {
    destinationLocationId: string;
    chosenProductSkuIds: string[];
  }) => Promise<{ recommendations: ProductRecommendation[]; insufficientHistory: boolean }>;
}) {
  const [destinationLocationId, setDestinationLocationId] = useState("");
  const [requiredBy, setRequiredBy] = useState("");
  const [priority, setPriority] = useState<StockRequestPriority>("medium");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<StockRequestDraftLine[]>([{ ...EMPTY_LINE }]);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ProductRecommendation[]>([]);
  const [suggestionsThin, setSuggestionsThin] = useState(true);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    // One key per opening of the dialog — see the note above.
    setIdempotencyKey(newIdempotencyKey());
    setError(null);
    setLines([{ ...EMPTY_LINE }]);
    setReason("");
    setRequiredBy("");
    setPriority("medium");
    setDestinationLocationId(destinations.length === 1 ? destinations[0]!.id : "");
  }, [open, destinations]);

  const usedSkuIds = useMemo(
    () => new Set(lines.map((line) => line.productSkuId).filter(Boolean)),
    [lines],
  );

  const chosenKey = [...usedSkuIds].sort().join(",");

  const refreshSuggestions = useCallback(async () => {
    if (!loadRecommendations || !destinationLocationId) {
      setSuggestions([]);
      setSuggestionsThin(true);
      return;
    }
    setSuggestionsLoading(true);
    try {
      const result = await loadRecommendations({
        destinationLocationId,
        chosenProductSkuIds: chosenKey ? chosenKey.split(",") : [],
      });
      setSuggestions(result.recommendations);
      setSuggestionsThin(result.insufficientHistory);
    } catch (cause) {
      // A failed suggestion fetch must never block the request the user came
      // here to make, so it degrades to no panel rather than an error.
      console.error("Failed to load stock suggestions", cause);
      setSuggestions([]);
      setSuggestionsThin(true);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [loadRecommendations, destinationLocationId, chosenKey]);

  useEffect(() => {
    if (!open) return;
    void refreshSuggestions();
  }, [open, refreshSuggestions]);

  const addSuggestion = (recommendation: ProductRecommendation) => {
    setLines((current) => {
      // Reuse a blank row if the user left one, rather than stacking an empty
      // line under every accepted suggestion.
      const blankIndex = current.findIndex((line) => !line.productSkuId);
      const next = [...current];
      const added = { productSkuId: recommendation.itemId, quantity: "1" };
      if (blankIndex >= 0) next[blankIndex] = added;
      else next.push(added);
      return next;
    });
  };

  const validationError = useMemo(() => {
    if (!destinationLocationId) return "Choose the location the stock should arrive at.";
    if (!requiredBy) return "Choose the date you need it by.";
    if (!reason.trim()) return "Say why you need it.";
    const filled = lines.filter((line) => line.productSkuId);
    if (filled.length === 0) return "Add at least one product.";
    for (const line of filled) {
      const quantity = Number(line.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        return "Every quantity must be a whole number greater than zero.";
      }
    }
    if (new Set(filled.map((line) => line.productSkuId)).size !== filled.length) {
      return "Each product can appear only once.";
    }
    return null;
  }, [destinationLocationId, requiredBy, reason, lines]);

  const submit = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    await onSubmit({
      destinationLocationId,
      dealId: dealId ?? null,
      customerId: customerId ?? null,
      requiredBy,
      priority,
      reason: reason.trim(),
      lines: lines
        .filter((line) => line.productSkuId)
        .map((line) => ({ productSkuId: line.productSkuId, quantity: Number(line.quantity) })),
      idempotencyKey,
    });
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Request stock"
      description={
        dealId
          ? "Linked to the deal you came from."
          : customerId
            ? "Linked to the customer you came from."
            : "Your manager reviews this before any stock is committed."
      }
      busy={busy}
      submitLabel="Submit request"
      busyLabel="Submitting…"
      submitDisabled={Boolean(validationError)}
      onSubmit={submit}
      size="lg"
      footerNote={error ?? validationError ?? undefined}
    >
      <FieldGrid>
        <Field label="Deliver to" htmlFor="destination">
          <Select value={destinationLocationId} onValueChange={setDestinationLocationId}>
            <SelectTrigger id="destination">
              <SelectValue placeholder="Choose a location" />
            </SelectTrigger>
            <SelectContent>
              {destinations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.locationName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Needed by" htmlFor="required-by">
          <Input
            id="required-by"
            type="date"
            value={requiredBy}
            onChange={(event) => setRequiredBy(event.target.value)}
          />
        </Field>
        <Field label="Priority" htmlFor="priority">
          <Select
            value={priority}
            onValueChange={(value) => setPriority(value as StockRequestPriority)}
          >
            <SelectTrigger id="priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STOCK_REQUEST_PRIORITIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value[0]!.toUpperCase() + value.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FieldGrid>

      <Field label="Reason" htmlFor="reason">
        <Textarea
          id="reason"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="What is this stock for?"
        />
      </Field>

      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Products
        </div>
        {lines.map((line, index) => (
          <div key={index} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Select
                value={line.productSkuId}
                onValueChange={(value) =>
                  setLines((current) =>
                    current.map((candidate, position) =>
                      position === index ? { ...candidate, productSkuId: value } : candidate,
                    ),
                  )
                }
              >
                <SelectTrigger aria-label={`Product for line ${index + 1}`}>
                  <SelectValue placeholder="Choose a product" />
                </SelectTrigger>
                <SelectContent>
                  {skus
                    .filter(
                      (sku) =>
                        sku.productSkuId === line.productSkuId || !usedSkuIds.has(sku.productSkuId),
                    )
                    .map((sku) => (
                      <SelectItem key={sku.productSkuId} value={sku.productSkuId}>
                        {sku.productName} · {sku.skuCode}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              className="w-24"
              type="number"
              min={1}
              step={1}
              aria-label={`Quantity for line ${index + 1}`}
              value={line.quantity}
              onChange={(event) =>
                setLines((current) =>
                  current.map((candidate, position) =>
                    position === index ? { ...candidate, quantity: event.target.value } : candidate,
                  ),
                )
              }
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Remove line ${index + 1}`}
              disabled={lines.length === 1}
              onClick={() =>
                setLines((current) => current.filter((_, position) => position !== index))
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add product
        </Button>
      </div>

      {loadRecommendations && destinationLocationId ? (
        <ProductRecommendationList
          surface="stock_request"
          recommendations={suggestions}
          insufficientHistory={suggestionsThin}
          loading={suggestionsLoading}
          onAdd={addSuggestion}
          className="border-t pt-3"
        />
      ) : null}
    </FormDialog>
  );
}
