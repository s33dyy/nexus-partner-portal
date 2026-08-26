import { useCallback, useEffect, useState } from "react";

import { ProductRecommendationList } from "@/components/recommendations/product-recommendation-list";
import { Card, CardContent } from "@/components/ui/card";
import type { ProductRecommendation } from "@/domain/contracts/recommendations";
import { getCatalogueRecommendations } from "@/integrations/local/recommendations";

/**
 * Related products for one catalogue item, drawn from the deals it has
 * actually appeared on.
 *
 * Read-only: the catalogue is where products are defined, not where they are
 * attached to anything, so there is nothing for an "Add" button to add to.
 * Rendering one would be an action with no destination.
 */
export function CatalogueProductSuggestions({ sku }: { sku: string }) {
  const [recommendations, setRecommendations] = useState<ProductRecommendation[]>([]);
  const [insufficientHistory, setInsufficientHistory] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!sku) return;
    setLoading(true);
    try {
      const result = await getCatalogueRecommendations({ sku });
      setRecommendations(result.recommendations);
      setInsufficientHistory(result.insufficientHistory);
    } catch (error) {
      console.error("Failed to load related products", error);
      setRecommendations([]);
      setInsufficientHistory(true);
    } finally {
      setLoading(false);
    }
  }, [sku]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card className="mt-4">
      <CardContent className="pt-5">
        <ProductRecommendationList
          surface="catalogue"
          recommendations={recommendations}
          insufficientHistory={insufficientHistory}
          loading={loading}
        />
      </CardContent>
    </Card>
  );
}
