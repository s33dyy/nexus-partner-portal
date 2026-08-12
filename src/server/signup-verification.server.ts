import { pool } from "@/server/postgres.server";
import {
  checkWhatsappVerification,
  isValidE164,
  isWhatsappVerificationConfigured,
  startWhatsappVerification,
} from "@/server/twilio.server";

// Phone verification during account creation.
//
// The existing WhatsApp linking flow (requestWhatsappLink/confirmWhatsappLink
// in twilio.server.ts) verifies a number for an ALREADY authenticated user,
// so it can lean on the session for both identity and abuse control. This
// module covers the harder case: an anonymous visitor, before any account
// exists, on an endpoint that costs real money every time it is called.
//
// Two invariants drive the design:
//
//  1. No profile row is written until the code checks out. verifyAndSignUp()
//     calls Twilio first and only then touches the database, so a failed or
//     abandoned verification leaves nothing behind to clean up — and there is
//     no window in which an unverified account exists.
//  2. An unconfigured Twilio must not brick signup. isSignupVerificationRequired()
//     reports what the environment can actually do, and the client asks before
//     it decides which flow to render.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;

type RateEntry = { count: number; windowStart: number };

// Per-process, in-memory. That is the right scope here: this app deploys as a
// single always-on service, and the expensive thing being limited (an SMS) is
// already independently rate-limited by Twilio Verify on their side. A shared
// store would only matter if this ever scaled to multiple replicas, at which
// point the per-replica limit simply multiplies by the replica count rather
// than failing open.
const sendAttempts = new Map<string, RateEntry>();

function pruneExpired(now: number) {
  for (const [key, entry] of sendAttempts) {
    if (now - entry.windowStart >= WINDOW_MS) sendAttempts.delete(key);
  }
}

function consumeSendAllowance(phone: string, now = Date.now()): boolean {
  pruneExpired(now);
  const entry = sendAttempts.get(phone);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    sendAttempts.set(phone, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= MAX_SENDS_PER_WINDOW) return false;
  entry.count += 1;
  return true;
}

/** Test seam — resets the limiter between cases. */
export function __resetSignupRateLimit() {
  sendAttempts.clear();
}

export function isSignupVerificationRequired(): boolean {
  return isWhatsappVerificationConfigured();
}

/**
 * The two Twilio Verify calls, injectable.
 *
 * ESM namespace bindings can't be monkey-patched, so the alternative to this
 * seam is a global `mock.module` that would leak into every other test file
 * in the run. Explicit injection keeps the substitution scoped to the one
 * call that asked for it, and production callers simply omit it.
 */
export type VerificationDeps = {
  startVerification: (phoneE164: string) => Promise<unknown>;
  checkVerification: (phoneE164: string, code: string) => Promise<{ status: string }>;
};

const DEFAULT_DEPS: VerificationDeps = {
  startVerification: startWhatsappVerification,
  checkVerification: async (phoneE164, code) => {
    const result = await checkWhatsappVerification(phoneE164, code);
    return { status: String(result.status) };
  },
};

function normalizePhone(value: string): string {
  return value.trim();
}

async function assertPhoneUnclaimed(phone: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM profiles WHERE whatsapp_phone_e164 = $1 LIMIT 1`,
    [phone],
  );
  if (rows.length > 0) {
    throw new Error("This phone number is already registered to another account");
  }
}

async function assertEmailUnclaimed(email: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM profiles WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  if (rows.length > 0) {
    throw new Error("An account with that email already exists");
  }
}

/**
 * Step 1 of signup: send a one-time code to the phone number.
 *
 * Both uniqueness checks run BEFORE the send. Discovering "that email is
 * taken" after paying for an SMS and making the user type a code would be
 * both wasteful and a worse experience; signUpLocal raises the same email
 * error anyway, so this surfaces it earlier rather than revealing anything
 * new.
 */
export async function requestSignupPhoneVerification(
  input: {
    email: string;
    phoneE164: string;
  },
  deps: VerificationDeps = DEFAULT_DEPS,
): Promise<{ ok: true; required: boolean }> {
  const phone = normalizePhone(input.phoneE164);

  if (!isSignupVerificationRequired()) {
    // Nothing to send. The client reads `required: false` and submits the
    // account details directly.
    return { ok: true, required: false };
  }

  if (!isValidE164(phone)) {
    throw new Error(
      "Enter your phone number in international format, including the country code — e.g. +919876543210",
    );
  }

  await assertEmailUnclaimed(input.email);
  await assertPhoneUnclaimed(phone);

  if (!consumeSendAllowance(phone)) {
    throw new Error("Too many codes requested for this number. Try again in 15 minutes.");
  }

  await deps.startVerification(phone);
  return { ok: true, required: true };
}

export type VerifiedSignUpInput = {
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  password: string;
  /** Omitted only when isSignupVerificationRequired() is false. */
  code?: string | null;
};

/**
 * Step 2 of signup: check the code, then create the account.
 *
 * Ordering is the security property here — Twilio is asked first, and
 * signUpLocal is only reached once the code is approved. There is no code
 * path that creates a profile with an unverified number attached.
 */
export async function verifyAndSignUp(
  input: VerifiedSignUpInput,
  deps: VerificationDeps = DEFAULT_DEPS,
) {
  const phone = normalizePhone(input.phone);
  const verificationRequired = isSignupVerificationRequired();

  if (verificationRequired) {
    const code = input.code?.trim();
    if (!code) {
      throw new Error("Enter the verification code sent to your phone");
    }
    if (!isValidE164(phone)) {
      throw new Error(
        "Enter your phone number in international format, including the country code — e.g. +919876543210",
      );
    }

    await assertPhoneUnclaimed(phone);

    const check = await deps.checkVerification(phone, code);
    if (check.status !== "approved") {
      throw new Error("Incorrect or expired code — request a new one and try again");
    }
  }

  const { signUpLocal } = await import("@/server/livey-service.server");
  const result = await signUpLocal({
    full_name: input.full_name,
    email: input.email,
    phone,
    company_name: input.company_name,
    password: input.password,
  });

  if (verificationRequired) {
    // Stamped immediately after creation so the new account can receive
    // WhatsApp reminders without a second trip through Settings. A failure
    // here must not undo a successfully created account — the user can
    // always re-link from Settings — so it is logged, not thrown.
    try {
      await pool.query(
        `UPDATE profiles
         SET whatsapp_phone_e164 = $1, whatsapp_verified_at = now(), updated_at = now()
         WHERE id = $2`,
        [phone, result.user_id],
      );
    } catch (error) {
      console.error("[signup] failed to stamp verified WhatsApp number", error);
    }
  }

  return result;
}
