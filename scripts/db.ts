import { Pool } from "pg";

export function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL");
  }

  let ssl: false | { rejectUnauthorized: boolean } = false;
  if (process.env.PGSSLMODE !== "disable") {
    try {
      const url = new URL(connectionString);
      if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
        ssl = { rejectUnauthorized: false };
      }
    } catch {
      ssl = false;
    }
  }

  return new Pool({
    connectionString,
    ssl,
  });
}
