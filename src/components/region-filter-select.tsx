import { Globe } from "lucide-react";

import { SALES_REGIONS } from "@/domain/contracts/world-geography";
import { useRegionFilter, type RegionFilterValue } from "@/lib/region-filter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function RegionFilterSelect({ className }: { className?: string }) {
  const { selectedRegion, setSelectedRegion } = useRegionFilter();

  return (
    <Select
      value={selectedRegion}
      onValueChange={(value) => setSelectedRegion(value as RegionFilterValue)}
    >
      <SelectTrigger
        className={className ?? "h-9 w-auto min-w-[10rem] gap-2 shrink-0"}
        aria-label="Filter by Sales Region"
      >
        <Globe className="h-4 w-4 shrink-0 opacity-60" />
        <SelectValue placeholder="All regions" />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="all">All regions</SelectItem>
        {SALES_REGIONS.map((region) => (
          <SelectItem key={region.key} value={region.key}>
            {region.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
