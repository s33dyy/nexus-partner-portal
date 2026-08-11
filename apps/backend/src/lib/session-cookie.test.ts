import { expect, test } from "bun:test";

import {
  clearSessionCookie,
  publicSession,
  readSessionToken,
  sessionCookie,
} from "@/lib/session-cookie";

test("session cookie is HttpOnly, SameSite=Lax, and scoped to the API root", () => {
  const expiresAt = new Date("2026-08-12T00:00:00.000Z");
  const cookie = sessionCookie("secret-token", expiresAt, { secure: true });

  expect(cookie).toContain("livey_session=secret-token");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Path=/");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("Expires=Wed, 12 Aug 2026 00:00:00 GMT");
});

test("request authentication prefers the HttpOnly session cookie", () => {
  const request = new Request("https://api.example.test/api/auth/session", {
    headers: {
      cookie: "other=value; livey_session=cookie-token",
      authorization: "Bearer legacy-token",
    },
  });

  expect(readSessionToken(request)).toBe("cookie-token");
});

test("request authentication keeps bearer fallback for trusted non-browser callers", () => {
  const request = new Request("https://api.example.test/api/auth/session", {
    headers: { authorization: "Bearer service-token" },
  });

  expect(readSessionToken(request)).toBe("service-token");
});

test("clearing the session cookie immediately expires the same cookie", () => {
  const cookie = clearSessionCookie({ secure: true });
  expect(cookie).toContain("livey_session=");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Max-Age=0");
  expect(cookie).toContain("Path=/");
  expect(cookie).toContain("Secure");
});

test("browser session payload never exposes the reusable token", () => {
  const session = publicSession({
    access_token: "never-send-this",
    expires_at: 1_786_493_600,
    user: {
      id: "user-1",
      email: "person@example.test",
      user_metadata: { full_name: "Person", phone: null, company_name: null },
    },
  });

  expect(session).toEqual({
    expires_at: 1_786_493_600,
    user: {
      id: "user-1",
      email: "person@example.test",
      user_metadata: { full_name: "Person", phone: null, company_name: null },
    },
  });
  expect(JSON.stringify(session)).not.toContain("never-send-this");
});
