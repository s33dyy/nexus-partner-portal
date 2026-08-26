import { expect, test } from "bun:test";

import {
  EMPTY_NEWS_TARGETING,
  describeNewsTargeting,
  filterNewsPostsForViewer,
  isNewsPostVisibleTo,
  isSalesRegionKey,
  isUntargeted,
  matchesNewsAudienceFilter,
  readNewsTargeting,
  regionName,
  resolveNewsViewer,
  writeNewsTargeting,
  type NewsTargeting,
} from "@/lib/news-targeting";

const ACME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function targeting(overrides: Partial<NewsTargeting> = {}): NewsTargeting {
  return { ...EMPTY_NEWS_TARGETING, ...overrides };
}

// ---------------------------------------------------------------------------
// Reading rows
// ---------------------------------------------------------------------------

test("a row written before targeting existed reaches everyone", () => {
  // The whole reason empty means everyone: old posts must not silently
  // narrow to nobody when the columns appear.
  const legacy = readNewsTargeting({});
  expect(legacy).toEqual(EMPTY_NEWS_TARGETING);
  expect(isUntargeted(legacy)).toBe(true);
  expect(isNewsPostVisibleTo(legacy, { regionKey: "india", partnerId: ACME })).toBe(true);
  expect(isNewsPostVisibleTo(legacy, { regionKey: null, partnerId: null })).toBe(true);
});

test("null columns read as untargeted, not as a crash", () => {
  expect(readNewsTargeting({ target_region_keys: null, target_partner_ids: null })).toEqual(
    EMPTY_NEWS_TARGETING,
  );
});

test("an unrecognised region key is dropped rather than kept as an unmatchable tag", () => {
  const read = readNewsTargeting({
    target_region_keys: ["india", "atlantis", 7, null],
    target_partner_ids: [ACME, "", null],
  });
  expect(read.regionKeys).toEqual(["india"]);
  expect(read.partnerIds).toEqual([ACME]);
});

test("duplicates collapse", () => {
  const read = readNewsTargeting({
    target_region_keys: ["india", "india"],
    target_partner_ids: [ACME, ACME],
  });
  expect(read.regionKeys).toEqual(["india"]);
  expect(read.partnerIds).toEqual([ACME]);
});

test("region keys are validated against the real region list", () => {
  expect(isSalesRegionKey("india")).toBe(true);
  expect(isSalesRegionKey("europe")).toBe(true);
  expect(isSalesRegionKey("narnia")).toBe(false);
  expect(isSalesRegionKey(null)).toBe(false);
  expect(regionName("middle_east_africa")).toBe("Middle East & Africa");
});

// ---------------------------------------------------------------------------
// The audience rule
// ---------------------------------------------------------------------------

test("a region-targeted post reaches only that region", () => {
  const post = targeting({ regionKeys: ["india"] });
  expect(isNewsPostVisibleTo(post, { regionKey: "india", partnerId: ACME })).toBe(true);
  expect(isNewsPostVisibleTo(post, { regionKey: "europe", partnerId: ACME })).toBe(false);
});

test("a partner-targeted post reaches only that partner", () => {
  const post = targeting({ partnerIds: [ACME] });
  expect(isNewsPostVisibleTo(post, { regionKey: "india", partnerId: ACME })).toBe(true);
  expect(isNewsPostVisibleTo(post, { regionKey: "india", partnerId: OTHER })).toBe(false);
});

test("targeting both dimensions narrows, it does not widen", () => {
  // "India + Acme" means Acme, and only in India. Adding a tag must never
  // increase reach — that is the opposite of what tagging implies.
  const post = targeting({ regionKeys: ["india"], partnerIds: [ACME] });
  expect(isNewsPostVisibleTo(post, { regionKey: "india", partnerId: ACME })).toBe(true);
  expect(isNewsPostVisibleTo(post, { regionKey: "india", partnerId: OTHER })).toBe(false);
  expect(isNewsPostVisibleTo(post, { regionKey: "europe", partnerId: ACME })).toBe(false);
});

test("several regions are an OR within the dimension", () => {
  const post = targeting({ regionKeys: ["india", "europe"] });
  expect(isNewsPostVisibleTo(post, { regionKey: "india", partnerId: null })).toBe(true);
  expect(isNewsPostVisibleTo(post, { regionKey: "europe", partnerId: null })).toBe(true);
  expect(isNewsPostVisibleTo(post, { regionKey: "apac", partnerId: null })).toBe(false);
});

test("a viewer with an unknown region sees only region-untargeted posts", () => {
  // Fail-closed: showing a region-targeted post to someone who might not be
  // in that region is a mistake the author cannot see. A missing post is at
  // least visible as an absence, and fixable by setting the country.
  const targeted = targeting({ regionKeys: ["india"] });
  expect(isNewsPostVisibleTo(targeted, { regionKey: null, partnerId: ACME })).toBe(false);

  const partnerOnly = targeting({ partnerIds: [ACME] });
  expect(isNewsPostVisibleTo(partnerOnly, { regionKey: null, partnerId: ACME })).toBe(true);
});

test("a viewer with no partner sees only partner-untargeted posts", () => {
  const partnerTargeted = targeting({ partnerIds: [ACME] });
  expect(isNewsPostVisibleTo(partnerTargeted, { regionKey: "india", partnerId: null })).toBe(false);
});

// ---------------------------------------------------------------------------
// Describing it
// ---------------------------------------------------------------------------

test("an untargeted post says so explicitly", () => {
  // Rather than rendering nothing, which is indistinguishable from tags that
  // failed to load.
  expect(describeNewsTargeting(EMPTY_NEWS_TARGETING)).toEqual({
    regions: "All regions",
    partners: "All partners",
  });
});

test("targeting is described with real names when they are available", () => {
  const described = describeNewsTargeting(
    targeting({ regionKeys: ["india", "europe"], partnerIds: [ACME] }),
    new Map([[ACME, "Acme Retail"]]),
  );
  expect(described.regions).toBe("India, Europe");
  expect(described.partners).toBe("Acme Retail");
});

test("without a name map partners are counted, and a missing name is named as missing", () => {
  expect(describeNewsTargeting(targeting({ partnerIds: [ACME, OTHER] })).partners).toBe(
    "2 partners",
  );
  expect(describeNewsTargeting(targeting({ partnerIds: [ACME] })).partners).toBe("1 partner");
  expect(describeNewsTargeting(targeting({ partnerIds: [ACME] }), new Map()).partners).toBe(
    "Unknown partner",
  );
});

// ---------------------------------------------------------------------------
// The admin view filter
// ---------------------------------------------------------------------------

test('"all" means do not filter, not "a reader with no region"', () => {
  const post = targeting({ regionKeys: ["india"], partnerIds: [ACME] });
  // isNewsPostVisibleTo would fail-close here; the filter must not.
  expect(matchesNewsAudienceFilter(post, { regionKey: "all", partnerId: "all" })).toBe(true);
});

test("filtering by a reader previews what that reader would see", () => {
  const indiaOnly = targeting({ regionKeys: ["india"] });
  const everyone = EMPTY_NEWS_TARGETING;
  const acmeOnly = targeting({ partnerIds: [ACME] });

  // An untargeted post genuinely reaches this reader, so it matches.
  expect(matchesNewsAudienceFilter(everyone, { regionKey: "india", partnerId: "all" })).toBe(true);
  expect(matchesNewsAudienceFilter(indiaOnly, { regionKey: "india", partnerId: "all" })).toBe(true);
  expect(matchesNewsAudienceFilter(indiaOnly, { regionKey: "europe", partnerId: "all" })).toBe(
    false,
  );
  expect(matchesNewsAudienceFilter(acmeOnly, { regionKey: "all", partnerId: ACME })).toBe(true);
  expect(matchesNewsAudienceFilter(acmeOnly, { regionKey: "all", partnerId: OTHER })).toBe(false);
});

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

test("targeting survives a write/read round trip", () => {
  const original = targeting({ regionKeys: ["india", "apac"], partnerIds: [ACME] });
  expect(readNewsTargeting(writeNewsTargeting(original))).toEqual(original);
  expect(readNewsTargeting(writeNewsTargeting(EMPTY_NEWS_TARGETING))).toEqual(EMPTY_NEWS_TARGETING);
});

// ---------------------------------------------------------------------------
// Feed enforcement
// ---------------------------------------------------------------------------

const FEED = [
  { id: "everyone", target_region_keys: [], target_partner_ids: [] },
  { id: "india-only", target_region_keys: ["india"], target_partner_ids: [] },
  { id: "acme-only", target_region_keys: [], target_partner_ids: [ACME] },
  { id: "india-acme", target_region_keys: ["india"], target_partner_ids: [ACME] },
];

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

test("a partner's country decides their region", () => {
  expect(resolveNewsViewer({ partnerId: ACME, partnerCountry: "India" })).toEqual({
    regionKey: "india",
    partnerId: ACME,
  });
  expect(resolveNewsViewer({ partnerId: ACME, partnerCountry: "Germany" }).regionKey).toBe(
    "europe",
  );
});

test("an unrecognised or missing country leaves the region unknown", () => {
  expect(resolveNewsViewer({ partnerId: ACME, partnerCountry: null }).regionKey).toBeNull();
  expect(resolveNewsViewer({ partnerId: ACME, partnerCountry: "" }).regionKey).toBeNull();
  expect(
    resolveNewsViewer({ partnerId: ACME, partnerCountry: "Somewhere Else" }).regionKey,
  ).toBeNull();
});

test("a partner sees only what is addressed to them", () => {
  const viewer = resolveNewsViewer({ partnerId: ACME, partnerCountry: "India" });
  expect(ids(filterNewsPostsForViewer(FEED, viewer, { isSuperAdmin: false }))).toEqual([
    "everyone",
    "india-only",
    "acme-only",
    "india-acme",
  ]);

  const otherPartnerInIndia = resolveNewsViewer({ partnerId: OTHER, partnerCountry: "India" });
  expect(ids(filterNewsPostsForViewer(FEED, otherPartnerInIndia, { isSuperAdmin: false }))).toEqual(
    ["everyone", "india-only"],
  );

  const acmeElsewhere = resolveNewsViewer({ partnerId: ACME, partnerCountry: "Germany" });
  expect(ids(filterNewsPostsForViewer(FEED, acmeElsewhere, { isSuperAdmin: false }))).toEqual([
    "everyone",
    "acme-only",
  ]);
});

test("a viewer with no partner at all still gets the untargeted posts", () => {
  const viewer = resolveNewsViewer({ partnerId: null, partnerCountry: null });
  expect(ids(filterNewsPostsForViewer(FEED, viewer, { isSuperAdmin: false }))).toEqual([
    "everyone",
  ]);
});

test("a Super Admin sees the whole feed", () => {
  // They administer it; a filtered view would misreport what is published.
  const viewer = resolveNewsViewer({ partnerId: null, partnerCountry: null });
  expect(ids(filterNewsPostsForViewer(FEED, viewer, { isSuperAdmin: true }))).toEqual(ids(FEED));
});
