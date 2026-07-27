import { expect, test } from "bun:test";

import { validatePasswordChange } from "@/lib/password-policy";

test("rejects weak passwords", () => {
  expect(validatePasswordChange({ password: "password", confirmPassword: "password" })).toEqual({
    ok: false,
    message: "Password must include upper, lower, number, and symbol characters",
  });
});

test("rejects mismatched confirmation", () => {
  expect(validatePasswordChange({ password: "Stronger1!", confirmPassword: "Stronger2!" })).toEqual(
    {
      ok: false,
      message: "Passwords do not match",
    },
  );
});

test("accepts strong matching passwords", () => {
  expect(validatePasswordChange({ password: "Stronger1!", confirmPassword: "Stronger1!" })).toEqual(
    {
      ok: true,
      message: null,
    },
  );
});
