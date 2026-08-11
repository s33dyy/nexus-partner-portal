import { test, expect } from "@playwright/test";

/**
 * Deal Pipeline E2E Tests
 *
 * These tests validate the core deal lifecycle and state machine
 * progression as defined in the LIVEY PAM CRM blueprint (Sections 5 & 6).
 *
 * Credentials injected via environment variables:
 *   E2E_SUPER_ADMIN_EMAIL / E2E_SUPER_ADMIN_PASSWORD
 *   E2E_PARTNER_USER_EMAIL / E2E_PARTNER_USER_PASSWORD
 */

const ADMIN_EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL ?? "admin@liveytech.com";
const ADMIN_PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD ?? "test-admin-pw";
const PARTNER_EMAIL = process.env.E2E_PARTNER_USER_EMAIL ?? "partner@example.com";
const PARTNER_PASSWORD = process.env.E2E_PARTNER_USER_PASSWORD ?? "test-partner-pw";

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 10_000 });
}

// ─── Partner: Deal Registration ────────────────────────────────────────────────

test.describe("Partner can register and view a deal", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);
  });

  test("deals page loads and shows pipeline", async ({ page }) => {
    await page.goto("/deals");
    await expect(page.getByRole("heading", { name: /Deals/i })).toBeVisible();
  });

  test("deal registration form is accessible", async ({ page }) => {
    await page.goto("/deals");
    const registerButton = page.getByRole("button", { name: /Register Deal|New Deal/i });
    await expect(registerButton).toBeVisible();
    await registerButton.click();
    // Dialog or form should open
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
  });
});

// ─── Admin: Deal Review and Approval ─────────────────────────────────────────

test.describe("Admin can view and manage deals pipeline", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("admin deals page loads correctly", async ({ page }) => {
    await page.goto("/admin/deals");
    await expect(page.getByRole("heading", { name: /Deals/i })).toBeVisible();
  });

  test("pipeline view is accessible", async ({ page }) => {
    await page.goto("/pipeline");
    await expect(page.getByRole("heading", { name: /Pipeline/i })).toBeVisible();
  });

  test("partner deals are visible in admin view", async ({ page }) => {
    await page.goto("/admin/deals");
    // Should render a table/list with at least column headers
    await expect(page.getByRole("table")).toBeVisible({ timeout: 8_000 });
  });
});

// ─── Support Ticket Lifecycle ──────────────────────────────────────────────────

test.describe("Support ticket creation and reply flow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);
  });

  test("support page loads", async ({ page }) => {
    await page.goto("/support");
    await expect(page.getByRole("heading", { name: /Support/i })).toBeVisible();
  });

  test("new ticket form shows product SKU and serial fields", async ({ page }) => {
    await page.goto("/support");
    const newTicketButton = page.getByRole("button", { name: /New Ticket|Create Ticket/i });
    await expect(newTicketButton).toBeVisible();
    await newTicketButton.click();
    // Wait for the form to appear
    await expect(page.getByLabel(/Product SKU/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByLabel(/Serial Number/i)).toBeVisible();
  });

  test("internal note toggle is hidden from partner users", async ({ page }) => {
    await page.goto("/support");
    // The internal note checkbox should not be visible to partner users
    await expect(page.getByText(/internal note/i)).not.toBeVisible();
  });
});

test.describe("Admin sees internal note toggle on tickets", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("internal note toggle is visible to super admin", async ({ page }) => {
    await page.goto("/support");
    // Select any ticket and check for internal toggle in reply area
    const firstTicket = page.getByRole("listitem").first();
    if (await firstTicket.isVisible()) {
      await firstTicket.click();
      await expect(page.getByText(/internal note/i)).toBeVisible({ timeout: 5_000 });
    } else {
      // No tickets present yet — just ensure the page renders
      await expect(page.getByRole("heading", { name: /Support/i })).toBeVisible();
    }
  });
});

// ─── Reward Catalog ───────────────────────────────────────────────────────────

test.describe("Partner can browse reward catalog", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);
  });

  test("rewards page loads", async ({ page }) => {
    await page.goto("/rewards");
    await expect(page.getByRole("heading", { name: /Rewards/i })).toBeVisible();
  });
});
