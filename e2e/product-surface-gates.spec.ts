import { test, expect, type Page } from "@playwright/test";

/**
 * Product-surface readiness gates — product.md §24.7.
 *
 * Every surface here ships disabled, and hiding is enforced in three places
 * that must agree: navigation, the direct route, and the command. These tests
 * check the two a browser can see; the command-level denials are covered by
 * the server suites.
 *
 * Run against a deployment where integration-operations-centre,
 * learning-lesson-authoring, and gyftr-fulfillment are all false — which is
 * how they are seeded.
 */

const ADMIN_EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL ?? "maya.admin@livey.tech";
const ADMIN_PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD ?? "";

async function login(page: Page, email: string, password: string) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15_000 });
}

test.describe("hidden surfaces stay hidden, including for Super Admin", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!ADMIN_PASSWORD, "Set E2E_SUPER_ADMIN_PASSWORD to run the surface-gate checks");
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("the Integrations nav entry is absent and the direct route is unavailable", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: /^integrations$/i })).toHaveCount(0);

    // The gate is fail-closed for every role — there is deliberately no
    // super_admin bypass, or the hidden-route test would prove nothing.
    await page.goto("/admin/integrations");
    await expect(page.getByText(/integration operations are not enabled/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^pause$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^resume$/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^connect$/i })).toHaveCount(0);
  });

  test("the command palette does not offer a hidden surface", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible();
    await palette.getByPlaceholder(/jump to/i).fill("integrations");
    await expect(palette.getByRole("option", { name: /integrations/i })).toHaveCount(0);
  });

  test("the dead lesson-authoring action is absent", async ({ page }) => {
    await page.goto("/admin/learning");
    await expect(page.getByRole("button", { name: /add lesson/i })).toHaveCount(0);
  });

  test("an unconfigured digital reward cannot be requested", async ({ page }) => {
    await page.goto("/rewards");
    // A digital reward has no fulfilment path while the provider surface is
    // off, so it must not be offered — a redemption that can never complete
    // would take the partner's points and strand them.
    const redeemButtons = page.getByRole("button", { name: /redeem/i });
    for (const button of await redeemButtons.all()) {
      const card = button.locator("xpath=ancestor::*[self::div][1]");
      await expect(card).not.toContainText(/voucher/i);
    }
  });

  test("no console errors or 5xx responses on the gated pages", async ({ page }) => {
    const consoleErrors: string[] = [];
    const serverErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
    });

    for (const path of ["/admin/integrations", "/admin/learning", "/distribution"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }

    expect(serverErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

test.describe("the Distribution surface", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!ADMIN_PASSWORD, "Set E2E_SUPER_ADMIN_PASSWORD to run the surface-gate checks");
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  });

  test("renders the workspace when enabled, or the unavailable page when not", async ({ page }) => {
    await page.goto("/distribution");
    const enabled = page.getByRole("heading", { name: /stock requests and inventory/i });
    const disabled = page.getByText(/not enabled in this workspace/i);
    // One of the two, never both, and never a blank screen or a crash.
    await expect(enabled.or(disabled)).toBeVisible({ timeout: 15_000 });
  });

  test("mobile layout does not scroll the page sideways", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/distribution");
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // Wide tables scroll inside their own container; the body must not.
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
