import { expect, test } from "bun:test";

import {
  SURFACE_ALLOWLIST,
  auditSourceFiles,
  collectSourceFiles,
  formatViolations,
  stripComments,
  type AllowlistEntry,
  type SourceFile,
} from "./audit-product-surfaces.ts";

const TODAY = "2026-08-25";

function audit(files: SourceFile[], allowlist: AllowlistEntry[] = []) {
  return auditSourceFiles(files, { allowlist, today: TODAY });
}

function rules(files: SourceFile[], allowlist: AllowlistEntry[] = []) {
  return audit(files, allowlist).map((violation) => violation.rule);
}

// ---------------------------------------------------------------------------
// Comment handling
// ---------------------------------------------------------------------------

test("comments are blanked without shifting line numbers", () => {
  const lines = stripComments(
    ["const a = 1; // Coming soon", "/* Coming soon", "   still comment */ const b = 2;"].join(
      "\n",
    ),
  );
  expect(lines).toHaveLength(3);
  expect(lines[0]).toBe("const a = 1; ");
  expect(lines[1]).toBe("");
  expect(lines[2]).toContain("const b = 2;");
});

test("a comment explaining a removed placeholder does not trip the rule", () => {
  const clean: SourceFile = {
    path: "src/components/history.tsx",
    content: `// This used to render an "MVP stub" badge and a Coming soon banner.\nexport const History = () => null;\n`,
  };
  expect(rules([clean])).toEqual([]);
});

// ---------------------------------------------------------------------------
// Rule: placeholder text
// ---------------------------------------------------------------------------

test("placeholder copy in a component is a violation", () => {
  const violation: SourceFile = {
    path: "src/components/thing.tsx",
    content: `export const Thing = () => <Badge>MVP stub</Badge>;\n`,
  };
  expect(rules([violation])).toEqual(["placeholder-text"]);

  const simulated: SourceFile = {
    path: "src/routes/_authenticated/thing.tsx",
    content: `const run = async () => {\n  await new Promise((r) => setTimeout(r, 800)); // ok\n  return "Simulate network delay";\n};\n`,
  };
  expect(rules([simulated])).toEqual(["placeholder-text"]);
});

test("placeholder copy outside routes and components is not this rule's business", () => {
  const serverFile: SourceFile = {
    path: "src/server/copy.server.ts",
    content: `export const LABEL = "Coming soon";\n`,
  };
  expect(rules([serverFile])).toEqual([]);
});

// ---------------------------------------------------------------------------
// Rule: fabricated provider metrics
// ---------------------------------------------------------------------------

test("hardcoded provider metrics are a violation", () => {
  const violation: SourceFile = {
    path: "src/routes/_authenticated/admin.integrations.tsx",
    content: `const PROVIDERS = [{ id: "zoho", queueDepth: 45, deadLetterCount: 12 }];\n`,
  };
  // One finding per offending line — the line is the thing to go and fix,
  // and naming it three times because it holds three fake metrics is noise.
  const found = audit([violation]);
  expect(found.map((entry) => entry.rule)).toEqual(["fabricated-provider-metrics"]);
  expect(found[0]?.message).toContain("queueDepth");
});

test("each offending line is reported once, on the line that holds it", () => {
  const violation: SourceFile = {
    path: "src/routes/_authenticated/admin.integrations.tsx",
    content: `const a = 1;\nconst PROVIDERS = [{ queueDepth: 45 }];\nconst b = 2;\nconst MORE = [{ conflicts: 3 }];\n`,
  };
  const found = audit([violation]);
  expect(found).toHaveLength(2);
  expect(found[0]?.line).toBe(2);
  expect(found[1]?.line).toBe(4);
});

test("a real delivery read model is not flagged", () => {
  const clean: SourceFile = {
    path: "src/routes/_authenticated/admin.integrations.tsx",
    content: `const snapshot = await getIntegrationDeliverySnapshot();\nreturn <span>{snapshot.outbox.total}</span>;\n`,
  };
  expect(rules([clean])).toEqual([]);
});

// ---------------------------------------------------------------------------
// Rule: stub voucher success
// ---------------------------------------------------------------------------

test("reporting a STUB- voucher as success is a violation", () => {
  const violation: SourceFile = {
    path: "src/integrations/gyftr/gyftr-client.ts",
    content: `return {\n  ok: true,\n  voucherCode: \`STUB-\${id}\`,\n};\n`,
  };
  expect(rules([violation])).toEqual(["stub-voucher-success"]);
});

test("a guard that REJECTS a stub voucher is the fix, not the bug", () => {
  const clean: SourceFile = {
    path: "src/server/reward-commands.server.ts",
    content: `function isStubVoucher(voucher: { voucherCode: string }) {\n  return voucher.voucherCode.toUpperCase().startsWith("STUB-");\n}\n`,
  };
  expect(rules([clean])).toEqual([]);
});

// ---------------------------------------------------------------------------
// Rule: dead disabled action
// ---------------------------------------------------------------------------

test("a permanently disabled action button is a violation", () => {
  const violation: SourceFile = {
    path: "src/routes/_authenticated/admin.learning.tsx",
    content: `<Button size="sm" variant="outline" disabled>\n  <Plus />\n  Add lesson\n</Button>\n`,
  };
  const found = audit([violation]);
  expect(found.map((entry) => entry.rule)).toEqual(["dead-disabled-action"]);
  expect(found[0]?.text).toBe("Add lesson");
});

test("a disabled button explaining a status lock is allowed", () => {
  // "Gold tier required" is not an action — it is the honest reason the
  // action is unavailable, which is exactly what should be there.
  const clean: SourceFile = {
    path: "src/routes/_authenticated/insight-hub.tsx",
    content: `<Button variant="outline" className="w-full" disabled>\n  <Lock />\n  {track.tier_requirement} tier required\n</Button>\n`,
  };
  expect(rules([clean])).toEqual([]);
});

test("a conditionally disabled button is not a dead end", () => {
  const clean: SourceFile = {
    path: "src/routes/_authenticated/tasks.tsx",
    content: `<Button disabled={saving}>Save changes</Button>\n`,
  };
  expect(rules([clean])).toEqual([]);
});

test("a disabled non-Button element is out of scope", () => {
  const clean: SourceFile = {
    path: "src/routes/_authenticated/deals.tsx",
    content: `<Input id="close_date" value={draft.close_date} disabled placeholder="Auto-set on closure" />\n`,
  };
  expect(rules([clean])).toEqual([]);
});

// ---------------------------------------------------------------------------
// Rule: ungated hidden route
// ---------------------------------------------------------------------------

test("linking to a hidden route without the shared gate is a violation", () => {
  const violation: SourceFile = {
    path: "src/components/app-sidebar.tsx",
    content: `const admin = [{ title: "Integrations", url: "/admin/integrations", icon: Activity }];\n`,
  };
  expect(rules([violation])).toEqual(["ungated-hidden-route"]);

  const distribution: SourceFile = {
    path: "src/components/nav.tsx",
    content: `<Link to="/distribution">Distribution</Link>\n`,
  };
  expect(rules([distribution])).toEqual(["ungated-hidden-route"]);
});

test("the same link with the gate present is fine", () => {
  const clean: SourceFile = {
    path: "src/components/app-sidebar.tsx",
    content: `const items = surfaces.integrationOperationsCentre\n  ? [{ title: "Integrations", url: "/admin/integrations" }]\n  : [];\n`,
  };
  expect(rules([clean])).toEqual([]);

  const gatedDistribution: SourceFile = {
    path: "src/components/nav.tsx",
    content: `{showDistributionNavigation(access) ? <Link to="/distribution">Distribution</Link> : null}\n`,
  };
  expect(rules([gatedDistribution])).toEqual([]);
});

// ---------------------------------------------------------------------------
// Rule: DMS through the generic client
// ---------------------------------------------------------------------------

test("a DMS table reached through the generic client is a violation", () => {
  const violation: SourceFile = {
    path: "src/routes/_authenticated/distribution.tsx",
    content: `const { data } = await supabase.from("stock_requests").select("*");\n`,
  };
  expect(rules([violation])).toEqual(["dms-generic-client"]);

  const write: SourceFile = {
    path: "src/components/distribution/thing.tsx",
    content: `await supabase.from("inventory_balances").update({ on_hand_quantity: 5 });\n`,
  };
  expect(rules([write])).toEqual(["dms-generic-client"]);
});

test("a named server function reading the same table is fine", () => {
  const clean: SourceFile = {
    path: "src/server/distribution-queries.server.ts",
    content: `await pool.query('SELECT * FROM stock_requests WHERE id = $1', [id]);\n`,
  };
  expect(rules([clean])).toEqual([]);
});

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

test("an allowlist entry suppresses exactly its own line and nothing else", () => {
  const file: SourceFile = {
    path: "src/routes/_authenticated/admin.learning.tsx",
    content: `<Button disabled>\n  Add lesson\n</Button>\n<Button disabled>\n  Add course\n</Button>\n`,
  };
  const allowlist: AllowlistEntry[] = [
    {
      rule: "dead-disabled-action",
      path: "src/routes/_authenticated/admin.learning.tsx",
      linePattern: "Add lesson",
      reason: "Hidden behind a disabled surface flag until the editor lands.",
      owner: "Enablement",
      expires: "2027-01-01",
    },
  ];
  const found = audit([file], allowlist);
  expect(found).toHaveLength(1);
  expect(found[0]?.text).toBe("Add course");
});

test("an expired allowlist entry fails the audit and stops suppressing", () => {
  const file: SourceFile = {
    path: "src/routes/_authenticated/admin.learning.tsx",
    content: `<Button disabled>\n  Add lesson\n</Button>\n`,
  };
  const expired: AllowlistEntry[] = [
    {
      rule: "dead-disabled-action",
      path: "src/routes/_authenticated/admin.learning.tsx",
      linePattern: "Add lesson",
      reason: "Was meant to be temporary.",
      owner: "Enablement",
      expires: "2026-01-01",
    },
  ];
  const found = audit([file], expired);
  // Two findings: the expired exception itself, and the surface it no longer
  // covers.
  expect(found).toHaveLength(2);
  expect(found[0]?.message).toContain("expired on 2026-01-01");
  expect(found[0]?.message).toContain("Enablement");
  expect(found[1]?.text).toBe("Add lesson");
});

test("every shipped allowlist entry carries a reason, an owner, and a future expiry", () => {
  const today = new Date().toISOString().slice(0, 10);
  for (const entry of SURFACE_ALLOWLIST) {
    expect(entry.reason.length).toBeGreaterThan(20);
    expect(entry.owner.length).toBeGreaterThan(0);
    expect(entry.linePattern.length).toBeGreaterThan(0);
    expect(entry.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry.expires > today).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// The real tree
// ---------------------------------------------------------------------------

test("the shipped source tree passes its own audit", () => {
  const files = collectSourceFiles();
  expect(files.length).toBeGreaterThan(50);
  const violations = auditSourceFiles(files);
  expect(formatViolations(violations)).toContain("no unfinished or deceptive product surfaces");
  expect(violations).toEqual([]);
});

test("the formatter names the file, line, and rule of every finding", () => {
  const output = formatViolations([
    {
      rule: "placeholder-text",
      file: "src/components/thing.tsx",
      line: 12,
      text: "MVP stub",
      message: "Placeholder copy ships to users.",
    },
  ]);
  expect(output).toContain("src/components/thing.tsx:12");
  expect(output).toContain("[placeholder-text]");
  expect(output).toContain("1 violation(s)");
});
