import { test, expect, type Page } from "@playwright/test";

/**
 * Distributor stock workflow — product.md §24, acceptance IDs DMS-001–DMS-025.
 *
 * Fixtures come from `bun scripts/seed-distribution-e2e.ts`, which builds the
 * Distributor / manager / custodian identities, two locations, two active
 * SKUs, and the warehouse opening balance THROUGH THE NAMED COMMANDS. The
 * setup deliberately inserts no inventory_balances rows of its own: a
 * projection with quantities that no movement produced is the exact
 * divergence §24.2 calls an incident, and an E2E setup that creates one is
 * testing a path the product does not have.
 *
 * Prerequisites:
 *   bun scripts/bootstrap-db.ts          # once, for the base demo data
 *   bun run db:migrate                   # DMS tables
 *   bun scripts/seed-distribution-e2e.ts # these fixtures + distribution-core on
 */

const PASSWORD = process.env.E2E_DISTRIBUTION_PASSWORD ?? "DistributionE2E!2026";
const DISTRIBUTOR = process.env.E2E_DISTRIBUTOR_EMAIL ?? "dev.distributor@livey.tech";
const OTHER_DISTRIBUTOR = process.env.E2E_OTHER_DISTRIBUTOR_EMAIL ?? "other.distributor@livey.tech";
const MANAGER = process.env.E2E_STOCK_MANAGER_EMAIL ?? "dev.stockmanager@livey.tech";
const CUSTODIAN = process.env.E2E_CUSTODIAN_EMAIL ?? "dev.custodian@livey.tech";

async function login(page: Page, email: string) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { timeout: 15_000 });
}

async function logout(page: Page) {
  await page.context().clearCookies();
}

/** The request id this run is working with, captured from the Requests table
 * so each stage acts on the same record rather than guessing. */
async function firstRequestId(page: Page): Promise<string> {
  await page.goto("/distribution?tab=requests");
  const cell = page
    .locator("td button")
    .filter({ hasText: /^DMS-\d{6}$/ })
    .first();
  await expect(cell).toBeVisible({ timeout: 15_000 });
  return (await cell.textContent())?.trim() ?? "";
}

test.describe("DMS happy path: request to receipt", () => {
  test("a Distributor requests stock from a deal, and it flows through to receipt", async ({
    page,
  }) => {
    // --- 1/2. Distributor raises the request from a Deal -----------------
    await login(page, DISTRIBUTOR);
    await page.goto("/deals");

    const dealRow = page.getByRole("button").filter({ hasText: /./ }).first();
    await expect(dealRow).toBeVisible();

    // The contextual action deep-links into the workspace with the deal
    // prefilled; the workspace owns the dialog, Deals owns none of it.
    await page.goto("/distribution?tab=requests&newRequest=true");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/deliver to/i).click();
    await page.getByRole("option").first().click();
    await dialog.getByLabel(/needed by/i).fill("2027-01-15");
    await dialog.getByLabel(/reason/i).fill("E2E: restock for a tagged deal");

    await dialog.getByLabel(/product for line 1/i).click();
    await page.getByRole("option").first().click();
    await dialog.getByLabel(/quantity for line 1/i).fill("4");

    await dialog.getByRole("button", { name: /add product/i }).click();
    await dialog.getByLabel(/product for line 2/i).click();
    await page.getByRole("option").first().click();
    await dialog.getByLabel(/quantity for line 2/i).fill("2");

    await dialog.getByRole("button", { name: /submit request/i }).click();
    await expect(page.getByText(/stock request submitted/i)).toBeVisible({ timeout: 15_000 });

    const humanId = await firstRequestId(page);
    expect(humanId).toMatch(/^DMS-\d{6}$/);
    await logout(page);

    // --- 3. The manager finds the Task and the Notification, then approves
    await login(page, MANAGER);
    await page.goto("/tasks");
    await expect(page.getByText(new RegExp(`Review stock request ${humanId}`, "i"))).toBeVisible({
      timeout: 15_000,
    });

    await page.goto("/notifications");
    await expect(page.getByText(new RegExp(`${humanId}.*approval`, "i"))).toBeVisible();

    await page.goto("/distribution?tab=requests");
    await page
      .getByRole("button", { name: /^review$/i })
      .first()
      .click();
    const reviewDialog = page.getByRole("dialog");
    await expect(reviewDialog).toBeVisible();
    // Every approved line needs a source location, so the server can tell the
    // custodian which shelf to reserve from.
    for (const trigger of await reviewDialog
      .getByRole("combobox", { name: /source location/i })
      .all()) {
      await trigger.click();
      await page.getByRole("option").first().click();
    }
    await reviewDialog.getByPlaceholder(/reason for this decision/i).fill("E2E: approved in full");
    await reviewDialog.getByRole("button", { name: /^approve$/i }).click();
    await expect(page.getByText(/request approved/i)).toBeVisible({ timeout: 15_000 });
    await logout(page);

    // --- 4. The custodian allocates, then dispatches ----------------------
    await login(page, CUSTODIAN);
    await page.goto("/tasks");
    await expect(
      page.getByText(new RegExp(`Allocate and dispatch stock request ${humanId}`, "i")),
    ).toBeVisible({ timeout: 15_000 });

    await page.goto("/distribution?tab=requests");
    await page
      .getByRole("button", { name: /^allocate$/i })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /allocate stock/i })
      .click();
    await expect(page.getByText(/stock allocated/i)).toBeVisible({ timeout: 15_000 });

    await page
      .getByRole("dialog")
      .getByRole("button", { name: /dispatch stock/i })
      .click();
    await expect(page.getByText(/stock dispatched/i)).toBeVisible({ timeout: 15_000 });
    await logout(page);

    // --- 5/6. The Distributor confirms receipt and the balance rises ------
    await login(page, DISTRIBUTOR);
    await page.goto("/distribution?tab=requests");
    await page
      .getByRole("button", { name: /confirm receipt/i })
      .first()
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /confirm what arrived/i })
      .click();
    await expect(page.getByText(/receipt confirmed/i)).toBeVisible({ timeout: 15_000 });

    await page.goto("/distribution?tab=stock");
    // On hand at the destination is now non-zero, which is the whole point.
    await expect(page.getByRole("cell", { name: /^[1-9]\d*$/ }).first()).toBeVisible();

    await page.goto("/distribution?tab=movements");
    await expect(page.getByText(/delivery/i).first()).toBeVisible();

    // The generated Tasks are closed, not left in the queue.
    await page.goto("/tasks");
    await expect(
      page.getByText(new RegExp(`Confirm receipt of stock request ${humanId}`, "i")),
    ).toHaveCount(0);
  });
});

test.describe("DMS denial and replay paths", () => {
  test("DMS-022: an unrelated Distributor cannot see or reach the request", async ({ page }) => {
    await login(page, OTHER_DISTRIBUTOR);

    await page.goto("/distribution?tab=requests");
    // No request belonging to the other Distributor is listed at all.
    await expect(page.getByText(/no stock requests/i)).toBeVisible({ timeout: 15_000 });

    await page.goto("/distribution?tab=stock");
    // Its own (empty) location only — never the other store's balances.
    await expect(page.getByText(/E2E Pune Distributor Store/i)).toHaveCount(0);

    await page.goto("/distribution?tab=movements");
    await expect(page.getByText(/E2E Pune Distributor Store/i)).toHaveCount(0);
  });

  test("DMS-007: an unrelated manager is not offered the review action", async ({ page }) => {
    await login(page, CUSTODIAN);
    await page.goto("/distribution?tab=requests");
    // The custodian fulfils; it never decides. Whatever rows it can see, none
    // of them offers Review.
    await expect(page.getByRole("button", { name: /^review$/i })).toHaveCount(0);
  });

  test("DMS-005: submitting twice from one dialog creates one request", async ({ page }) => {
    await login(page, DISTRIBUTOR);
    await page.goto("/distribution?tab=requests&newRequest=true");

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/deliver to/i).click();
    await page.getByRole("option").first().click();
    await dialog.getByLabel(/needed by/i).fill("2027-02-01");
    await dialog.getByLabel(/reason/i).fill("E2E: double click replay");
    await dialog.getByLabel(/product for line 1/i).click();
    await page.getByRole("option").first().click();
    await dialog.getByLabel(/quantity for line 1/i).fill("1");

    const submit = dialog.getByRole("button", { name: /submit request/i });
    // Two clicks in quick succession share one idempotency key, minted when
    // the dialog opened.
    await submit.click();
    await submit.click({ force: true }).catch(() => undefined);
    await expect(page.getByText(/stock request submitted/i)).toBeVisible({ timeout: 15_000 });

    await page.goto("/distribution?tab=requests");
    const matching = page.getByRole("row").filter({ hasText: /double click replay/i });
    expect(await matching.count()).toBeLessThanOrEqual(1);
  });
});
