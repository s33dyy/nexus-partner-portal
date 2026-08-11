import { expect, test } from "bun:test";

import { generateTemporaryPassword } from "@/lib/temp-password";

test("generateTemporaryPassword returns a mixed-character password", () => {
  const password = generateTemporaryPassword();

  expect(password.length).toBeGreaterThanOrEqual(14);
  expect(password).toMatch(/[A-Z]/);
  expect(password).toMatch(/[a-z]/);
  expect(password).toMatch(/[0-9]/);
});

test("generateTemporaryPassword can honor a longer requested length", () => {
  const password = generateTemporaryPassword(20);

  expect(password).toHaveLength(20);
});
