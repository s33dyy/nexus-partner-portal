import { useCallback, useEffect, useState } from "react";

import { ProductRecommendationList } from "@/components/recommendations/product-recommendation-list";
import type { ProductRecommendation } from "@/domain/contracts/recommendations";
import { getDealRecommendations } from "@/integrations/local/recommendations";

/**
 * Cross-sell suggestions for one deal.
 *
 * Read-only on purpose. Attaching a product to a deal goes through the
 * pricing path in DealLineItems — it snapshots MSRP, PTP, discount, and DTP
 * at the moment it is added — and a shortcut here that inserted a line
 * without that snapshot would produce a line item with no pricing provenance.
 * So this suggests, and the existing form commits.
 *
 * Fetches only when mounted, and it is only mounted when the surface flag is
 * on, so a disabled flag means no panel and no request.
 */
export function DealProductSuggestions({ dealId }: { dealId: string }) {
  const [recommendations, setRecommendations] = useState<ProductRecommendation[]>([]);
  const [insufficientHistory, setInsufficientHistory] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getDealRecommendations({ dealId });
      setRecommendations(result.recommendations);
      setInsufficientHistory(result.insufficientHistory);
    } catch (error) {
      // A suggestion panel must never take the deal page down with it.
      console.error("Failed to load deal product suggestions", error);
      setRecommendations([]);
      setInsufficientHistory(true);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ProductRecommendationList
      surface="deal"
      recommendations={recommendations}
      insufficientHistory={insufficientHistory}
      loading={loading}
    />
  );
}
