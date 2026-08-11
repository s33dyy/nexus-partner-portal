import { Hono, type Context } from "hono";

import type { IssuedSession } from "@livey/shared/types/auth";
import { clearSessionCookie, publicSession, sessionCookie } from "@/lib/session-cookie";

import { createGoogleConnectTicket } from "@/server/google-oauth.server";
import {
  completePasswordReset,
  createPartnerTeamMembersBulk,
  createWorkspaceUser,
  createWorkspaceUsersBulk,
  disconnectGoogleAccount,
  getAuthContext,
  issueTemporaryPasswordForUser,
  requestPasswordReset,
  signInWithPassword,
  signOutLocal,
  signUpLocal,
  updatePasswordFromSession,
  updateProfileFromSession,
} from "@/server/livey-service.server";
import { quoteCurrencyToUsd } from "@/server/fx-rates.server";

export const authRoutes = new Hono();

function attachSessionCookie(c: Context, session: IssuedSession) {
  c.header("Set-Cookie", sessionCookie(session.access_token, new Date(session.expires_at * 1000)));
}

authRoutes.get("/session", async (c) => {
  const authContext = await getAuthContext();
  return c.json({
    ...authContext,
    session: authContext.session ? publicSession(authContext.session) : null,
  });
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  try {
    const result = await signInWithPassword(body.email, body.password);
    attachSessionCookie(c, result.session);
    return c.json({ ...result, session: publicSession(result.session) });
  } catch (error) {
    // Rejected credentials are a 401, not a server fault — the catch-all
    // error handler would otherwise report them as 500.
    if (!(error instanceof Error && error.message === "Invalid email or password")) {
      console.error("[auth/login] sign-in failed:", error);
    }
    return c.json({ message: "Invalid email or password" }, 401);
  }
});

authRoutes.post("/signup", async (c) => {
  const body = await c.req.json<{
    email: string;
    password: string;
    options?: { data?: { full_name?: string; phone?: string; company_name?: string } };
  }>();
  const result = await signUpLocal({
    email: body.email,
    password: body.password,
    full_name: body.options?.data?.full_name ?? "Partner User",
    phone: body.options?.data?.phone ?? "",
    company_name: body.options?.data?.company_name ?? null,
  });
  attachSessionCookie(c, result.session);
  return c.json({ ...result, session: publicSession(result.session) });
});

authRoutes.post("/logout", async (c) => {
  await signOutLocal();
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({});
});

authRoutes.post("/password/forgot", async (c) => {
  const body = await c.req.json<{ email: string; redirectTo?: string }>();
  return c.json(await requestPasswordReset(body.email));
});

authRoutes.post("/password/reset", async (c) => {
  const body = await c.req.json<{ token: string; password: string }>();
  const result = await completePasswordReset(body.token, body.password);
  attachSessionCookie(c, result.session);
  return c.json({ ...result, session: publicSession(result.session) });
});

authRoutes.post("/password/update", async (c) => {
  const body = await c.req.json<{ password: string }>();
  return c.json(await updatePasswordFromSession(body.password));
});

authRoutes.post("/users", async (c) => {
  return c.json(await createWorkspaceUser(await c.req.json()));
});

authRoutes.post("/users/bulk", async (c) => {
  return c.json(await createWorkspaceUsersBulk(await c.req.json()));
});

authRoutes.post("/users/:userId/temporary-password", async (c) => {
  return c.json(await issueTemporaryPasswordForUser(c.req.param("userId")));
});

authRoutes.post("/team-members/bulk", async (c) => {
  return c.json(await createPartnerTeamMembersBulk(await c.req.json()));
});

authRoutes.post("/profile", async (c) => {
  const body = await c.req.json<{ full_name: string; phone: string | null }>();
  return c.json(await updateProfileFromSession(body));
});

authRoutes.post("/google/disconnect", async (c) => c.json(await disconnectGoogleAccount()));

authRoutes.post("/google/link-ticket", async (c) => {
  const { session } = await getAuthContext();
  if (!session) return c.json({ message: "Unauthorized" }, 401);
  return c.json(await createGoogleConnectTicket(session.user.id));
});

authRoutes.post("/fx/quote", async (c) => {
  const body = await c.req.json<{ sourceCurrency: string; amount: number }>();
  return c.json(await quoteCurrencyToUsd(body));
});
