# Settings CSV Export Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add separate CSV downloads for every major dataset, surface them in a master export center on Settings, and keep the page-level export actions consistent with the same shared CSV formatter.

**Architecture:** Build one browser-safe CSV utility, one export dataset registry, and one reusable export button component. The Settings page becomes a grouped export hub that renders each dataset with role-aware visibility, counts, and a download action. Existing data pages keep their own export buttons so users can export the exact filtered view they are already looking at, while the Settings hub offers a global way to export the full scoped dataset for each category.

**Tech Stack:** TanStack Start, React, TypeScript, PostgreSQL, existing local Supabase-style client, browser-native Blob downloads, Radix/shadcn UI, Bun test runner.

---

### Task 1: Build the shared CSV export utility and export registry

**Files:**
- Create: `src/lib/csv-export.ts`
- Create: `src/lib/csv-export.test.ts`
- Create: `src/lib/export-registry.ts`
- Create: `src/lib/export-registry.test.ts`
- Create: `src/components/csv-export-button.tsx`

- [ ] **Step 1: Write the failing CSV formatter test**

```ts
import { expect, test } from "bun:test";
import { buildCsv, normalizeCsvValue } from "@/lib/csv-export";

test("buildCsv escapes commas, quotes, arrays, and empty values", () => {
  const csv = buildCsv(
    [
      { key: "name", header: "Name" },
      { key: "tags", header: "Tags" },
      { key: "notes", header: "Notes" },
    ],
    [
      {
        name: 'ACME, Inc.',
        tags: ["alpha", "beta"],
        notes: 'He said "yes"',
      },
    ],
  );

  expect(csv).toContain('"ACME, Inc."');
  expect(csv).toContain('"alpha; beta"');
  expect(csv).toContain('"He said ""yes"""');
});

test("normalizeCsvValue joins arrays and serializes objects", () => {
  expect(normalizeCsvValue(["alpha", "beta"])).toBe("alpha; beta");
  expect(normalizeCsvValue({ ok: true })).toBe(JSON.stringify({ ok: true }));
});
```

```ts
import { expect, test } from "bun:test";
import { listVisibleExportDatasets } from "@/lib/export-registry";

test("listVisibleExportDatasets hides admin-only exports from partner users", () => {
  const visible = listVisibleExportDatasets("partner_user").map((dataset) => dataset.id);

  expect(visible).not.toContain("portal-audit-events");
  expect(visible).not.toContain("admin-users");
  expect(visible).toContain("portal-deals");
});
```

- [ ] **Step 2: Run the test so it fails before implementation**

Run: `bun test src/lib/csv-export.test.ts src/lib/export-registry.test.ts -v`
Expected: fail because `src/lib/csv-export.ts` and `src/lib/export-registry.ts` do not exist yet.

- [ ] **Step 3: Implement the reusable CSV primitives and dataset registry**

```ts
export type CsvColumn = { key: string; header: string };

export function formatCsvDate(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

export function normalizeCsvValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(normalizeCsvValue).filter(Boolean).join("; ");
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function buildCsv(columns: CsvColumn[], rows: Array<Record<string, unknown>>) {
  const headerRow = columns.map((column) => column.header);
  const bodyRows = rows.map((row) =>
    columns.map((column) => normalizeCsvValue(row[column.key])),
  );
  return [headerRow, ...bodyRows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
```

```ts
export type ExportScope = {
  isSuperAdmin: boolean;
  partnerId: string | null;
  userId: string | null;
};

export type ExportDatasetDescriptor = {
  id: string;
  label: string;
  description: string;
  group: "operational" | "governance" | "configuration";
  filenameStem: string;
  visibleTo: Array<"super_admin" | "partner_admin" | "partner_user">;
  routePath?: string;
  columns: Array<{ key: string; header: string }>;
  loadCount: (scope: ExportScope) => Promise<number>;
  loadRows: (scope: ExportScope) => Promise<Array<Record<string, unknown>>>;
};

export function listVisibleExportDatasets(role: "super_admin" | "partner_admin" | "partner_user") {
  return EXPORT_DATASETS.filter((dataset) => dataset.visibleTo.includes(role));
}
```

The registry should include the datasets already present in the app:

- `partners`
- `profiles`
- `user_roles`
- `portal_customers`
- `portal_deals`
- `portal_team_members`
- `notifications`
- `partner_documents`
- `partner_review_notes`
- `portal_audit_events`
- `portal_news_posts`
- `portal_catalog_items`
- `reward_catalog_items`
- `reward_point_events`
- `reward_redemptions`
- `lookup_values`

- [ ] **Step 4: Add a reusable CSV export button component**

```tsx
type CsvExportButtonProps = {
  label?: string;
  filename: string;
  columns: Array<{ key: string; header: string }>;
  loadRows: () => Promise<Array<Record<string, unknown>>>;
  disabled?: boolean;
  variant?: "default" | "outline" | "ghost";
};
```

The button should:

- show a loading spinner while rows are being fetched
- call `buildCsv(...)`
- call `downloadCsv(...)`
- show a toast if row loading or CSV creation fails

- [ ] **Step 5: Verify the helper before moving on**

Run: `bun test src/lib/csv-export.test.ts src/lib/export-registry.test.ts -v`
Expected: pass

Run: `bunx tsc --noEmit`
Expected: pass or only report unrelated pre-existing errors, if any remain

### Task 2: Turn Settings into the master CSV export hub

**Files:**
- Modify: `src/routes/_authenticated/settings.tsx`
- Create: `src/components/settings-export-card.tsx`
- Modify: `src/lib/export-registry.ts`

- [ ] **Step 1: Add a registry-driven view of exportable datasets**

```tsx
const visibleDatasets = EXPORT_DATASETS.filter((dataset) =>
  dataset.visibleTo.some((role) => roles.includes(role)),
);
```

The Settings page should group cards into:

- Operational exports
- Governance exports
- Configuration exports

Each card should show:

- dataset label
- short description
- optional record count
- `Export CSV` button
- optional link to the source page

- [ ] **Step 2: Build the Settings export card component**

```tsx
<Card>
  <CardHeader>
    <CardTitle>{dataset.label}</CardTitle>
    <CardDescription>{dataset.description}</CardDescription>
  </CardHeader>
  <CardContent className="flex items-center justify-between gap-3">
    <div className="text-sm text-muted-foreground">
      {count === null ? "Count unavailable" : `${count} records`}
    </div>
    <CsvExportButton
      label="Export CSV"
      filename={`${dataset.filenameStem}-${formatCsvDate()}.csv`}
      columns={dataset.columns}
      loadRows={() => dataset.loadRows(scope)}
    />
  </CardContent>
</Card>
```

- [ ] **Step 3: Replace the placeholder Settings route with the export hub**

The current placeholder copy should be removed and replaced with:

- a page title like `Data exports`
- short helper text explaining that each dataset downloads separately
- grouped export cards from the registry
- empty-state handling for roles that cannot access a given dataset

- [ ] **Step 4: Verify the master export hub in the browser**

Run: `bun run dev`
Expected: `/settings` shows grouped export cards, each button downloads a CSV, and hidden-role datasets do not appear.

- [ ] **Step 5: Verify the Settings page compiles cleanly**

Run: `bunx tsc --noEmit`
Expected: pass

### Task 3: Add page-level exports to operational data pages

**Files:**
- Modify: `src/routes/_authenticated/admin.audit.tsx`
- Modify: `src/routes/_authenticated/deals.tsx`
- Modify: `src/routes/_authenticated/customers.tsx`
- Modify: `src/routes/_authenticated/pipeline.tsx`
- Modify: `src/routes/_authenticated/notifications.tsx`
- Modify: `src/routes/_authenticated/documents.tsx`
- Modify: `src/routes/_authenticated/rewards.tsx`

- [ ] **Step 1: Refactor the audit page to use the shared CSV helper**

```ts
const exportCsv = () =>
  downloadCsv(
    `livey-audit-events-${formatCsvDate(new Date())}.csv`,
    buildCsv(
      [
        { key: "created_at", header: "Created at" },
        { key: "actor_name", header: "Actor name" },
        { key: "actor_role", header: "Actor role" },
        { key: "action", header: "Action" },
        { key: "target_type", header: "Target type" },
        { key: "target_name", header: "Target name" },
        { key: "outcome", header: "Outcome" },
        { key: "severity", header: "Severity" },
        { key: "details", header: "Details" },
      ],
      filteredEvents,
    ),
  );
```

- [ ] **Step 2: Add export buttons to the operational page toolbars**

Each page should export its current filtered view:

- Deals: current deal list, with account/customer/POC labels and stage/status fields that are still visible
- Customers: current customer list
- Pipeline: current stage view
- Notifications: current notification feed
- Documents: current document list
- Rewards: current reward ledger and redemption list where the page already shows them

Use one `CsvExportButton` per page, feeding the page’s filtered rows directly so the downloaded CSV matches the on-screen filter state.

- [ ] **Step 3: Keep page filters and export results aligned**

The export should respect the same `query`, role scope, and category filters that the page is already using.

Example:

```tsx
<CsvExportButton
  label="Export CSV"
  filename={`livey-deals-${formatCsvDate(new Date())}.csv`}
  columns={DEAL_EXPORT_COLUMNS}
  loadRows={async () => filteredDeals.map(mapDealForExport)}
/>
```

- [ ] **Step 4: Verify the operational pages still build**

Run: `bunx tsc --noEmit`
Expected: pass

Run: `bun run build`
Expected: client and SSR bundles complete successfully

### Task 4: Add page-level exports to governance and partner management pages

**Files:**
- Modify: `src/routes/_authenticated/admin.users.tsx`
- Modify: `src/routes/_authenticated/admin.partners.tsx`
- Modify: `src/routes/_authenticated/admin.news.tsx`
- Modify: `src/routes/_authenticated/admin.catalog.tsx`
- Modify: `src/routes/_authenticated/admin.deals.tsx`
- Modify: `src/routes/_authenticated/admin.rewards.tsx`
- Modify: `src/routes/_authenticated/partner.team.tsx`
- Modify: `src/routes/_authenticated/partner.onboarding.tsx`

- [ ] **Step 1: Add export actions to the admin and partner management toolbars**

The governance pages should expose exports for their main visible datasets:

- Admin users: profiles + user roles
- Admin partners: partners + review notes + partner documents
- Admin news: news posts
- Admin catalog: catalog items
- Admin deals: deals under review
- Admin rewards: reward catalog and redemption records
- Partner team: partner team members
- Partner onboarding: partner profile + partner documents

- [ ] **Step 2: Use separate export buttons where a page shows multiple tables**

`admin.rewards.tsx` should have separate buttons for:

- reward catalog export
- redemption export

`admin.partners.tsx` should have separate buttons for:

- partner list export
- review notes export if those notes are visible in the right-hand detail pane

- [ ] **Step 3: Keep access control consistent**

Partner users must never see admin-only exports.
Partner admins should only see data tied to their partner scope.
Super admins can see the full governance export set.

- [ ] **Step 4: Verify governance exports in the browser**

Run: `bun run dev`
Expected: export buttons appear only where the role can access the data, and each CSV downloads with the right filtered content.

- [ ] **Step 5: Verify the full project still passes build checks**

Run: `bunx tsc --noEmit`
Expected: pass

Run: `bun run build`
Expected: pass

### Task 5: Final smoke test and commit

**Files:**
- All files modified in Tasks 1-4

- [ ] **Step 1: Run a local production smoke test**

Run:

```bash
PORT=4011 bun run start
curl -I http://127.0.0.1:4011/settings
curl -I http://127.0.0.1:4011/admin/audit
```

Expected:

- the server starts on the requested port
- both routes return `200 OK`
- the browser can download CSV files from the visible export buttons

- [ ] **Step 2: Review the staged diff before committing**

Run: `git diff --stat`
Expected: only the export utility, registry, Settings page, and the targeted page export buttons changed.

- [ ] **Step 3: Commit the export slice**

```bash
git add src/lib/csv-export.ts src/lib/csv-export.test.ts src/lib/export-registry.ts src/components/csv-export-button.tsx src/components/settings-export-card.tsx src/routes/_authenticated/settings.tsx src/routes/_authenticated/admin.audit.tsx src/routes/_authenticated/deals.tsx src/routes/_authenticated/customers.tsx src/routes/_authenticated/pipeline.tsx src/routes/_authenticated/notifications.tsx src/routes/_authenticated/documents.tsx src/routes/_authenticated/rewards.tsx src/routes/_authenticated/admin.users.tsx src/routes/_authenticated/admin.partners.tsx src/routes/_authenticated/admin.news.tsx src/routes/_authenticated/admin.catalog.tsx src/routes/_authenticated/admin.deals.tsx src/routes/_authenticated/admin.rewards.tsx src/routes/_authenticated/partner.team.tsx src/routes/_authenticated/partner.onboarding.tsx
git commit -m "feat: add csv export center"
```
