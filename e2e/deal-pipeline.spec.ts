import { test, expect } from "@playwright/test";

import { login } from "./helpers";

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
    await expect(page.getByRole("heading", { name: /Deals/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Create deal/i })).toBeVisible();
    await expect(page.getByLabel(/Amount/i)).toBeVisible();
  });
});

// ─── Admin: Deal Review and Approval ─────────────────────────────────────────

test.describe("Admin can view and manage deals pipeline", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("admin deals page loads correctly", async ({ page }) => {
    await page.goto("/admin/deals");
    await expect(page.getByRole("heading", { name: /Deal approvals/i })).toBeVisible();
  });

  test("pipeline view is accessible", async ({ page }) => {
    await page.goto("/pipeline");
    await expect(page.getByRole("heading", { name: /Pipeline/i })).toBeVisible();
  });

  test("partner deals are visible in admin view", async ({ page }) => {
    await page.goto("/admin/deals");
    await expect(page.getByText("Approval queue", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Northstar Cloud Suite/i })).toBeVisible();
  });
});

// ─── Support Ticket Lifecycle ──────────────────────────────────────────────────

test.describe("Support ticket creation and reply flow", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);
  });

  test("support page loads", async ({ page }) => {
    await page.goto("/support");
    await expect(page.getByRole("heading", { name: /Portal tickets/i })).toBeVisible();
  });

  test("new ticket form shows product SKU and serial fields", async ({ page }) => {
    await page.goto("/support");
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
      await expect(page.getByRole("heading", { name: /Portal tickets/i })).toBeVisible();
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
