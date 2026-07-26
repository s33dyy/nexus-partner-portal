import "dotenv/config";

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { chromium, type Page } from "playwright";

import {
  CAPTURE_ACCOUNTS,
  CAPTURE_TARGETS,
  type CaptureAction,
  type CaptureRole,
  type CaptureTarget,
} from "./capture-targets";

const BASE_URL = process.env.CAPTURE_BASE_URL ?? process.env.LIVEY_BASE_URL ?? "http://127.0.0.1:3000";
const OUTPUT_ROOT = resolve(process.cwd(), "public/captures");

function ensureParentDirectory(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function accountForRole(role: CaptureRole) {
  return CAPTURE_ACCOUNTS[role];
}

async function signIn(page: Page, role: CaptureRole) {
  const account = accountForRole(role);

  await page.goto(`${BASE_URL}/auth?mode=signin`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#password").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(500);
  await page.locator("#email").fill(account.email);
  await page.locator("#password").fill(account.password);
  await Promise.all([
    page.waitForURL(/\/dashboard(?:[?#].*)?$/, { timeout: 30_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
  await page.waitForLoadState("networkidle");
}

async function waitForHeading(page: Page) {
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(600);
}

async function selectPartnerStatus(page: Page, status: "submitted" | "approved") {
  const statusFilter = page.locator('button[role="combobox"]').first();
  await statusFilter.click();
  const statusOption = page.getByRole("option", { name: new RegExp(`^${status}$`, "i") });
  await statusOption.click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

async function openPartnerDetails(page: Page, companyName: string) {
  const row = page.getByRole("button").filter({ hasText: companyName }).first();
  await row.click();
  await page.getByRole("heading", { name: companyName }).waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(400);
}

async function applyTargetAction(page: Page, target: CaptureTarget) {
  switch (target.action as CaptureAction | undefined) {
    case "admin-partners-approved":
      await selectPartnerStatus(page, "approved");
      await openPartnerDetails(page, "Northstar Systems");
      return;
    case "reward-catalog-section":
      await page.getByText("Reward catalog", { exact: true }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      return;
    case "reward-request-dialog":
      await page.getByRole("button", { name: "Request reward" }).first().click();
      await page.getByRole("heading", { name: "Request redemption" }).waitFor({
        state: "visible",
        timeout: 15_000,
      });
      await page.waitForTimeout(400);
      return;
    case "admin-rewards-redemptions":
      await page.getByText("Redemption requests", { exact: true }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      return;
    case "none":
    default:
      break;
  }

  if (target.id === "super-admin-partners-submitted") {
    await openPartnerDetails(page, "Harbor Logistics");
  }
}

async function captureTarget(page: Page, target: CaptureTarget) {
  const outputPath = resolve(OUTPUT_ROOT, target.fileName);
  ensureParentDirectory(outputPath);

  await page.goto(`${BASE_URL}${target.path}`, { waitUntil: "networkidle" });
  await waitForHeading(page);
  await page.waitForTimeout(target.waitMs ?? 300);
  await applyTargetAction(page, target);
  await page.screenshot({ path: outputPath, fullPage: false, animations: "disabled" });
  console.log(`Captured ${target.fileName}`);
}

async function captureForRole(page: Page, role: CaptureRole) {
  for (const target of CAPTURE_TARGETS.filter((entry) => entry.role === role)) {
    await captureTarget(page, target);
  }
}

async function captureTrainingScreens() {
  const browser = await chromium.launch({ headless: true });

  try {
    const roles: CaptureRole[] = ["super_admin", "partner_admin", "partner_user"];
    for (const role of roles) {
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      });
      await context.addInitScript(() => {
        document.documentElement.style.scrollBehavior = "auto";
      });

      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await signIn(page, role);
      await captureForRole(page, role);
      await page.close();
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.main) {
  captureTrainingScreens()
    .then(() => {
      console.log("Training screenshots captured");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
