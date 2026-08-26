import { test, expect } from "@playwright/test";
import { Pool } from "pg";

/**
 * News audience targeting E2E
 *
 * Two separable claims, so they are two tests:
 *
 *  1. the publish form saves the audience it shows (needs a Super Admin login);
 *  2. the partner feed *enforces* that audience (needs two partner logins).
 *
 * (2) seeds its post straight into Postgres rather than driving the admin UI,
 * so an enforcement regression cannot be masked by an unrelated publish-form
 * failure — and so it runs without admin credentials.
 *
 * Credentials come from the environment, as in the other specs:
 *   E2E_SUPER_ADMIN_EMAIL  / E2E_SUPER_ADMIN_PASSWORD
 *   E2E_PARTNER_A_EMAIL    / E2E_PARTNER_A_PASSWORD   (the targeted partner)
 *   E2E_PARTNER_A_COMPANY  — company name as shown in the audience picker
 *   E2E_PARTNER_B_EMAIL    / E2E_PARTNER_B_PASSWORD   (a DIFFERENT partner)
 *   DATABASE_URL           — required by the enforcement test's fixture
 */

const ADMIN_EMAIL = process.env.E2E_SUPER_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD;
const PARTNER_A_EMAIL = process.env.E2E_PARTNER_A_EMAIL;
const PARTNER_A_PASSWORD = process.env.E2E_PARTNER_A_PASSWORD;
const PARTNER_A_COMPANY = process.env.E2E_PARTNER_A_COMPANY;
const PARTNER_B_EMAIL = process.env.E2E_PARTNER_B_EMAIL;
const PARTNER_B_PASSWORD = process.env.E2E_PARTNER_B_PASSWORD;
const DATABASE_URL = process.env.DATABASE_URL;

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15_000 });
}

/**
 * Stops the daily briefing from auto-opening.
 *
 * It is a modal, so while it is up everything behind it is aria-hidden and
 * unreachable by role — and it re-opens on each full page load, so closing it
 * once is not enough. Pre-setting its own "already seen" keys (see
 * components/daily-digest-dialog.tsx) keeps it shut without touching app code.
 * The briefing is still opened deliberately, by its header button, where this
 * test wants to assert on it.
 */
async function suppressAutoBriefing(page: import("@playwright/test").Page, userIds: string[]) {
  const today = new Date().toISOString().slice(0, 10);
  await page.addInitScript(
    ([ids, date]) => {
      for (const id of ids as string[]) {
        for (const slot of ["morning", "evening"]) {
          window.localStorage.setItem(`livey.digest-seen.${id}.${date}.${slot}`, "1");
        }
      }
    },
    [userIds, today] as const,
  );
}

/**
 * Opens the briefing and waits for its content to load.
 *
 * Locators go through getByRole("dialog") rather than a "Close" button: the
 * dialog ships its own sr-only "Close" X *and* a footer Close, so a name-based
 * button locator resolves to two elements and fails strict mode.
 */
async function openBriefing(page: import("@playwright/test").Page) {
  const dialog = page.getByRole("dialog");
  // The auto-open fires late (it waits on the profile load), so it may already
  // be up — clicking again would be redundant, not harmful, but this is clearer.
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /open briefing/i }).click();
  }
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  // The digest is fetched after the dialog mounts. Wait for a section that is
  // always present, so an absence assertion cannot pass against a loading body.
  await expect(dialog.getByText(/done today/i)).toBeVisible({ timeout: 20_000 });
  return dialog;
}

async function closeBriefing(page: import("@playwright/test").Page) {
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: /^close$/i })
    .last()
    .click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

/**
 * Ends the session by dropping its cookie — this test is about the news feed,
 * not the sign-out affordance, which auth-rbac.spec.ts covers.
 */
async function signOut(page: import("@playwright/test").Page) {
  await page.context().clearCookies();
  await page.goto("/auth");
}

test.describe("news audience targeting", () => {
  test("the publish form saves the audience it shows", async ({ page }) => {
    test.skip(
      !ADMIN_EMAIL || !ADMIN_PASSWORD || !PARTNER_A_COMPANY,
      "super admin credentials are not configured",
    );

    // A unique title, so the assertion cannot be satisfied by an older post.
    const title = `E2E publish targeted ${Date.now()}`;

    await login(page, ADMIN_EMAIL!, ADMIN_PASSWORD!);
    await page.goto("/admin/news");
    // The briefing auto-opens over the form on first load of the day, and is
    // modal — everything behind it is aria-hidden and unreachable by role.
    const briefing = page.getByRole("dialog");
    if (await briefing.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await closeBriefing(page);
    }
    await page.getByPlaceholder(/Upgrade your video presence/i).fill(title);
    await page
      .getByPlaceholder(/Write the caption that partners will see/i)
      .fill("Audience round-trip check.");
    await page.getByRole("checkbox", { name: "India", exact: true }).click();
    await page.getByRole("checkbox", { name: PARTNER_A_COMPANY!, exact: true }).click();
    await page.getByRole("button", { name: /^publish post$/i }).click();

    const published = page.locator("div").filter({ hasText: title }).last();
    await expect(published).toContainText("India", { timeout: 15_000 });
    await expect(published).toContainText(PARTNER_A_COMPANY!);

    // Filtering to a region the post excludes must hide it.
    await page.getByLabel(/filter by sales region/i).click();
    await page.getByRole("option", { name: "Europe" }).click();
    await expect(page.getByText(title)).toHaveCount(0);
  });

  test("a targeted post reaches only the partner it names", async ({ page }) => {
    test.skip(
      !DATABASE_URL ||
        !PARTNER_A_EMAIL ||
        !PARTNER_A_PASSWORD ||
        !PARTNER_B_EMAIL ||
        !PARTNER_B_PASSWORD,
      "partner credentials or DATABASE_URL are not configured",
    );

    // Three logins' worth of navigation does not fit the 30s default.
    test.setTimeout(150_000);

    // Three logins' worth of navigation does not fit the 30s default.
    test.setTimeout(180_000);

    const title = `E2E enforced ${Date.now()}`;
    const pool = new Pool({ connectionString: DATABASE_URL });
    let postId: string | null = null;

    try {
      const accounts = await pool.query<{ id: string; partner_id: string | null; email: string }>(
        "SELECT id, partner_id, email FROM profiles WHERE email = ANY($1::text[])",
        [[PARTNER_A_EMAIL, PARTNER_B_EMAIL]],
      );
      const partnerA = accounts.rows.find((row) => row.email === PARTNER_A_EMAIL);
      const partnerB = accounts.rows.find((row) => row.email === PARTNER_B_EMAIL);
      expect(partnerA?.partner_id, `${PARTNER_A_EMAIL} must belong to a partner`).toBeTruthy();
      expect(partnerB?.partner_id, `${PARTNER_B_EMAIL} must belong to a partner`).toBeTruthy();
      expect(
        partnerA!.partner_id,
        "the two accounts must belong to DIFFERENT partners, or the negative half proves nothing",
      ).not.toBe(partnerB!.partner_id);

      await suppressAutoBriefing(page, [partnerA!.id, partnerB!.id]);

      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO portal_news_posts
           (id, title, caption, image_path, image_alt, posted_by_name, posted_by_role,
            target_partner_ids)
         VALUES (gen_random_uuid(), $1, $2, '', '', 'E2E', 'super_admin', ARRAY[$3::uuid])
         RETURNING id`,
        [title, "Only the named partner should see this.", partnerA!.partner_id],
      );
      postId = inserted.rows[0].id;

      // The targeted partner sees it on the feed...
      await login(page, PARTNER_A_EMAIL!, PARTNER_A_PASSWORD!);
      await page.goto("/dashboard");
      const feedA = page.getByRole("tabpanel", { name: /news/i });
      await expect(feedA.getByText(title)).toBeVisible({ timeout: 20_000 });
      // ...and in the briefing, the other surface reading this table.
      const briefingA = await openBriefing(page);
      await expect(briefingA.getByText(title)).toBeVisible();
      await closeBriefing(page);
      await signOut(page);

      // ...and a different partner sees it on neither.
      await login(page, PARTNER_B_EMAIL!, PARTNER_B_PASSWORD!);
      await page.goto("/dashboard");
      // Wait for the feed itself before asserting an absence, so a slow load
      // cannot pass as "correctly hidden".
      const feedB = page.getByRole("tabpanel", { name: /news/i });
      await expect(feedB).toBeVisible({ timeout: 20_000 });
      await expect(feedB.getByText(title)).toHaveCount(0);

      // The briefing leaked targeted posts before news-audience.server.ts.
      const briefingB = await openBriefing(page);
      await expect(briefingB.getByText(title)).toHaveCount(0);
    } finally {
      if (postId) await pool.query("DELETE FROM portal_news_posts WHERE id = $1", [postId]);
      await pool.end();
    }
  });
});
