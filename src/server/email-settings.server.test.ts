import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  EMAIL_SETTING_KEYS,
  clearEmailSettingsCache,
  describeEmailSettings,
  resolveEmailCredentials,
} from "@/server/email-settings.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

const ENV_KEYS = ["RESEND_API_KEY", "SENDGRID_API_KEY", "EMAIL_FROM"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  clearEmailSettingsCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  clearEmailSettingsCache();
});

/** Stands in for app_settings. Injected, so these never touch a database and
 * never share the module-level cache. */
function storedRows(values: Record<string, string>) {
  const rows = Object.entries(values).map(([key, value]) => ({ key, value }));
  return {
    query: async (sql: string) => {
      if (sql.includes("MAX(updated_at)")) {
        return { rows: [{ updated_at: "2026-08-29T10:00:00.000Z" }], rowCount: 1 };
      }
      return { rows, rowCount: rows.length };
    },
  };
}

describe("credential precedence", () => {
  test("a saved key overrides the environment variable", async () => {
    process.env.RESEND_API_KEY = "re_from_env";
    process.env.EMAIL_FROM = "env@livey.test";

    const resolved = await resolveEmailCredentials(
      storedRows({
        [EMAIL_SETTING_KEYS.provider]: "sendgrid",
        [EMAIL_SETTING_KEYS.apiKey]: "SG.from_database",
        [EMAIL_SETTING_KEYS.fromAddress]: "saved@livey.test",
      }),
    );

    expect(resolved).toMatchObject({
      provider: "sendgrid",
      apiKey: "SG.from_database",
      fromAddress: "saved@livey.test",
      source: "database",
    });
  });

  test("falls back to the environment when nothing is saved", async () => {
    process.env.RESEND_API_KEY = "re_from_env";
    process.env.EMAIL_FROM = "env@livey.test";

    const resolved = await resolveEmailCredentials(storedRows({}));
    expect(resolved).toMatchObject({ provider: "resend", source: "environment" });
  });

  test("a saved key with no provider row is not usable, so the environment still wins", async () => {
    process.env.SENDGRID_API_KEY = "SG.from_env";
    process.env.EMAIL_FROM = "env@livey.test";

    const resolved = await resolveEmailCredentials(
      storedRows({ [EMAIL_SETTING_KEYS.apiKey]: "orphaned_key" }),
    );
    expect(resolved.source).toBe("environment");
  });

  test("an unrecognised stored provider is ignored rather than sent to a provider that does not exist", async () => {
    const resolved = await resolveEmailCredentials(
      storedRows({
        [EMAIL_SETTING_KEYS.provider]: "mailchimp",
        [EMAIL_SETTING_KEYS.apiKey]: "mc_key_123456",
        [EMAIL_SETTING_KEYS.fromAddress]: "saved@livey.test",
      }),
    );
    expect(resolved.provider).toBe("none");
  });

  test("the from-address falls back independently of the key", async () => {
    process.env.EMAIL_FROM = "env@livey.test";
    const resolved = await resolveEmailCredentials(
      storedRows({
        [EMAIL_SETTING_KEYS.provider]: "resend",
        [EMAIL_SETTING_KEYS.apiKey]: "re_saved_key_1234",
      }),
    );
    expect(resolved).toMatchObject({ source: "database", fromAddress: "env@livey.test" });
  });

  test("a database that is unreachable degrades to the environment instead of throwing", async () => {
    process.env.RESEND_API_KEY = "re_from_env";
    process.env.EMAIL_FROM = "env@livey.test";

    const resolved = await resolveEmailCredentials({
      query: async () => {
        throw new Error("connection refused");
      },
    });
    expect(resolved).toMatchObject({ provider: "resend", source: "environment" });
  });
});

describe("describeEmailSettings never leaks the key", () => {
  test("reports only the last four characters", async () => {
    const status = await describeEmailSettings(
      storedRows({
        [EMAIL_SETTING_KEYS.provider]: "resend",
        [EMAIL_SETTING_KEYS.apiKey]: "re_super_secret_value_WXYZ",
        [EMAIL_SETTING_KEYS.fromAddress]: "saved@livey.test",
      }),
    );

    expect(status.keyHint).toBe("WXYZ");
    expect(status.configured).toBe(true);
    expect(status.source).toBe("database");
    // The whole serialised status is what crosses the wire to the browser.
    expect(JSON.stringify(status)).not.toContain("re_super_secret_value");
  });

  test("says an environment fallback exists so the UI can explain what Remove does", async () => {
    process.env.RESEND_API_KEY = "re_from_env";
    process.env.EMAIL_FROM = "env@livey.test";

    const status = await describeEmailSettings(
      storedRows({
        [EMAIL_SETTING_KEYS.provider]: "resend",
        [EMAIL_SETTING_KEYS.apiKey]: "re_saved_key_5678",
        [EMAIL_SETTING_KEYS.fromAddress]: "saved@livey.test",
      }),
    );
    expect(status.environmentFallbackAvailable).toBe(true);
  });

  test("a provider with no from-address anywhere is not 'configured'", async () => {
    const status = await describeEmailSettings(
      storedRows({
        [EMAIL_SETTING_KEYS.provider]: "resend",
        [EMAIL_SETTING_KEYS.apiKey]: "re_saved_key_9999",
      }),
    );
    expect(status.configured).toBe(false);
  });
});
