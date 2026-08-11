import "../src/lib/load-env";

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

if (import.meta.main) {
  // A held-open socket (observed on Railway's internal TLS Postgres connection)
  // can keep the event loop alive even after pool.end() resolves and we call
  // process.exit() below, so force termination as a last resort.
  const watchdog = setTimeout(() => {
    console.error("[apply-migrations] watchdog: forcing exit after timeout");
    process.exit(1);
  }, 10_000);

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
