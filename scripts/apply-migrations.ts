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
  applyMigrations()
    .then(() => {
      console.log("Migrations applied");
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
