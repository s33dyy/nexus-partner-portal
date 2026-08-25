import { test, expect } from "@playwright/test";

/**
 * RBAC and Access Control E2E Tests
 *
 * These tests verify that the role-based access control is enforced
 * at the UI routing level. They complement (but do not replace) the
 * server-side policy checks.
 *
 * Test accounts used here rely on the seed data created by:
 *   bun scripts/bootstrap-db.ts
 *
 * Credentials are injected via environment variables:
 *   E2E_SUPER_ADMIN_EMAIL / E2E_SUPER_ADMIN_PASSWORD
 *   E2E_PARTNER_USER_EMAIL / E2E_PARTNER_USER_PASSWORD
 */

const ADMIN_EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL ?? "admin@liveytech.com";
const ADMIN_PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD ?? "test-admin-pw";
const PARTNER_EMAIL = process.env.E2E_PARTNER_USER_EMAIL ?? "partner@example.com";
const PARTNER_PASSWORD = process.env.E2E_PARTNER_USER_PASSWORD ?? "test-partner-pw";

// Helper: log in as a given user
async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Wait for redirect away from auth page
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 10_000 });
}

// ─── Super Admin Access ────────────────────────────────────────────────────────

test.describe("Super Admin can access all admin areas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  // The Integration Operations Centre is behind the
  // integration-operations-centre product-surface flag, which ships disabled
  // and fails closed for every role including Super Admin (product.md §24.7).
  // Reaching the route directly must therefore show the unavailable page,
  // not the operations centre — see product-surface-gates.spec.ts for the
  // full gate coverage.
  test("/admin/integrations is unavailable while its surface flag is off", async ({ page }) => {
    await page.goto("/admin/integrations");
    await expect(page.getByText(/integration operations are not enabled/i)).toBeVisible();
  });

  test("can navigate to /admin/partners", async ({ page }) => {
    await page.goto("/admin/partners");
    await expect(page.getByRole("heading", { name: /Partners/i })).toBeVisible();
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
    // Should be redirected or see an access denied message
    const isRedirected = !page.url().includes("/admin/integrations");
    const hasDeniedMessage = await page
      .getByText(/super admin|access denied|not authorized|permission/i)
      .isVisible()
      .catch(() => false);
    expect(isRedirected || hasDeniedMessage).toBe(true);
  });

  test("cannot access /admin/users", async ({ page }) => {
    await page.goto("/admin/users");
    const isRedirected = !page.url().includes("/admin/users");
    const hasDeniedMessage = await page
      .getByText(/super admin|access denied|not authorized|permission/i)
      .isVisible()
      .catch(() => false);
    expect(isRedirected || hasDeniedMessage).toBe(true);
  });

  test("can access /support", async ({ page }) => {
    await page.goto("/support");
    await expect(page.getByRole("heading", { name: /Support/i })).toBeVisible();
  });

  test("can access /dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Dashboard/i })).toBeVisible();
  });
});

// ─── Navigation Sidebar Visibility ────────────────────────────────────────────

test.describe("Sidebar navigation is scoped by role", () => {
  test("Partner user does not see admin links in sidebar", async ({ page }) => {
    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: /Integrations/i })).not.toBeVisible();
    await expect(page.getByRole("link", { name: /Audit Logs/i })).not.toBeVisible();
  });

  test("Super Admin sees admin links in sidebar", async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: /Integrations/i })).toBeVisible();
  });
});
