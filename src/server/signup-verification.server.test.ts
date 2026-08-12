import { afterEach, beforeEach, expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://localhost/test";

const TWILIO_KEYS = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_VERIFY_SERVICE_SID",
] as const;
const originalEnv = Object.fromEntries(TWILIO_KEYS.map((key) => [key, process.env[key]]));

function configureTwilio() {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "token_test";
  process.env.TWILIO_VERIFY_SERVICE_SID = "VA_test";
}

function unconfigureTwilio() {
  for (const key of TWILIO_KEYS) delete process.env[key];
}

afterEach(() => {
  for (const key of TWILIO_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

/**
 * Replaces pool.query with a recorder driven by simple SQL matching, plus a
 * stub for the two Twilio Verify calls. Returns everything the assertions
 * need to prove ordering — specifically that no profile row is written before
 * a code is approved.
 */
async function installHarness(input: {
  existingEmail?: boolean;
  existingPhone?: boolean;
  verificationStatus?: string;
  verifyThrows?: boolean;
}) {
  const { pool } = await import("@/server/postgres.server");
  const originalQuery = pool.query.bind(pool);
  const sqlLog: string[] = [];
  const twilioCalls: string[] = [];

  pool.query = (async (sql: string, params: unknown[] = []) => {
    const text = String(sql);
    sqlLog.push(text);
    if (text.includes("WHERE lower(email)")) {
      return { rows: input.existingEmail ? [{ id: "existing-user" }] : [], rowCount: 0 } as never;
    }
    if (text.includes("whatsapp_phone_e164 = $1")) {
      return { rows: input.existingPhone ? [{ id: "other-user" }] : [], rowCount: 0 } as never;
    }
    void params;
    return { rows: [], rowCount: 0 } as never;
  }) as typeof pool.query;

  const deps = {
    startVerification: async () => {
      twilioCalls.push("start");
      return {};
    },
    checkVerification: async () => {
      twilioCalls.push("check");
      if (input.verifyThrows) throw new Error("twilio unavailable");
      return { status: input.verificationStatus ?? "approved" };
    },
  };

  return {
    sqlLog,
    twilioCalls,
    deps,
    restore: () => {
      pool.query = originalQuery as typeof pool.query;
    },
  };
}

beforeEach(async () => {
  const { __resetSignupRateLimit } = await import("@/server/signup-verification.server");
  __resetSignupRateLimit();
});

test("isSignupVerificationRequired reflects whether Twilio Verify is actually configured", async () => {
  const { isSignupVerificationRequired } = await import("@/server/signup-verification.server");

  unconfigureTwilio();
  expect(isSignupVerificationRequired()).toBe(false);

  configureTwilio();
  expect(isSignupVerificationRequired()).toBe(true);

  // A partial config (no Verify service) still can't send a code, so signup
  // must not demand one.
  delete process.env.TWILIO_VERIFY_SERVICE_SID;
  expect(isSignupVerificationRequired()).toBe(false);
});

test("an unconfigured deployment reports required:false instead of blocking registration", async () => {
  unconfigureTwilio();
  const harness = await installHarness({});
  try {
    const { requestSignupPhoneVerification } = await import("@/server/signup-verification.server");
    const result = await requestSignupPhoneVerification(
      { email: "new@livey.test", phoneE164: "+919876543210" },
      harness.deps,
    );
    expect(result.required).toBe(false);
    expect(harness.twilioCalls).toEqual([]);
  } finally {
    harness.restore();
  }
});

test("a taken email or phone is rejected before any SMS is paid for", async () => {
  configureTwilio();

  const emailTaken = await installHarness({ existingEmail: true });
  try {
    const { requestSignupPhoneVerification } = await import("@/server/signup-verification.server");
    await expect(
      requestSignupPhoneVerification(
        { email: "taken@livey.test", phoneE164: "+919876543210" },
        emailTaken.deps,
      ),
    ).rejects.toThrow(/already exists/i);
    expect(emailTaken.twilioCalls).toEqual([]);
  } finally {
    emailTaken.restore();
  }

  const phoneTaken = await installHarness({ existingPhone: true });
  try {
    const { requestSignupPhoneVerification } = await import("@/server/signup-verification.server");
    await expect(
      requestSignupPhoneVerification(
        { email: "new@livey.test", phoneE164: "+919876543210" },
        phoneTaken.deps,
      ),
    ).rejects.toThrow(/already registered/i);
    expect(phoneTaken.twilioCalls).toEqual([]);
  } finally {
    phoneTaken.restore();
  }
});

test("a non-E164 number is rejected before any SMS is paid for", async () => {
  configureTwilio();
  const harness = await installHarness({});
  try {
    const { requestSignupPhoneVerification } = await import("@/server/signup-verification.server");
    await expect(
      requestSignupPhoneVerification(
        { email: "new@livey.test", phoneE164: "9876543210" },
        harness.deps,
      ),
    ).rejects.toThrow(/international format/i);
    expect(harness.twilioCalls).toEqual([]);
  } finally {
    harness.restore();
  }
});

test("code sends are rate limited per number, so signup can't be used as an SMS pump", async () => {
  configureTwilio();
  const harness = await installHarness({});
  try {
    const { requestSignupPhoneVerification } = await import("@/server/signup-verification.server");
    const send = () =>
      requestSignupPhoneVerification(
        { email: "new@livey.test", phoneE164: "+919876543210" },
        harness.deps,
      );

    await send();
    await send();
    await send();
    await expect(send()).rejects.toThrow(/too many codes/i);
    expect(harness.twilioCalls.filter((call) => call === "start")).toHaveLength(3);

    // A different number has its own allowance.
    await requestSignupPhoneVerification(
      { email: "new@livey.test", phoneE164: "+919876543211" },
      harness.deps,
    );
    expect(harness.twilioCalls.filter((call) => call === "start")).toHaveLength(4);
  } finally {
    harness.restore();
  }
});

// The whole point of the feature: an unverified phone must never end up
// attached to a real account.
test("a wrong code creates no account at all", async () => {
  configureTwilio();
  const harness = await installHarness({ verificationStatus: "pending" });
  try {
    const { verifyAndSignUp } = await import("@/server/signup-verification.server");
    await expect(
      verifyAndSignUp(
        {
          full_name: "Ananya Rao",
          email: "new@livey.test",
          phone: "+919876543210",
          company_name: "Harbor Logistics",
          password: "correct-horse-battery",
          code: "000000",
        },
        harness.deps,
      ),
    ).rejects.toThrow(/incorrect or expired/i);

    // Twilio was consulted, and nothing was inserted afterwards.
    expect(harness.twilioCalls).toContain("check");
    expect(harness.sqlLog.some((sql) => sql.includes("INSERT INTO profiles"))).toBe(false);
  } finally {
    harness.restore();
  }
});

test("a missing code is refused before Twilio is even called", async () => {
  configureTwilio();
  const harness = await installHarness({});
  try {
    const { verifyAndSignUp } = await import("@/server/signup-verification.server");
    await expect(
      verifyAndSignUp(
        {
          full_name: "Ananya Rao",
          email: "new@livey.test",
          phone: "+919876543210",
          company_name: "Harbor Logistics",
          password: "correct-horse-battery",
          code: "   ",
        },
        harness.deps,
      ),
    ).rejects.toThrow(/enter the verification code/i);
    expect(harness.twilioCalls).toEqual([]);
    expect(harness.sqlLog.some((sql) => sql.includes("INSERT INTO profiles"))).toBe(false);
  } finally {
    harness.restore();
  }
});

test("a phone claimed between step 1 and step 2 still blocks account creation", async () => {
  configureTwilio();
  const harness = await installHarness({ existingPhone: true });
  try {
    const { verifyAndSignUp } = await import("@/server/signup-verification.server");
    await expect(
      verifyAndSignUp(
        {
          full_name: "Ananya Rao",
          email: "new@livey.test",
          phone: "+919876543210",
          company_name: "Harbor Logistics",
          password: "correct-horse-battery",
          code: "123456",
        },
        harness.deps,
      ),
    ).rejects.toThrow(/already registered/i);
    expect(harness.sqlLog.some((sql) => sql.includes("INSERT INTO profiles"))).toBe(false);
  } finally {
    harness.restore();
  }
});
