import { Lightbulb, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RECOMMENDATION_EMPTY_COPY,
  RECOMMENDATION_REASON_LABELS,
  type ProductRecommendation,
  type RecommendationSurface,
} from "@/domain/contracts/recommendations";

/**
 * The one way this product shows a suggestion.
 *
 * Every row leads with its reason, because that is the part the reader can
 * check. There is deliberately no score, no star rating, and no "97% match":
 * the score is an internal ordering, and rendering it would imply a
 * precision that summing five round weights does not have. "Ordered
 * alongside Cloud Suite on 4 past requests" is a claim the reader can
 * verify; "97% match" is one they can only take on faith.
 *
 * An empty list says why it is empty. A recommendation panel that renders a
 * blank box reads as broken, and one that pads itself with arbitrary
 * catalogue entries to look populated is exactly the fabrication the rest of
 * this surface work removed.
 */
export function ProductRecommendationList({
  surface,
  recommendations,
  insufficientHistory,
  loading,
  onAdd,
  addLabel = "Add",
  busyItemId,
  className,
}: {
  surface: RecommendationSurface;
  recommendations: ProductRecommendation[];
  insufficientHistory: boolean;
  loading: boolean;
  /** Omit to render the panel read-only — the catalogue surface has nothing
   * to add the item to. */
  onAdd?: (recommendation: ProductRecommendation) => void;
  addLabel?: string;
  busyItemId?: string | null;
  className?: string;
}) {
  if (loading) {
    return (
      <div className={className}>
        <Heading />
        <div className="space-y-1.5">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) {
    // Nothing to suggest is a real answer, and saying it plainly is better
    // than an empty container the reader has to interpret.
    if (!insufficientHistory) return null;
    return (
      <div className={className}>
        <Heading />
        <p className="text-[12px] text-muted-foreground">{RECOMMENDATION_EMPTY_COPY[surface]}</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <Heading />
      <ul className="space-y-1.5">
        {recommendations.map((recommendation) => (
          <li
            key={recommendation.itemId}
            className="flex flex-wrap items-start justify-between gap-2 rounded-md border bg-secondary/30 p-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-medium">{recommendation.itemName}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {recommendation.itemCode}
                </span>
              </div>
              {/* The reason is the point of the row, so it is not a tooltip. */}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone="info" className="text-[10px]">
                  {RECOMMENDATION_REASON_LABELS[recommendation.primaryReason.code]}
                </Badge>
                <span className="text-[12px] text-muted-foreground">
                  {recommendation.primaryReason.detail}
                </span>
              </div>
              {recommendation.reasons.length > 1 ? (
                <ul className="mt-1 space-y-0.5">
                  {recommendation.reasons
                    .filter((reason) => reason !== recommendation.primaryReason)
                    .map((reason) => (
                      <li key={reason.code} className="text-[11px] text-muted-foreground/80">
                        · {reason.detail}
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
            {onAdd ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busyItemId === recommendation.itemId}
                onClick={() => onAdd(recommendation)}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {addLabel}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Heading() {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <Lightbulb className="h-3.5 w-3.5" />
      Suggested
    </div>
  );
}
