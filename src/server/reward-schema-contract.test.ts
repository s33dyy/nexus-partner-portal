import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");
const migrationPath = resolve(
  repoRoot,
  "supabase/migrations/20260801020000_risk_first_reward_integrity.sql",
);

test("reward integrity migration adds replay and retirement contracts", () => {
  const sql = readFileSync(migrationPath, "utf8");
  for (const column of ["idempotency_key", "version", "reversal_of", "retired_at", "retired_by"]) {
    expect(sql).toContain(column);
  }
  expect(sql).toContain("ON DELETE RESTRICT");
  expect(sql).toContain("reward_redemptions_idempotency_key_uidx");
  expect(sql).toContain("reward_point_events_idempotency_key_uidx");
  expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test("canonical schema adds the reward integrity contract as repeatable ALTER statements after each table exists", () => {
  // db:migrate re-runs this whole file against the already-bootstrapped
  // production database on every deploy (see railway.json), so new columns
  // must land via ADD COLUMN IF NOT EXISTS after the table — CREATE TABLE
  // IF NOT EXISTS is a no-op once the table already exists, and a fresh
  // CREATE UNIQUE INDEX on a not-yet-existing column would fail outright
  // (reproduced locally: "column idempotency_key does not exist").
  const schema = readFileSync(resolve(repoRoot, "db/schema.sql"), "utf8");

  const catalogTableIndex = schema.indexOf("CREATE TABLE IF NOT EXISTS reward_catalog_items (");
  const retiredAtIndex = schema.indexOf(
    "ALTER TABLE reward_catalog_items ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;",
  );
  const retiredByIndex = schema.indexOf(
    "ALTER TABLE reward_catalog_items ADD COLUMN IF NOT EXISTS retired_by UUID REFERENCES profiles(id) ON DELETE SET NULL;",
  );
  expect(catalogTableIndex).toBeGreaterThan(-1);
  expect(retiredAtIndex).toBeGreaterThan(catalogTableIndex);
  expect(retiredByIndex).toBeGreaterThan(catalogTableIndex);

  const pointEventsTableIndex = schema.indexOf("CREATE TABLE IF NOT EXISTS reward_point_events (");
  const pointEventsIdemIndex = schema.indexOf(
    "ALTER TABLE reward_point_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT;",
  );
  const reversalOfIndex = schema.indexOf(
    "ALTER TABLE reward_point_events ADD COLUMN IF NOT EXISTS reversal_of UUID REFERENCES reward_point_events(id) ON DELETE RESTRICT;",
  );
  const pointEventsUidxIndex = schema.indexOf("reward_point_events_idempotency_key_uidx");
  expect(pointEventsTableIndex).toBeGreaterThan(-1);
  expect(pointEventsIdemIndex).toBeGreaterThan(pointEventsTableIndex);
  expect(reversalOfIndex).toBeGreaterThan(pointEventsTableIndex);
  expect(pointEventsUidxIndex).toBeGreaterThan(pointEventsIdemIndex);

  const redemptionsTableIndex = schema.indexOf("CREATE TABLE IF NOT EXISTS reward_redemptions (");
  const redemptionsIdemIndex = schema.indexOf(
    "ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;",
  );
  const versionIndex = schema.indexOf(
    "ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;",
  );
  const redemptionsUidxIndex = schema.indexOf("reward_redemptions_idempotency_key_uidx");
  const fkSwapIndex = schema.indexOf(
    "SELECT c.conname, c.confdeltype\n    INTO reward_fk_name, reward_fk_delete_action",
  );
  expect(redemptionsTableIndex).toBeGreaterThan(-1);
  expect(redemptionsIdemIndex).toBeGreaterThan(redemptionsTableIndex);
  expect(versionIndex).toBeGreaterThan(redemptionsTableIndex);
  expect(redemptionsUidxIndex).toBeGreaterThan(redemptionsIdemIndex);
  expect(fkSwapIndex).toBeGreaterThan(redemptionsTableIndex);
  expect(schema).toContain("ON DELETE RESTRICT");

  // And the inline column lists themselves must NOT declare these columns —
  // that would make the ALTER statements silently redundant on a fresh
  // database and mask this exact bug on a fresh-DB-only test run.
  const catalogTable = schema.match(
    /CREATE TABLE IF NOT EXISTS reward_catalog_items \([\s\S]*?\n\);/i,
  )?.[0];
  expect(catalogTable).not.toContain("retired_at");
  expect(catalogTable).not.toContain("retired_by");

  const pointEventsTable = schema.match(
    /CREATE TABLE IF NOT EXISTS reward_point_events \([\s\S]*?\n\);/i,
  )?.[0];
  expect(pointEventsTable).not.toContain("idempotency_key");
  expect(pointEventsTable).not.toContain("reversal_of");

  const redemptionsTable = schema.match(
    /CREATE TABLE IF NOT EXISTS reward_redemptions \([\s\S]*?\n\);/i,
  )?.[0];
  expect(redemptionsTable).not.toContain("idempotency_key");
  expect(redemptionsTable).not.toContain("version INTEGER");
});
