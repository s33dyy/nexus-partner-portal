import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createPool } from "./db";

export async function applyMigrations() {
  const pool = createPool();
  try {
    const schema = readFileSync(resolve("db/schema.sql"), "utf8");
    await pool.query(schema);
  } finally {
    await pool.end();
  }
}

// A held-open socket (observed on Railway's internal TLS Postgres connection)
// can keep the event loop alive even after pool.end() resolves and we call
// process.exit() below, so this forces termination as a last resort.
//
// It is NOT a bound on how long a migration may take, and 10s (its original
// value) was far too short to be one: db/schema.sql is ~2,000 lines and
// applying it against a cold remote Postgres routinely runs longer than that.
// Chained into railway.json's startCommand, the 10s exit(1) short-circuited
// the `&&`, the server never started, and every deploy died on a five-minute
// healthcheck timeout that gave no hint the cause was a migration. Two
// minutes distinguishes "genuinely hung" from "slow", which is all this is for.
const WATCHDOG_MS = 120_000;

if (import.meta.main) {
  const watchdog = setTimeout(() => {
    console.error(
      `[apply-migrations] watchdog: no completion after ${WATCHDOG_MS / 1000}s — forcing exit`,
    );
    process.exit(1);
  }, WATCHDOG_MS);

  applyMigrations()
    .then(() => {
      console.log("Migrations applied");
      clearTimeout(watchdog);
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      clearTimeout(watchdog);
      process.exit(1);
    });
}
