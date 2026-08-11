import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { SALES_REGIONS } from "@/domain/contracts/world-geography";
import { type RegionFilterValue } from "@livey/shared/lib/region-filter";

export type { RegionFilterValue };
export { matchesSelectedRegion } from "@livey/shared/lib/region-filter";

const STORAGE_KEY = "livey.selected-region";

type RegionFilterContextValue = {
  selectedRegion: RegionFilterValue;
  setSelectedRegion: (region: RegionFilterValue) => void;
  regionLabel: string;
};

const RegionFilterContext = createContext<RegionFilterContextValue | null>(null);

function readStoredRegion(): RegionFilterValue {
  if (typeof window === "undefined") return "all";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return "all";
  if (stored === "all") return "all";
  return SALES_REGIONS.some((region) => region.key === stored)
    ? (stored as RegionFilterValue)
    : "all";
}

export function RegionFilterProvider({ children }: { children: ReactNode }) {
  const [selectedRegion, setSelectedRegionState] = useState<RegionFilterValue>("all");

  useEffect(() => {
    setSelectedRegionState(readStoredRegion());
  }, []);

  const setSelectedRegion = (region: RegionFilterValue) => {
    setSelectedRegionState(region);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, region);
    }
  };

  const regionLabel = useMemo(() => {
    if (selectedRegion === "all") return "All regions";
    return SALES_REGIONS.find((region) => region.key === selectedRegion)?.name ?? "All regions";
  }, [selectedRegion]);

  const value = useMemo(
    () => ({ selectedRegion, setSelectedRegion, regionLabel }),
    [selectedRegion, regionLabel],
  );

  return <RegionFilterContext.Provider value={value}>{children}</RegionFilterContext.Provider>;
}

export function useRegionFilter(): RegionFilterContextValue {
  const context = useContext(RegionFilterContext);
  if (!context) {
    throw new Error("useRegionFilter must be used within a RegionFilterProvider");
  }
  return context;
}
