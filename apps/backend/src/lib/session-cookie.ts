import type { IssuedSession, LocalSession } from "@livey/shared/types/auth";

export const SESSION_COOKIE = "livey_session";

type CookieOptions = {
  secure?: boolean;
};

function secureAttribute(options?: CookieOptions) {
  const secure = options?.secure ?? process.env.NODE_ENV === "production";
  return secure ? "; Secure" : "";
}

export function sessionCookie(token: string, expiresAt: Date, options?: CookieOptions) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secureAttribute(options)}`;
}

export function clearSessionCookie(options?: CookieOptions) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttribute(options)}`;
}

export function publicSession(session: IssuedSession): LocalSession {
  return {
    expires_at: session.expires_at,
    user: session.user,
  };
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const entry of header.split(";")) {
    const [key, ...valueParts] = entry.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(valueParts.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

export function readSessionToken(request: Request): string | null {
  const cookieToken = cookieValue(request, SESSION_COOKIE);
  if (cookieToken) return cookieToken;

  // Retained for trusted service callers and existing direct-handler tests.
  // The browser client never receives or persists a bearer token.
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return bearer || null;
}
