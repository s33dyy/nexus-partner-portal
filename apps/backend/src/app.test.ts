import { expect, test } from "bun:test";

import { app } from "@/app";

test("unexpected backend errors are logged server-side but masked from clients", async () => {
  const response = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not-valid-json",
  });

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ message: "Internal server error" });
});
