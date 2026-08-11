import { expect, test } from "bun:test";

import { app } from "@/app";
import { pool } from "@/server/postgres.server";

test("unexpected backend errors are logged server-side but masked from clients", async () => {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-valid-json",
  });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ message: "Internal server error" });
});

test("login does not expose infrastructure errors as credential failures", async () => {
  const originalQuery = pool.query.bind(pool);
  pool.query = (async () => {
    throw new Error("database connection string leaked");
  }) as typeof pool.query;

  try {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "person@example.com", password: "wrong-password" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Invalid email or password" });
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});
