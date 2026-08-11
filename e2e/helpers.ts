import { expect, type Page } from "@playwright/test";

/**
 * Logs in through the real form and clears the daily digest modal.
 *
 * The digest auto-opens once per day per account, keyed in localStorage
 * (see apps/frontend/src/components/daily-digest-dialog.tsx). Every Playwright
 * test gets a fresh context with empty storage, so without this it opens over
 * the page in every single test and hides whatever the test is asserting on.
 */
export async function login(
  page: Page,
  email: string,
  password: string,
  options: { dismissDigest?: boolean } = {},
) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15_000 });
  if (options.dismissDigest !== false) {
    await dismissDailyDigest(page);
  }
}

export async function dismissDailyDigest(page: Page) {
  const dialog = page.getByRole("dialog").filter({ hasText: /needs your attention today/i });
  await dialog.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
  if (await dialog.isVisible().catch(() => false)) {
    await dialog
      .getByRole("button", { name: /^close$/i })
      .first()
      .click();
    await expect(dialog).toBeHidden();
  }
}
