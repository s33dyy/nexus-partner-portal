import { expect, test } from "bun:test";

import { redactLogValue } from "./telemetry";

test("structured log redaction removes sensitive fields and token-like strings", () => {
  const redacted = redactLogValue({
    password: "secret",
    nested: {
      access_token: "abc123",
      note: "keep this",
    },
    raw: "this-is-a-very-long-token-string-that-should-not-leak-123456",
  }) as Record<string, unknown>;

  expect(redacted.password).toBe("[REDACTED]");
  expect((redacted.nested as Record<string, unknown>).access_token).toBe("[REDACTED]");
  expect(redacted.raw).toBe("[REDACTED]");
});
