import type { QueryRunner } from "@/server/command-runtime.server";
import { pool } from "@/server/postgres.server";

/**
 * Operator-managed email delivery credentials.
 *
 * Until now the only way to give this deployment a mail provider was to set
 * RESEND_API_KEY / SENDGRID_API_KEY / EMAIL_FROM in the platform's
 * environment and redeploy. That is fine for the person who owns the Railway
 * project and useless to everybody else: an admin who can see "email delivery
 * is not configured" on three different screens had no way to fix it.
 *
 * These rows are that lever. Precedence is deliberate and the UI states it:
 *
 *   a saved key OVERRIDES the environment variable.
 *
 * The reverse (env always wins) would have made the field a decoration on any
 * deployment that had ever set the variable — which is every real one — and
 * an admin typing a key into an admin-only form is an explicit act, not an
 * accident. "Clear" removes the row and falls back to the environment, so the
 * override is always reversible without a deploy.
 *
 * SECURITY: the stored key is never returned to any client. Reads go through
 * describeEmailSettings(), which reports only whether a key exists, its last
 * four characters, and who saved it when. app_settings is not registered in
 * TABLE_COLUMNS either, so the generic supabase.from() path cannot reach it —
 * assertTable() rejects the table outright.
 */

export const EMAIL_SETTING_KEYS = {
  provider: "email.provider",
  apiKey: "email.api_key",
  fromAddress: "email.from_address",
} as const;

export type EmailProviderChoice = "resend" | "sendgrid";

export type EmailCredentialSource = "database" | "environment" | "none";

export type EmailSettingsStatus = {
  /** Whether a usable provider + key + from-address exists from any source. */
  configured: boolean;
  provider: EmailProviderChoice | null;
  /** Where the key currently in effect comes from. */
  source: EmailCredentialSource;
  /** Last four characters of the key in effect, for "is this the one I
   * pasted?" — never the key itself, and only ever four characters. */
  keyHint: string | null;
  fromAddress: string | null;
  /** True when an environment variable is present, so the UI can say that
   * clearing the saved key falls back to it rather than to nothing. */
  environmentFallbackAvailable: boolean;
  updatedAt: string | null;
};

/** Resolved credentials for an actual send. Server-only — never serialised
 * to a client. */
export type ResolvedEmailCredentials = {
  provider: EmailProviderChoice | "none";
  apiKey: string;
  fromAddress: string;
  source: EmailCredentialSource;
};

// A send is on the hot path of three separate sweeps, so the rows are cached
// briefly rather than read per message. Short enough that an admin who saves
// a key sees it take effect within a tick; saveEmailSettings() clears it
// outright, so the wait only applies to a change made in another replica.
const CACHE_TTL_MS = 30_000;

let cache: { value: Record<string, string>; expiresAt: number } | null = null;

export function clearEmailSettingsCache(): void {
  cache = null;
}

/** Injectable so a test can exercise credential precedence without a
 * database — and so an injected runner is never served, or polluted by, the
 * process-wide cache. */
export type EmailSettingsDeps = { query: QueryRunner["query"] };

async function loadStoredSettings(deps?: EmailSettingsDeps): Promise<Record<string, string>> {
  const runner = deps ?? pool;
  const now = Date.now();
  if (!deps && cache && cache.expiresAt > now) return cache.value;

  const value: Record<string, string> = {};
  try {
    const { rows } = await runner.query(
      `SELECT key, value FROM app_settings WHERE key = ANY($1::text[])`,
      [Object.values(EMAIL_SETTING_KEYS)],
    );
    for (const row of rows as Array<{ key: string; value: string }>) {
      if (row.value) value[row.key] = row.value;
    }
  } catch (error) {
    // A database that is down must not turn "send a reminder" into a crash.
    // Falling back to the environment is the pre-existing behaviour, so the
    // worst case here is exactly what shipped before this module existed.
    console.error("[email-settings] could not read stored credentials", error);
    return {};
  }

  if (!deps) cache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

function envProvider(): { provider: EmailProviderChoice | null; apiKey: string } {
  const resend = process.env.RESEND_API_KEY?.trim() ?? "";
  if (resend) return { provider: "resend", apiKey: resend };
  const sendgrid = process.env.SENDGRID_API_KEY?.trim() ?? "";
  if (sendgrid) return { provider: "sendgrid", apiKey: sendgrid };
  return { provider: null, apiKey: "" };
}

function isProviderChoice(value: string): value is EmailProviderChoice {
  return value === "resend" || value === "sendgrid";
}

export async function resolveEmailCredentials(
  deps?: EmailSettingsDeps,
): Promise<ResolvedEmailCredentials> {
  const stored = await loadStoredSettings(deps);
  const env = envProvider();

  const storedKey = stored[EMAIL_SETTING_KEYS.apiKey]?.trim() ?? "";
  const storedProviderRaw = stored[EMAIL_SETTING_KEYS.provider]?.trim() ?? "";
  const storedProvider = isProviderChoice(storedProviderRaw) ? storedProviderRaw : null;

  // The from-address falls back independently of the key: an operator may
  // want to override only the sender identity, or only the key.
  const fromAddress =
    stored[EMAIL_SETTING_KEYS.fromAddress]?.trim() || (process.env.EMAIL_FROM?.trim() ?? "");

  if (storedKey && storedProvider) {
    return { provider: storedProvider, apiKey: storedKey, fromAddress, source: "database" };
  }
  if (env.provider && env.apiKey) {
    return { provider: env.provider, apiKey: env.apiKey, fromAddress, source: "environment" };
  }
  return { provider: "none", apiKey: "", fromAddress, source: "none" };
}

export async function describeEmailSettings(
  deps?: EmailSettingsDeps,
): Promise<EmailSettingsStatus> {
  const stored = await loadStoredSettings(deps);
  const resolved = await resolveEmailCredentials(deps);
  const env = envProvider();

  let updatedAt: string | null = null;
  try {
    const { rows } = await (deps ?? pool).query(
      `SELECT MAX(updated_at) AS updated_at FROM app_settings WHERE key = ANY($1::text[])`,
      [Object.values(EMAIL_SETTING_KEYS)],
    );
    const raw = (rows[0] as { updated_at: Date | string | null } | undefined)?.updated_at ?? null;
    if (raw) {
      const date = raw instanceof Date ? raw : new Date(raw);
      updatedAt = Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
  } catch {
    updatedAt = null;
  }

  const hasStoredKey = !!stored[EMAIL_SETTING_KEYS.apiKey]?.trim();

  return {
    configured: resolved.provider !== "none" && !!resolved.fromAddress,
    provider: resolved.provider === "none" ? null : resolved.provider,
    source: resolved.source,
    keyHint: resolved.apiKey ? resolved.apiKey.slice(-4) : null,
    fromAddress: resolved.fromAddress || null,
    environmentFallbackAvailable: !!env.provider && !!env.apiKey,
    updatedAt: hasStoredKey ? updatedAt : null,
  };
}

export type SaveEmailSettingsInput = {
  provider: EmailProviderChoice;
  /** Omit or pass null to leave the stored key untouched — so an admin can
   * change the from-address without re-pasting a key they cannot read back. */
  apiKey?: string | null;
  fromAddress: string;
};

export type SaveEmailSettingsResult =
  | { ok: true; status: EmailSettingsStatus }
  | { ok: false; error: string };

async function upsertSetting(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function saveEmailSettings(
  input: SaveEmailSettingsInput,
): Promise<SaveEmailSettingsResult> {
  if (!isProviderChoice(input.provider)) {
    return { ok: false, error: "Pick a supported provider" };
  }

  const fromAddress = input.fromAddress.trim();
  if (!EMAIL_RE.test(fromAddress)) {
    return { ok: false, error: "Enter the address messages should come from" };
  }

  const apiKey = input.apiKey?.trim() ?? "";
  if (apiKey) {
    // Not a format check against either provider's scheme — those change, and
    // guessing wrong would reject a valid key. This only catches a paste that
    // obviously went wrong.
    if (apiKey.length < 12) {
      return { ok: false, error: "That key looks too short to be valid" };
    }
    await upsertSetting(EMAIL_SETTING_KEYS.apiKey, apiKey);
  } else {
    const existing = await loadStoredSettings();
    if (!existing[EMAIL_SETTING_KEYS.apiKey]) {
      return { ok: false, error: "Paste the provider API key to finish setting this up" };
    }
  }

  await upsertSetting(EMAIL_SETTING_KEYS.provider, input.provider);
  await upsertSetting(EMAIL_SETTING_KEYS.fromAddress, fromAddress);

  clearEmailSettingsCache();
  return { ok: true, status: await describeEmailSettings() };
}

/** Removes the saved override so delivery falls back to the environment. */
export async function clearEmailSettings(): Promise<EmailSettingsStatus> {
  await pool.query(`DELETE FROM app_settings WHERE key = ANY($1::text[])`, [
    Object.values(EMAIL_SETTING_KEYS),
  ]);
  clearEmailSettingsCache();
  return describeEmailSettings();
}
