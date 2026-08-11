import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routesRoot = resolve(import.meta.dir, "../routes/_authenticated");
const workflowRoutes = ["deals.tsx", "pipeline.tsx", "admin.deals.tsx", "admin.partners.tsx"];

test("business workflow routes never write editorial News", () => {
  for (const route of workflowRoutes) {
    const source = readFileSync(resolve(routesRoot, route), "utf8");
    expect(source).not.toContain('from("portal_news_posts").insert');
  }
});

test("the explicit News Publisher retains the editorial write path", () => {
  const source = readFileSync(resolve(routesRoot, "admin.news.tsx"), "utf8");
  expect(source).toContain('from("portal_news_posts").insert');
});

test("dashboard keeps News and Activity as separate sources", () => {
  const source = readFileSync(resolve(routesRoot, "dashboard.tsx"), "utf8");
  expect(source).toContain('from("portal_news_posts")');
  expect(source).toContain('from("domain_activity_events")');
  expect(source).toContain("keep editorial news separate");
});
