import { test, expect } from "@playwright/test";

import { dismissDailyDigest, login } from "./helpers";

/**
 * RBAC and Access Control E2E Tests
 *
 * These tests verify that the role-based access control is enforced
 * at the UI routing level. They complement (but do not replace) the
 * server-side policy checks.
 *
 * Test accounts used here rely on the seed data created by:
 *   bun run db:bootstrap
 *
 * Credentials are injected via environment variables:
 *   E2E_SUPER_ADMIN_EMAIL / E2E_SUPER_ADMIN_PASSWORD
 *   E2E_PARTNER_USER_EMAIL / E2E_PARTNER_USER_PASSWORD
 */

const ADMIN_EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL ?? "admin@liveytech.com";
const ADMIN_PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD ?? "test-admin-pw";
const PARTNER_EMAIL = process.env.E2E_PARTNER_USER_EMAIL ?? "partner@example.com";
const PARTNER_PASSWORD = process.env.E2E_PARTNER_USER_PASSWORD ?? "test-partner-pw";

test("self-registration establishes an HttpOnly session and opens onboarding", async ({ page }) => {
  const email = `e2e.signup.${Date.now()}@example.test`;
  await page.goto("/auth?mode=signup");
  await page.getByLabel("Full name").fill("E2E Signup User");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Phone").fill("+1 202 555 0199");
  await page.getByLabel("Company name").fill("E2E Signup Company");
  await page.getByLabel("Password").fill("E2E-Signup-1!");
  await page.getByRole("button", { name: /Create account/i }).click();

  await page.waitForURL(/\/partner\/onboarding/, { timeout: 15_000 });
  await dismissDailyDigest(page);
  await expect(page.getByRole("heading", { name: /Complete your partner profile/i })).toBeVisible();

  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "livey_session",
  );
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe("Lax");
  expect(await page.evaluate(() => window.localStorage.getItem("livey_auth_token"))).toBeNull();
});

test("daily briefing opens automatically after login", async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, { dismissDigest: false });
  const dialog = page.getByRole("dialog").filter({ hasText: /needs your attention today/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/needs your attention today/i)).toBeVisible();
});

// ─── Super Admin Access ────────────────────────────────────────────────────────

test.describe("Super Admin can access all admin areas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("can navigate to /admin/integrations", async ({ page }) => {
    await page.goto("/admin/integrations");
    await expect(page.getByRole("heading", { name: /External Integrations/i })).toBeVisible();
  });

  test("does not expose placeholder reward or logistics integrations", async ({ page }) => {
    await page.goto("/admin/integrations");
    await expect(page.getByRole("heading", { name: /External Integrations/i })).toBeVisible();
    await expect(page.getByText("GyFTR", { exact: true })).not.toBeVisible();
    await expect(page.getByText("DHL Express", { exact: true })).not.toBeVisible();
  });

  test("can navigate to /admin/partners", async ({ page }) => {
    await page.goto("/admin/partners");
    await expect(page.getByRole("heading", { name: /Partner approvals/i })).toBeVisible();
  });

  test("can navigate to /admin/users", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: /Users/i })).toBeVisible();
  });

  test("can navigate to /admin/audit", async ({ page }) => {
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { name: /Audit/i })).toBeVisible();
  });
});

// ─── Partner User Access Restrictions ─────────────────────────────────────────

test.describe("Partner User is blocked from admin areas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);
  });

  test("cannot access /admin/integrations", async ({ page }) => {
    await page.goto("/admin/integrations");
    await expect(
      page.getByText(/must be a Super Admin|access denied|not authorized/i),
    ).toBeVisible();
  });

  test("cannot access /admin/users", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByText(/You need Super Admin access/i)).toBeVisible();
  });

  test("can access /support", async ({ page }) => {
    await page.goto("/support");
    await expect(page.getByRole("heading", { name: /Portal tickets/i })).toBeVisible();
  });

  test("can access /dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Welcome back/i })).toBeVisible();
  });
});

// ─── Navigation Sidebar Visibility ────────────────────────────────────────────

test.describe("Sidebar navigation is scoped by role", () => {
  test("Partner user does not see admin links in sidebar", async ({ page }) => {
    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Welcome back/i })).toBeVisible();
    await expect(page.getByText("Administration", { exact: true })).not.toBeVisible();
  });

  test("Super Admin sees admin links in sidebar", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Welcome back/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Integrations/i })).toBeVisible();
  });
});
