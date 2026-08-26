import { Globe, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SALES_REGIONS, type SalesRegionKey } from "@/domain/contracts/world-geography";
import { describeNewsTargeting, isUntargeted, type NewsTargeting } from "@/lib/news-targeting";
import { cn } from "@/lib/utils";

export type PartnerOption = { id: string; name: string };

/**
 * Who a post is for, on the publish form.
 *
 * Nothing selected means everyone, and the summary line says that out loud
 * rather than leaving the author to infer it from empty checkboxes — "no tags"
 * and "reaches nobody" are easy to confuse, and only one of them is true here.
 *
 * The regions are the same seven SALES_REGIONS the header filter uses, so the
 * author is tagging in the vocabulary their readers already browse by.
 */
export function NewsAudiencePicker({
  value,
  onChange,
  partners,
  disabled = false,
  className,
}: {
  value: NewsTargeting;
  onChange: (next: NewsTargeting) => void;
  partners: PartnerOption[];
  disabled?: boolean;
  className?: string;
}) {
  const summary = describeNewsTargeting(
    value,
    new Map(partners.map((partner) => [partner.id, partner.name])),
  );

  const toggleRegion = (key: SalesRegionKey) => {
    const has = value.regionKeys.includes(key);
    onChange({
      ...value,
      regionKeys: has
        ? value.regionKeys.filter((candidate) => candidate !== key)
        : [...value.regionKeys, key],
    });
  };

  const togglePartner = (id: string) => {
    const has = value.partnerIds.includes(id);
    onChange({
      ...value,
      partnerIds: has
        ? value.partnerIds.filter((candidate) => candidate !== id)
        : [...value.partnerIds, id],
    });
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label className="text-xs font-medium">Audience</Label>
          <Badge tone={isUntargeted(value) ? "neutral" : "brand"} className="text-[10px]">
            {summary.regions} · {summary.partners}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Leave both untouched to publish to everyone. Each selection narrows who sees the post.
        </p>
      </div>

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Globe className="h-3.5 w-3.5" />
          Sales regions
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {SALES_REGIONS.map((region) => (
            <label
              key={region.key}
              className="flex cursor-pointer items-center gap-2 text-[13px]"
              htmlFor={`news-region-${region.key}`}
            >
              <Checkbox
                id={`news-region-${region.key}`}
                checked={value.regionKeys.includes(region.key)}
                onCheckedChange={() => toggleRegion(region.key)}
                disabled={disabled}
              />
              {region.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          Partners
        </legend>
        {partners.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No partners to target — the post will reach everyone.
          </p>
        ) : (
          <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-2.5">
            {partners.map((partner) => (
              <label
                key={partner.id}
                className="flex cursor-pointer items-center gap-2 text-[13px]"
                htmlFor={`news-partner-${partner.id}`}
              >
                <Checkbox
                  id={`news-partner-${partner.id}`}
                  checked={value.partnerIds.includes(partner.id)}
                  onCheckedChange={() => togglePartner(partner.id)}
                  disabled={disabled}
                />
                {partner.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}

/** The audience badges shown on a published post. */
export function NewsAudienceBadges({
  targeting,
  partners,
  className,
}: {
  targeting: NewsTargeting;
  partners?: PartnerOption[];
  className?: string;
}) {
  const summary = describeNewsTargeting(
    targeting,
    partners ? new Map(partners.map((partner) => [partner.id, partner.name])) : undefined,
  );
  const everyone = isUntargeted(targeting);

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Badge tone={targeting.regionKeys.length > 0 ? "info" : "neutral"} className="text-[10px]">
        <Globe className="mr-1 h-3 w-3" />
        {summary.regions}
      </Badge>
      <Badge tone={targeting.partnerIds.length > 0 ? "info" : "neutral"} className="text-[10px]">
        <Users className="mr-1 h-3 w-3" />
        {summary.partners}
      </Badge>
      {everyone ? null : <span className="text-[11px] text-muted-foreground">targeted</span>}
    </div>
  );
}
