import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const backendRoot = resolve(import.meta.dir, "../..");
const migrationPath = resolve(
  backendRoot,
  "supabase/migrations/20260801010000_risk_first_ticket_contract.sql",
);
const legacyMigrationPath = resolve(
  backendRoot,
  "supabase/migrations/20260730000000_phase4_tickets.sql",
);

test("ticket contract migration is repeatable", () => {
  const sql = readFileSync(migrationPath, "utf8");
  expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS product_sku/i);
  expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS serial_number/i);
  expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS is_internal/i);
  expect((sql.match(/ADD COLUMN IF NOT EXISTS/gi) ?? []).length).toBe(3);

  const legacySql = readFileSync(legacyMigrationPath, "utf8");
  expect((legacySql.match(/ADD COLUMN IF NOT EXISTS/gi) ?? []).length).toBe(3);
  expect(legacySql).not.toMatch(/ADD COLUMN\s+(?!IF NOT EXISTS)/i);
});

test("canonical schema adds the ticket contract as repeatable ALTER statements after each table exists", () => {
  // db:migrate re-runs this whole file against the already-bootstrapped
  // production database on every deploy (see railway.json), so new columns
  // must land via ADD COLUMN IF NOT EXISTS after the table — CREATE TABLE
  // IF NOT EXISTS is a no-op once the table already exists.
  const schema = readFileSync(resolve(backendRoot, "db/schema.sql"), "utf8");

  const ticketTableIndex = schema.indexOf("CREATE TABLE IF NOT EXISTS support_tickets (");
  const productSkuIndex = schema.indexOf(
    "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS product_sku TEXT;",
  );
  const serialNumberIndex = schema.indexOf(
    "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS serial_number TEXT;",
  );
  expect(ticketTableIndex).toBeGreaterThan(-1);
  expect(productSkuIndex).toBeGreaterThan(ticketTableIndex);
  expect(serialNumberIndex).toBeGreaterThan(ticketTableIndex);

  const commentTableIndex = schema.indexOf("CREATE TABLE IF NOT EXISTS support_ticket_comments (");
  const isInternalIndex = schema.indexOf(
    "ALTER TABLE support_ticket_comments ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;",
  );
  expect(commentTableIndex).toBeGreaterThan(-1);
  expect(isInternalIndex).toBeGreaterThan(commentTableIndex);

  // And the inline column lists themselves must NOT declare these columns —
  // that would make the ALTER statements silently redundant on a fresh
  // database and mask this exact bug on a fresh-DB-only test run.
  const ticketTable = schema.match(
    /CREATE TABLE IF NOT EXISTS support_tickets \([\s\S]*?\n\);/i,
  )?.[0];
  expect(ticketTable).not.toContain("product_sku");
  const commentTable = schema.match(
    /CREATE TABLE IF NOT EXISTS support_ticket_comments \([\s\S]*?\n\);/i,
  )?.[0];
  expect(commentTable).not.toContain("is_internal");
});
