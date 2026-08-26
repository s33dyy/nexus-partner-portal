import {
  SALES_REGIONS,
  resolveCountryForText,
  type SalesRegionKey,
} from "@/domain/contracts/world-geography";

/**
 * Who a news post is for.
 *
 * Two independent dimensions, both stored as arrays where **empty means
 * everyone**. That default is what keeps every post written before targeting
 * existed visible to the whole audience — a migration that silently narrowed
 * old posts to nobody would look like the feed had broken.
 *
 * The audience rule is AND across dimensions, OR within one:
 *
 *   visible = (no regions targeted OR viewer's region is targeted)
 *         AND (no partners targeted OR viewer's partner is targeted)
 *
 * So "India + Acme" means *Acme, and only in India* — each dimension narrows
 * the audience further. The alternative (OR across dimensions) would make
 * adding a region tag *widen* reach, which is the opposite of what someone
 * adding a tag expects.
 */
export type NewsTargeting = {
  /** Empty means every sales region. */
  regionKeys: SalesRegionKey[];
  /** Empty means every partner. */
  partnerIds: string[];
};

export const EMPTY_NEWS_TARGETING: NewsTargeting = { regionKeys: [], partnerIds: [] };

export function isSalesRegionKey(value: unknown): value is SalesRegionKey {
  return typeof value === "string" && SALES_REGIONS.some((region) => region.key === value);
}

/**
 * Reads targeting off a raw row.
 *
 * Tolerant on purpose: the columns are nullable arrays on a table that
 * predates them, and an unrecognised region key (a renamed region, a
 * hand-edited row) is dropped rather than carried forward as a tag nothing
 * can ever match.
 */
export function readNewsTargeting(row: {
  target_region_keys?: unknown;
  target_partner_ids?: unknown;
}): NewsTargeting {
  const regionKeys = Array.isArray(row.target_region_keys)
    ? row.target_region_keys.filter(isSalesRegionKey)
    : [];
  const partnerIds = Array.isArray(row.target_partner_ids)
    ? row.target_partner_ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return { regionKeys: [...new Set(regionKeys)], partnerIds: [...new Set(partnerIds)] };
}

export type NewsViewer = {
  /** Null when the viewer's region cannot be established — see below. */
  regionKey: SalesRegionKey | null;
  partnerId: string | null;
};

/**
 * Whether one post reaches one viewer.
 *
 * A viewer whose region cannot be established sees only posts that target no
 * region. That is deliberately fail-closed: showing a region-targeted post to
 * someone who might not be in that region is a targeting mistake the author
 * cannot see, whereas a missing post is visible to them as an absence and
 * fixable by setting the partner's country.
 */
export function isNewsPostVisibleTo(targeting: NewsTargeting, viewer: NewsViewer): boolean {
  const regionOk =
    targeting.regionKeys.length === 0 ||
    (viewer.regionKey !== null && targeting.regionKeys.includes(viewer.regionKey));
  const partnerOk =
    targeting.partnerIds.length === 0 ||
    (viewer.partnerId !== null && targeting.partnerIds.includes(viewer.partnerId));
  return regionOk && partnerOk;
}

/** True when the post reaches the entire audience. */
export function isUntargeted(targeting: NewsTargeting): boolean {
  return targeting.regionKeys.length === 0 && targeting.partnerIds.length === 0;
}

export function regionName(key: SalesRegionKey): string {
  return SALES_REGIONS.find((region) => region.key === key)?.name ?? key;
}

/**
 * The audience in words, for the badge on a post.
 *
 * Says "All regions" and "All partners" explicitly rather than showing
 * nothing, because an untargeted post and a post whose tags failed to load
 * would otherwise look identical.
 */
export function describeNewsTargeting(
  targeting: NewsTargeting,
  partnerNameById?: Map<string, string>,
): { regions: string; partners: string } {
  const regions =
    targeting.regionKeys.length === 0
      ? "All regions"
      : targeting.regionKeys.map(regionName).join(", ");

  let partners: string;
  if (targeting.partnerIds.length === 0) {
    partners = "All partners";
  } else if (partnerNameById) {
    const named = targeting.partnerIds.map((id) => partnerNameById.get(id) ?? "Unknown partner");
    partners = named.join(", ");
  } else {
    partners = `${targeting.partnerIds.length} partner${targeting.partnerIds.length === 1 ? "" : "s"}`;
  }

  return { regions, partners };
}

/**
 * The admin list's view filter, which doubles as an audience preview.
 *
 * Selecting a region or partner answers "what would this reader see?", so an
 * untargeted post matches every filter — it genuinely does reach that reader.
 * A filter that only matched posts *explicitly* tagged with the value would
 * hide the majority of the feed and misrepresent the audience.
 */
export function matchesNewsAudienceFilter(
  targeting: NewsTargeting,
  filter: { regionKey: SalesRegionKey | "all"; partnerId: string | "all" },
): boolean {
  // "all" means "do not filter on this dimension" — which is NOT the same as
  // isNewsPostVisibleTo's null, where a viewer's region is genuinely unknown
  // and the post fails closed. Hence its own rule rather than reusing that one.
  const regionOk =
    filter.regionKey === "all" ||
    targeting.regionKeys.length === 0 ||
    targeting.regionKeys.includes(filter.regionKey);
  const partnerOk =
    filter.partnerId === "all" ||
    targeting.partnerIds.length === 0 ||
    targeting.partnerIds.includes(filter.partnerId);
  return regionOk && partnerOk;
}

/** Serialises a draft's targeting for the insert/update payload. */
export function writeNewsTargeting(targeting: NewsTargeting): {
  target_region_keys: string[];
  target_partner_ids: string[];
} {
  return {
    target_region_keys: [...targeting.regionKeys],
    target_partner_ids: [...targeting.partnerIds],
  };
}

/**
 * The viewer a news feed is being rendered for.
 *
 * Region comes from the partner's country rather than the header's region
 * filter: the filter is a browsing control the reader can change, while the
 * audience of a post is a property of who they are.
 */
export function resolveNewsViewer(input: {
  partnerId: string | null | undefined;
  partnerCountry: string | null | undefined;
}): NewsViewer {
  return {
    regionKey: resolveCountryForText(input.partnerCountry)?.regionKey ?? null,
    partnerId: input.partnerId ?? null,
  };
}

/**
 * Applies targeting to a feed.
 *
 * Super Admins keep seeing every post: they author and administer the feed, so
 * a filtered view would misreport what is published — and /admin/news already
 * spells out the audience of each post. Every other reader sees only what is
 * addressed to them.
 */
export function filterNewsPostsForViewer<
  T extends { target_region_keys?: unknown; target_partner_ids?: unknown },
>(posts: readonly T[], viewer: NewsViewer, options: { isSuperAdmin: boolean }): T[] {
  if (options.isSuperAdmin) return [...posts];
  return posts.filter((post) => isNewsPostVisibleTo(readNewsTargeting(post), viewer));
}
