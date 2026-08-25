import { expect, test } from "bun:test";

import { FEATURE_FLAG_REGISTRY, type FeatureFlagKey } from "@/domain/contracts/feature-flags";
import {
  PRODUCT_SURFACE_KEYS,
  ALL_PRODUCT_SURFACES_DISABLED,
  resolveProductSurface,
  resolveProductSurfaceSnapshot,
  type ProductSurfaceKey,
} from "@/server/feature-gates.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

type FlagRow = { flag_key: string; enabled: boolean };

function fakeQuery(rows: FlagRow[]) {
  return async () => ({ rows });
}

/** Every flag row `key` needs to be considered enabled — itself plus each
 * transitive dependency the registry declares for it. */
function enabledRowsFor(key: FeatureFlagKey): FlagRow[] {
  const seen = new Set<string>();
  const walk = (current: FeatureFlagKey) => {
    if (seen.has(current)) return;
    seen.add(current);
    const entry = FEATURE_FLAG_REGISTRY.find((candidate) => candidate.key === current);
    for (const dependency of entry?.dependencies ?? []) walk(dependency);
  };
  walk(key);
  return [...seen].map((flag_key) => ({ flag_key, enabled: true }));
}

const GYFTR_ENV = {
  GYFTR_API_URL: "https://gyftr.example.com",
  GYFTR_CLIENT_ID: "client-1",
  GYFTR_SECRET_KEY: "secret-1",
};

test("every product surface key is registered and ships disabled", () => {
  for (const key of PRODUCT_SURFACE_KEYS) {
    const entry = FEATURE_FLAG_REGISTRY.find((candidate) => candidate.key === key);
    expect(entry).toBeDefined();
    expect(entry?.enabledByDefault).toBe(false);
  }
});

test("missing surface flag fails closed", async () => {
  const enabled = await resolveProductSurface("distribution-core", { query: fakeQuery([]) });
  expect(enabled).toBe(false);
});

test("database errors fail closed", async () => {
  const enabled = await resolveProductSurface("distribution-core", {
    query: async () => {
      throw new Error("db unavailable");
    },
  });
  expect(enabled).toBe(false);
});

test("an explicitly disabled flag row fails closed", async () => {
  const rows = enabledRowsFor("distribution-core").map((row) =>
    row.flag_key === "distribution-core" ? { ...row, enabled: false } : row,
  );
  expect(await resolveProductSurface("distribution-core", { query: fakeQuery(rows) })).toBe(false);
});

test("an enabled surface whose dependency is disabled fails closed", async () => {
  const rows = enabledRowsFor("distribution-core").map((row) =>
    row.flag_key === "command-framework-write" ? { ...row, enabled: false } : row,
  );
  expect(await resolveProductSurface("distribution-core", { query: fakeQuery(rows) })).toBe(false);
});

test("an enabled surface whose dependency row is absent fails closed", async () => {
  const rows = enabledRowsFor("distribution-core").filter(
    (row) => row.flag_key !== "baseline-telemetry",
  );
  expect(await resolveProductSurface("distribution-core", { query: fakeQuery(rows) })).toBe(false);
});

test("a fully enabled surface resolves true", async () => {
  const rows = enabledRowsFor("distribution-core");
  expect(await resolveProductSurface("distribution-core", { query: fakeQuery(rows) })).toBe(true);
});

test("GyFTR requires both its flag and real credentials", async () => {
  const configuredFlagOnly = { query: fakeQuery(enabledRowsFor("gyftr-fulfillment")), env: {} };
  expect(await resolveProductSurface("gyftr-fulfillment", configuredFlagOnly)).toBe(false);

  const blankCredentials = {
    query: fakeQuery(enabledRowsFor("gyftr-fulfillment")),
    env: { GYFTR_API_URL: "  ", GYFTR_CLIENT_ID: "  ", GYFTR_SECRET_KEY: "  " },
  };
  expect(await resolveProductSurface("gyftr-fulfillment", blankCredentials)).toBe(false);

  const partialCredentials = {
    query: fakeQuery(enabledRowsFor("gyftr-fulfillment")),
    env: { ...GYFTR_ENV, GYFTR_SECRET_KEY: "" },
  };
  expect(await resolveProductSurface("gyftr-fulfillment", partialCredentials)).toBe(false);

  const credentialsWithoutFlag = { query: fakeQuery([]), env: GYFTR_ENV };
  expect(await resolveProductSurface("gyftr-fulfillment", credentialsWithoutFlag)).toBe(false);

  const both = { query: fakeQuery(enabledRowsFor("gyftr-fulfillment")), env: GYFTR_ENV };
  expect(await resolveProductSurface("gyftr-fulfillment", both)).toBe(true);
});

test("an unknown surface key fails closed rather than throwing", async () => {
  const enabled = await resolveProductSurface("not-a-real-surface" as ProductSurfaceKey, {
    query: fakeQuery([{ flag_key: "not-a-real-surface", enabled: true }]),
  });
  expect(enabled).toBe(false);
});

test("the snapshot exposes only booleans and is all-false when the database is unreachable", async () => {
  const snapshot = await resolveProductSurfaceSnapshot({
    query: async () => {
      throw new Error("db unavailable");
    },
  });
  expect(snapshot).toEqual(ALL_PRODUCT_SURFACES_DISABLED);
  for (const value of Object.values(snapshot)) {
    expect(typeof value).toBe("boolean");
  }
});

test("the snapshot reports each surface independently", async () => {
  const rows = [
    ...enabledRowsFor("distribution-core"),
    { flag_key: "integration-operations-centre", enabled: false },
    { flag_key: "learning-lesson-authoring", enabled: true },
    { flag_key: "gyftr-fulfillment", enabled: true },
  ];
  const snapshot = await resolveProductSurfaceSnapshot({ query: fakeQuery(rows), env: {} });
  expect(snapshot.distributionCore).toBe(true);
  expect(snapshot.integrationOperationsCentre).toBe(false);
  expect(snapshot.learningLessonAuthoring).toBe(true);
  // Flag on, credentials absent — still closed.
  expect(snapshot.gyftrFulfillment).toBe(false);
});
