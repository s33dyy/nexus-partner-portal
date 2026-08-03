import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://localhost/test";
process.env.GOOGLE_CLIENT_ID ??= "google-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "google-client-secret";

const STATE = "test-state-value";
const STATE_COOKIE_HEADER = `google_oauth_state=${STATE}`;

type FakeProfileRow = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  company_name: string | null;
  google_id: string | null;
};

function sessionRow(profile: FakeProfileRow) {
  return {
    token_hash: "hash",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    revoked_at: null,
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    phone: profile.phone,
    company_name: profile.company_name,
  };
}

function installFakePool(input: {
  loggedInAs?: FakeProfileRow;
  profileByGoogleId?: FakeProfileRow | null;
  profileByEmail?: FakeProfileRow | null;
}) {
  const observed: Array<{ sql: string; params: unknown[] }> = [];

  const insertedProfiles: FakeProfileRow[] = [];

  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const originalQuery = pool.query.bind(pool);

    pool.query = (async (sql: string, params: unknown[] = []) => {
      const text = String(sql);
      observed.push({ sql: text, params });

      if (
        text.includes("FROM sessions s") &&
        text.includes("JOIN profiles p ON p.id = s.user_id")
      ) {
        if (!input.loggedInAs) return { rows: [], rowCount: 0 } as never;
        return { rows: [sessionRow(input.loggedInAs)], rowCount: 1 } as never;
      }
      if (text.includes("SELECT role FROM user_roles WHERE user_id = $1")) {
        return { rows: [{ role: "partner_admin" }], rowCount: 1 } as never;
      }
      if (text.includes("INSERT INTO profiles")) {
        // Matches findOrCreateUserForGoogle's exact column order: (id, email,
        // password_hash, full_name, partner_status, google_id, google_email,
        // google_linked_at) with partner_status/now() as literals, not params
        // — so params are [id, email, passwordHash, fullName, googleSub, googleEmail].
        insertedProfiles.push({
          id: String(params[0]),
          email: String(params[1]),
          full_name: String(params[3]),
          phone: null,
          company_name: null,
          google_id: String(params[4]),
        });
        return { rows: [], rowCount: 1 } as never;
      }
      if (text.includes("FROM profiles WHERE id = $1 LIMIT 1")) {
        const id = params[0];
        const match = [
          input.loggedInAs,
          input.profileByGoogleId,
          input.profileByEmail,
          ...insertedProfiles,
        ].find((row) => row?.id === id);
        if (!match) return { rows: [], rowCount: 0 } as never;
        return {
          rows: [
            {
              id: match.id,
              email: match.email,
              full_name: match.full_name,
              phone: match.phone,
              company_name: match.company_name,
              password_hash: "hash",
              avatar_url: null,
              partner_id: null,
              partner_status: "pending_partner_registration",
              must_reset_password: false,
            },
          ],
          rowCount: 1,
        } as never;
      }
      if (text.includes("FROM profiles WHERE google_id = $1 LIMIT 1")) {
        if (!input.profileByGoogleId) return { rows: [], rowCount: 0 } as never;
        return { rows: [{ id: input.profileByGoogleId.id }], rowCount: 1 } as never;
      }
      if (text.includes("WHERE lower(email) = lower($1) LIMIT 1")) {
        if (!input.profileByEmail) return { rows: [], rowCount: 0 } as never;
        return {
          rows: [{ id: input.profileByEmail.id, google_id: input.profileByEmail.google_id }],
          rowCount: 1,
        } as never;
      }
      // INSERT/UPDATE INTO profiles/user_roles/sessions/assignments/active_contexts
      // all just need to succeed without asserting on their exact shape here —
      // dedicated tests below assert on the specific ones that matter.
      return { rows: [], rowCount: 1 } as never;
    }) as typeof pool.query;

    return {
      observed,
      restore: () => {
        pool.query = originalQuery as typeof pool.query;
      },
    };
  };
}

function installFakeGoogleFetch(userInfo: {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fake-access-token" }), { status: 200 });
    }
    if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
      return new Response(JSON.stringify(userInfo), { status: 200 });
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function callbackRequest(query: string, cookieHeader: string): Request {
  return new Request(`http://localhost/api/auth/google/callback?${query}`, {
    headers: { cookie: cookieHeader },
  });
}

test("Google callback rejects a missing authorization code", async () => {
  const harness = await installFakePool({})();
  try {
    const { handleGoogleCallback } = await import("@/server/google-oauth.server");
    const response = await handleGoogleCallback(
      callbackRequest(`state=${STATE}`, STATE_COOKIE_HEADER),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("/auth?googleError=");
  } finally {
    harness.restore();
  }
});

test("Google callback rejects a state mismatch (CSRF guard)", async () => {
  const harness = await installFakePool({})();
  try {
    const { handleGoogleCallback } = await import("@/server/google-oauth.server");
    const response = await handleGoogleCallback(
      callbackRequest("code=auth-code&state=wrong-state", STATE_COOKIE_HEADER),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("/auth?googleError=");
    expect(decodeURIComponent(response.headers.get("Location") ?? "")).toContain(
      "Invalid OAuth state",
    );
  } finally {
    harness.restore();
  }
});

test("Google callback logs in an existing user matched by google_id", async () => {
  const existing: FakeProfileRow = {
    id: "user-1",
    email: "existing@example.com",
    full_name: "Existing User",
    phone: null,
    company_name: null,
    google_id: "google-sub-1",
  };
  const harness = await installFakePool({ profileByGoogleId: existing })();
  const restoreFetch = installFakeGoogleFetch({
    sub: "google-sub-1",
    email: "existing@example.com",
    email_verified: true,
    name: "Existing User",
  });
  try {
    const { handleGoogleCallback } = await import("@/server/google-oauth.server");
    const response = await handleGoogleCallback(
      callbackRequest("code=auth-code&state=" + STATE, STATE_COOKIE_HEADER),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("http://localhost/dashboard");
    const setCookies = response.headers.getSetCookie?.() ?? [];
    expect(setCookies.some((cookie) => cookie.startsWith("livey_session="))).toBe(true);
  } finally {
    harness.restore();
    restoreFetch();
  }
});

test("Google callback auto-links an existing password account on its first Google login (verified email)", async () => {
  const existing: FakeProfileRow = {
    id: "user-2",
    email: "passwordfirst@example.com",
    full_name: "Password First",
    phone: null,
    company_name: null,
    google_id: null,
  };
  const harness = await installFakePool({ profileByEmail: existing })();
  const restoreFetch = installFakeGoogleFetch({
    sub: "google-sub-2",
    email: "passwordfirst@example.com",
    email_verified: true,
    name: "Password First",
  });
  try {
    const { handleGoogleCallback } = await import("@/server/google-oauth.server");
    const response = await handleGoogleCallback(
      callbackRequest("code=auth-code&state=" + STATE, STATE_COOKIE_HEADER),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("http://localhost/dashboard");

    const linkQuery = harness.observed.find((entry) =>
      entry.sql.includes("SET google_id = $1, google_email = $2, google_linked_at = now()"),
    );
    expect(linkQuery?.params).toEqual(["google-sub-2", "passwordfirst@example.com", "user-2"]);
  } finally {
    harness.restore();
    restoreFetch();
  }
});

test("Google callback refuses to steal an email match already linked to a different Google account", async () => {
  const existing: FakeProfileRow = {
    id: "user-3",
    email: "alreadylinked@example.com",
    full_name: "Already Linked",
    phone: null,
    company_name: null,
    google_id: "some-other-google-sub",
  };
  const harness = await installFakePool({ profileByEmail: existing })();
  const restoreFetch = installFakeGoogleFetch({
    sub: "a-new-google-sub",
    email: "alreadylinked@example.com",
    email_verified: true,
    name: "Already Linked",
  });
  try {
    const { handleGoogleCallback } = await import("@/server/google-oauth.server");
    const response = await handleGoogleCallback(
      callbackRequest("code=auth-code&state=" + STATE, STATE_COOKIE_HEADER),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("/auth?googleError=");
    expect(decodeURIComponent(response.headers.get("Location") ?? "")).toContain(
      "already linked to a different Google account",
    );
  } finally {
    harness.restore();
    restoreFetch();
  }
});

test("Google callback creates a brand-new self-registered account when nothing matches", async () => {
  const harness = await installFakePool({})();
  const restoreFetch = installFakeGoogleFetch({
    sub: "brand-new-sub",
    email: "newperson@example.com",
    email_verified: true,
    name: "New Person",
  });
  try {
    const { handleGoogleCallback } = await import("@/server/google-oauth.server");
    const response = await handleGoogleCallback(
      callbackRequest("code=auth-code&state=" + STATE, STATE_COOKIE_HEADER),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("http://localhost/dashboard");

    const profileInsert = harness.observed.find((entry) =>
      entry.sql.includes("INSERT INTO profiles"),
    );
    expect(profileInsert?.params).toContain("newperson@example.com");
    expect(profileInsert?.params).toContain("brand-new-sub");

    const roleInsert = harness.observed.find((entry) =>
      entry.sql.includes("INSERT INTO user_roles"),
    );
    // role is a literal in the SQL text, not a bound param.
    expect(roleInsert?.sql).toContain("'partner_admin'");

    const assignmentInsert = harness.observed.find((entry) =>
      entry.sql.includes("INSERT INTO assignments"),
    );
    expect(assignmentInsert?.params).toContain("google_self_registration");
  } finally {
    harness.restore();
    restoreFetch();
  }
});

test("Google callback links the current session's account when Settings' Connect flow is used", async () => {
  const currentUser: FakeProfileRow = {
    id: "user-4",
    email: "loggedin@example.com",
    full_name: "Logged In",
    phone: null,
    company_name: null,
    google_id: null,
  };
  const harness = await installFakePool({ loggedInAs: currentUser })();
  const restoreFetch = installFakeGoogleFetch({
    sub: "google-sub-4",
    email: "loggedin.personal@gmail.com",
    email_verified: true,
    name: "Logged In",
  });
  try {
    const { handleGoogleCallback } = await import("@/server/google-oauth.server");
    const response = await handleGoogleCallback(
      callbackRequest(
        "code=auth-code&state=" + STATE,
        `${STATE_COOKIE_HEADER}; livey_session=current-session-token`,
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("http://localhost/settings?googleConnected=1");

    const linkQuery = harness.observed.find((entry) =>
      entry.sql.includes("SET google_id = $1, google_email = $2, google_linked_at = now()"),
    );
    expect(linkQuery?.params).toEqual(["google-sub-4", "loggedin.personal@gmail.com", "user-4"]);

    // Link mode must never create a new session — the user is already logged in.
    const sessionInsert = harness.observed.find((entry) =>
      entry.sql.includes("INSERT INTO sessions"),
    );
    expect(sessionInsert).toBeUndefined();
  } finally {
    harness.restore();
    restoreFetch();
  }
});

test("Google callback in link mode refuses to connect a Google account already linked elsewhere", async () => {
  const currentUser: FakeProfileRow = {
    id: "user-5",
    email: "linkattempt@example.com",
    full_name: "Link Attempt",
    phone: null,
    company_name: null,
    google_id: null,
  };
  const harness = await installFakePool({
    loggedInAs: currentUser,
    profileByGoogleId: {
      id: "someone-else",
      email: "other@example.com",
      full_name: "Someone Else",
      phone: null,
      company_name: null,
      google_id: "contested-google-sub",
    },
  })();
  const restoreFetch = installFakeGoogleFetch({
    sub: "contested-google-sub",
    email: "other@example.com",
    email_verified: true,
    name: "Someone Else",
  });
  try {
    const { handleGoogleCallback } = await import("@/server/google-oauth.server");
    const response = await handleGoogleCallback(
      callbackRequest(
        "code=auth-code&state=" + STATE,
        `${STATE_COOKIE_HEADER}; livey_session=current-session-token`,
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("/settings?googleError=");
    expect(decodeURIComponent(response.headers.get("Location") ?? "")).toContain(
      "already connected to a different LIVEY account",
    );
  } finally {
    harness.restore();
    restoreFetch();
  }
});

// No test for handleGoogleConnect's happy path here — GOOGLE_CLIENT_ID is
// read into a module-level const at import time (matching zoho-api.server.ts's
// own CLIENT_ID pattern), and Bun's test runner shares one module registry
// across every test file in a run. zoho-api.server.test.ts's own tests
// already import "@/server" (which now transitively imports this module)
// without ever setting GOOGLE_CLIENT_ID, so whichever file's import runs
// first in the shared process decides the cached value for the whole run —
// exactly why zoho-api.server.test.ts itself never tests handleZohoConnect's
// analogous "happy path" either. The callback handler's real logic (every
// branch below) doesn't depend on CLIENT_ID being non-empty, so it isn't
// affected by this.
