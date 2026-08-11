import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

import { frontendRedirect } from "@/lib/app-urls";
import { sessionCookie } from "@/lib/session-cookie";
import {
  bootstrapPartnerAssignment,
  createSessionTokenForUser,
} from "@/server/livey-service.server";
import { pool } from "@/server/postgres.server";

// Google Sign-In — identity only, no persistent Google token storage. Unlike
// Zoho Sign (lib/zoho-sign.ts), nothing here ever calls Google's API
// again after the callback finishes, so there's nothing to keep.
//
// Settings' "Connect Google" flow pre-authenticates over the normal API
// (POST /api/auth/google/link-ticket) and passes the resulting single-use
// ticket in the URL; /connect exchanges it for a short-lived actor cookie that
// /callback reads to distinguish "link to this user" from "fresh sign-in".

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ?? "https://systemforgelabs.xyz/api/auth/google/callback";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const STATE_COOKIE = "google_oauth_state";
const ACTOR_COOKIE = "google_oauth_actor";
const TICKET_TTL_MS = 5 * 60 * 1000;

function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [key, ...rest] = entry.split("=");
        return [key.trim(), rest.join("=")];
      }),
  );
}

function clearedCookies(): string[] {
  return [`${STATE_COOKIE}=; Path=/; Max-Age=0`, `${ACTOR_COOKIE}=; Path=/; Max-Age=0`];
}

function hashTicket(ticket: string): string {
  return createHash("sha256").update(ticket).digest("hex");
}

/**
 * Mints the single-use ticket that lets Settings' top-level "Connect Google"
 * navigation prove which authenticated user initiated it.
 */
export async function createGoogleConnectTicket(userId: string): Promise<{ ticket: string }> {
  const ticket = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO google_oauth_connect_tickets (ticket_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
    [hashTicket(ticket), userId, new Date(Date.now() + TICKET_TTL_MS)],
  );
  return { ticket };
}

async function consumeGoogleConnectTicket(ticket: string): Promise<string | null> {
  const result = await pool.query<{ user_id: string }>(
    `UPDATE google_oauth_connect_tickets
        SET used_at = now()
      WHERE ticket_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
      RETURNING user_id`,
    [hashTicket(ticket)],
  );
  return result.rows[0]?.user_id ?? null;
}

// Response.headers can't carry two Set-Cookie entries via a plain object
// literal (a duplicate key just overwrites) — Headers.append() is the only
// way to send multiple Set-Cookie headers on one response, which every
// redirect here needs (the state and actor cookies are always paired).
function redirectWithCookies(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

export async function handleGoogleConnect(request: Request): Promise<Response> {
  if (!CLIENT_ID) {
    return new Response(JSON.stringify({ error: "Google Client ID is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ticket = new URL(request.url).searchParams.get("ticket");
  const actorUserId = ticket ? await consumeGoogleConnectTicket(ticket) : null;
  if (ticket && !actorUserId) {
    return redirectWithCookies(
      frontendRedirect(
        `/settings?googleError=${encodeURIComponent("Connect link expired — please try again")}`,
      ),
      clearedCookies(),
    );
  }

  const state = randomBytes(32).toString("hex");
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
    state,
  });

  const cookies = [`${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`];
  if (actorUserId) {
    cookies.push(
      `${ACTOR_COOKIE}=${actorUserId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`,
    );
  }

  return redirectWithCookies(`${AUTHORIZE_URL}?${params.toString()}`, cookies);
}

type GoogleUserInfo = {
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
};

function isEmailVerified(value: GoogleUserInfo["email_verified"]): boolean {
  return value === true || value === "true";
}

async function exchangeCodeForUserInfo(code: string): Promise<GoogleUserInfo> {
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code,
  });
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody,
  });
  const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(`Google token exchange failed: ${JSON.stringify(tokenData)}`);
  }

  const userInfoRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const userInfo = (await userInfoRes.json()) as GoogleUserInfo & { error?: string };
  if (!userInfoRes.ok || !userInfo.sub) {
    throw new Error(`Google userinfo lookup failed: ${JSON.stringify(userInfo)}`);
  }
  return userInfo;
}

// Settings' "Connect Google Account" flow — links the current session's
// user to this Google identity. Refuses to silently steal a Google account
// that's already linked to someone else.
async function linkGoogleAccountToCurrentUser(
  currentUserId: string,
  userInfo: GoogleUserInfo,
): Promise<void> {
  if (!userInfo.email) {
    throw new Error("Google did not share an email address for this account");
  }

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM profiles WHERE google_id = $1 LIMIT 1`,
    [userInfo.sub],
  );
  if (existing.rows[0] && existing.rows[0].id !== currentUserId) {
    throw new Error("This Google account is already connected to a different LIVEY account");
  }

  await pool.query(
    `UPDATE profiles SET google_id = $1, google_email = $2, google_linked_at = now() WHERE id = $3`,
    [userInfo.sub, userInfo.email, currentUserId],
  );
}

// /auth's "Continue with Google" flow — finds the matching profile (by
// google_id first, then by verified email as a one-time auto-link for an
// existing password account's very first Google sign-in), or creates a
// brand-new self-registered partner_admin account mirroring signUpLocal's
// exact shape (livey-service.server.ts) when neither matches.
async function findOrCreateUserForGoogle(userInfo: GoogleUserInfo): Promise<string> {
  const byGoogleId = await pool.query<{ id: string }>(
    `SELECT id FROM profiles WHERE google_id = $1 LIMIT 1`,
    [userInfo.sub],
  );
  if (byGoogleId.rows[0]) return byGoogleId.rows[0].id;

  if (userInfo.email && isEmailVerified(userInfo.email_verified)) {
    const byEmail = await pool.query<{ id: string; google_id: string | null }>(
      `SELECT id, google_id FROM profiles WHERE lower(email) = lower($1) LIMIT 1`,
      [userInfo.email],
    );
    const matched = byEmail.rows[0];
    if (matched) {
      if (matched.google_id && matched.google_id !== userInfo.sub) {
        throw new Error("This email is already linked to a different Google account");
      }
      await pool.query(
        `UPDATE profiles SET google_id = $1, google_email = $2, google_linked_at = now() WHERE id = $3`,
        [userInfo.sub, userInfo.email, matched.id],
      );
      return matched.id;
    }
  }

  if (!userInfo.email) {
    throw new Error("Google did not share an email address — cannot create an account");
  }

  // Matches signUpLocal's exact non-transactional shape (four sequential
  // pool.query calls, no explicit BEGIN/COMMIT) for consistency, just
  // sourced from Google's identity instead of a submitted form. phone/
  // company_name are left null (both nullable) — completed later via the
  // same onboarding flow every self-registered partner admin already goes
  // through.
  const id = randomUUID();
  const placeholderPasswordHash = await bcrypt.hash(randomUUID(), 10);
  await pool.query(
    `INSERT INTO profiles (id, email, password_hash, full_name, partner_status, google_id, google_email, google_linked_at)
     VALUES ($1, $2, $3, $4, 'pending_partner_registration', $5, $6, now())`,
    [
      id,
      userInfo.email,
      placeholderPasswordHash,
      userInfo.name || userInfo.email,
      userInfo.sub,
      userInfo.email,
    ],
  );
  await pool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'partner_admin')`, [id]);
  await bootstrapPartnerAssignment(pool, {
    userId: id,
    roleKey: "partner_admin",
    source: "google_self_registration",
    approverUserId: id,
  });

  return id;
}

export async function handleGoogleCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const cookies = parseCookies(request);
  const savedState = cookies[STATE_COOKIE];

  // Set by /connect only when it consumed a valid link-ticket, so its
  // presence cleanly means "this was Settings' Connect flow," never a
  // login/signup attempt.
  const currentUserId = cookies[ACTOR_COOKIE] || null;
  const errorRedirectBase = currentUserId ? "/settings" : "/auth";

  const failWith = (message: string): Response =>
    redirectWithCookies(
      frontendRedirect(`${errorRedirectBase}?googleError=${encodeURIComponent(message)}`),
      clearedCookies(),
    );

  if (!code) return failWith("Google did not return an authorization code");
  if (!returnedState || !savedState || returnedState !== savedState) {
    return failWith("Invalid OAuth state — possible CSRF");
  }

  let userInfo: GoogleUserInfo;
  try {
    userInfo = await exchangeCodeForUserInfo(code);
  } catch (err) {
    console.error("[Google OAuth callback] token exchange failed:", err);
    return failWith(err instanceof Error ? err.message : "Google sign-in failed");
  }

  try {
    if (currentUserId) {
      await linkGoogleAccountToCurrentUser(currentUserId, userInfo);
      return redirectWithCookies(frontendRedirect("/settings?googleConnected=1"), clearedCookies());
    }

    const userId = await findOrCreateUserForGoogle(userInfo);
    const { token, expiresAt } = await createSessionTokenForUser(userId);
    return redirectWithCookies(frontendRedirect("/auth/callback"), [
      ...clearedCookies(),
      sessionCookie(token, expiresAt),
    ]);
  } catch (err) {
    console.error("[Google OAuth callback] error:", err);
    return failWith(err instanceof Error ? err.message : "Google sign-in failed");
  }
}
