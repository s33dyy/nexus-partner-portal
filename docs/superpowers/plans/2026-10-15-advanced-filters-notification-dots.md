# Advanced Filters and Notification Dots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consistent client-side advanced filters/search to Deals, Pipeline, Tasks, Deal Approvals, Customers, and Users & Roles, then add truthful red notification dots for actionable or unread work.

**Architecture:** A small pure filter utility will centralize text, numeric-range, date-range, and active-filter behavior. Each route will keep its domain-specific filter state and field options local, applying predicates after existing RBAC/geography scoping. The authenticated shell will derive badge counts from the same scoped loaders used by notifications, approvals, and tasks, without inventing counts or changing read state.

**Tech Stack:** TanStack Start, React, TypeScript, Zod, existing shadcn-style UI components, Vitest/Bun tests.

---

### Task 1: Add tested shared filter primitives

**Files:**
- Create: `src/lib/advanced-filters.ts`
- Create: `src/lib/advanced-filters.test.ts`

- [ ] **Step 1: Write failing unit tests** for case-insensitive text matching, exact option matching, inclusive number ranges, inclusive ISO-date ranges, active-filter counting, and empty-value handling.

```ts
import { describe, expect, it } from "vitest";
import { countActiveFilters, matchesAdvancedFilters, normalizeFilterText } from "./advanced-filters";

describe("advanced filter primitives", () => {
  it("matches text without case or whitespace sensitivity", () => {
    expect(normalizeFilterText("  Partner Admin ")).toBe("partner admin");
    expect(matchesAdvancedFilters({ name: "North Star" }, { text: "star" }, ["name"])).toBe(true);
  });

  it("applies exact options and inclusive ranges", () => {
    expect(matchesAdvancedFilters({ status: "open", amount: 100 }, { status: "open", amountMin: 100, amountMax: 200 }, ["status"])).toBe(true);
    expect(matchesAdvancedFilters({ status: "closed", amount: 300 }, { status: "open", amountMax: 200 }, ["status"])).toBe(false);
  });

  it("applies inclusive date ranges and counts only active values", () => {
    expect(matchesAdvancedFilters({ closeDate: "2026-10-15" }, { dateFrom: "2026-10-15", dateTo: "2026-10-15" }, ["closeDate"])).toBe(true);
    expect(countActiveFilters({ query: "", status: "open", amountMin: undefined, amountMax: 100 })).toBe(2);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails** with missing-module or missing-export errors.

Run: `bun test src/lib/advanced-filters.test.ts`

- [ ] **Step 3: Implement the pure helpers** with typed record access, normalized strings, inclusive range comparisons, and active-value counting; preserve `0` as an active numeric filter.

- [ ] **Step 4: Run the focused test and verify it passes.**

Run: `bun test src/lib/advanced-filters.test.ts`

- [ ] **Step 5: Commit the shared utility.**

```bash
git add src/lib/advanced-filters.ts src/lib/advanced-filters.test.ts
git commit -m "feat: add shared advanced filter predicates"
```

### Task 2: Build reusable advanced-filter controls

**Files:**
- Modify: `src/components/page-header.tsx`
- Create: `src/components/advanced-filters.tsx`

- [ ] **Step 1: Add a typed `AdvancedFilters` panel** supporting children, active count, clear-all callback, open/close state, and an accessible label.
- [ ] **Step 2: Add reusable text, select, numeric-range, and date-range field wrappers** using existing `Input`, `Select`, `Button`, and `cn` conventions.
- [ ] **Step 3: Render the active count and `Clear all` only when filters are active; keep all controls keyboard accessible.**
- [ ] **Step 4: Run TypeScript/lint checks for the new component.**

Run: `bunx eslint src/components/advanced-filters.tsx src/components/page-header.tsx`

- [ ] **Step 5: Commit the shared controls.**

```bash
git add src/components/advanced-filters.tsx src/components/page-header.tsx
git commit -m "feat: add reusable advanced filter panel"
```

### Task 3: Add advanced filters to Deals and Pipeline

**Files:**
- Modify: `src/routes/_authenticated/deals.tsx`
- Modify: `src/routes/_authenticated/pipeline.tsx`
- Modify: `src/lib/deal-filters.ts`
- Test: `src/lib/deal-filters.test.ts`

- [ ] **Step 1: Extend the deal filter model/tests** for country, region, product, currency, amount, probability, and close-date predicates while retaining existing search, stage, status, and owner-role behavior.
- [ ] **Step 2: Add local advanced-filter state** to both routes and calculate filtered rows only after existing region/RBAC scoping.
- [ ] **Step 3: Add the panel to each route toolbar** with fields for KAM, PAM, Partner Admin, and Partner User owner-role options plus the requested deal attributes.
- [ ] **Step 4: Verify `Clear all` restores the existing visible set and that pipeline deal pills remain clickable.**
- [ ] **Step 5: Run focused tests and lint.**

Run: `bun test src/lib/deal-filters.test.ts && bunx eslint src/routes/_authenticated/deals.tsx src/routes/_authenticated/pipeline.tsx src/lib/deal-filters.ts`

- [ ] **Step 6: Commit the Deals/Pipeline filters.**

```bash
git add src/routes/_authenticated/deals.tsx src/routes/_authenticated/pipeline.tsx src/lib/deal-filters.ts src/lib/deal-filters.test.ts
git commit -m "feat: add advanced deal and pipeline filters"
```

### Task 4: Add advanced filters to Tasks

**Files:**
- Modify: `src/routes/_authenticated/tasks.tsx`
- Modify: `src/server/task-commands.server.ts` only if an existing scoped field is not returned
- Test: `src/lib/advanced-filters.test.ts`

- [ ] **Step 1: Map the loaded task fields** to title/description, status, priority, assignee, creator, due date, and overdue state without changing task CRUD or delegation behavior.
- [ ] **Step 2: Add the panel and apply filters after current access scoping.**
- [ ] **Step 3: Include a red overdue/actionable visual only in the filter result; do not mutate task data.**
- [ ] **Step 4: Verify task creation still uses the selected assignee and that filtering does not alter delegation payloads.**
- [ ] **Step 5: Run focused lint/tests and commit.**

```bash
git add src/routes/_authenticated/tasks.tsx src/server/task-commands.server.ts src/lib/advanced-filters.test.ts
git commit -m "feat: add advanced task filters"
```

### Task 5: Add advanced filters to Deal Approvals

**Files:**
- Modify: `src/routes/_authenticated/admin.deals.tsx`
- Modify: `src/lib/deal-filters.ts`

- [ ] **Step 1: Preserve existing approval and region predicates** and add search, approval state, stage, owner, partner, region, country, amount range, and submission-date range fields.
- [ ] **Step 2: Render the advanced panel beside existing approval controls** and display an active-filter count.
- [ ] **Step 3: Verify approval actions remain available only to authorized roles and `Clear all` does not bypass scoped access.**
- [ ] **Step 4: Run lint and the deal filter test suite.**

```bash
bun test src/lib/deal-filters.test.ts && bunx eslint src/routes/_authenticated/admin.deals.tsx src/lib/deal-filters.ts
```

- [ ] **Step 5: Commit the approval filters.**

```bash
git add src/routes/_authenticated/admin.deals.tsx src/lib/deal-filters.ts
git commit -m "feat: add advanced deal approval filters"
```

### Task 6: Add advanced filters to Customers and Users & Roles

**Files:**
- Modify: `src/routes/_authenticated/customers.tsx`
- Modify: `src/routes/_authenticated/admin.users.tsx`
- Modify: `src/routes/_authenticated/admin.roles.tsx`

- [ ] **Step 1: Add customer filters** for company/owner search, status, country, region, segment, renewal type, credibility range, and employee-count range after existing scoped customer data.
- [ ] **Step 2: Add user filters** for name/email/company search, role, partner, region, country, account status, and verification status.
- [ ] **Step 3: Add role-page search/filter controls** for role name, scope, and capability state while retaining existing role editing permissions.
- [ ] **Step 4: Verify customer Renewal Type remains distinct from company records and that user/role CRUD controls retain RBAC.**
- [ ] **Step 5: Run focused lint/tests and commit.**

```bash
bunx eslint src/routes/_authenticated/customers.tsx src/routes/_authenticated/admin.users.tsx src/routes/_authenticated/admin.roles.tsx
git add src/routes/_authenticated/customers.tsx src/routes/_authenticated/admin.users.tsx src/routes/_authenticated/admin.roles.tsx
git commit -m "feat: add advanced customer user and role filters"
```

### Task 7: Add truthful notification-dot counts

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/routes/_authenticated/notifications.tsx` only if a shared unread-count loader is not available
- Inspect/use: existing deal approval and task list commands
- Test: `src/lib/notification-counts.test.ts`

- [ ] **Step 1: Write unit tests** for pending approval count, unread notification count, and incomplete/newly-assigned task count, including zero-count behavior.
- [ ] **Step 2: Implement a typed notification-count helper** that consumes already scoped records and never fabricates counts for empty or inaccessible data.
- [ ] **Step 3: Load counts in the authenticated shell** using existing loaders/queries and add a small red dot with accessible text beside Deal Approvals, Tasks, and Notifications only when count is positive.
- [ ] **Step 4: Refresh counts after relevant mutations and normal route/data refresh without marking records read on navigation.**
- [ ] **Step 5: Run focused tests/lint and commit.**

```bash
bun test src/lib/notification-counts.test.ts && bunx eslint src/components/app-shell.tsx src/routes/_authenticated/notifications.tsx
git add src/components/app-shell.tsx src/routes/_authenticated/notifications.tsx src/lib/notification-counts.test.ts
git commit -m "feat: add actionable notification dots"
```

### Task 8: Full verification, build, deployment, and browser smoke test

**Files:**
- No additional source files unless verification exposes a defect.

- [ ] **Step 1: Run focused and full checks.**

```bash
bun test src/lib/advanced-filters.test.ts src/lib/deal-filters.test.ts src/lib/notification-counts.test.ts
bun run lint
bun run build
```

- [ ] **Step 2: Inspect the final diff and confirm unrelated dirty files remain unstaged.**
- [ ] **Step 3: Push the focused commits to `main` without rewriting history.**
- [ ] **Step 4: Deploy with the existing SSH/Docker workflow** at `/root/nexus-partner-portal`, rebuilding only the app container and running the migration command without destructive database operations.
- [ ] **Step 5: Verify live HTTP health for `/deals`, `/pipeline`, `/tasks`, `/admin/deals`, `/customers`, `/admin/users`, `/admin/roles`, and `/notifications`.**
- [ ] **Step 6: Use the in-app browser to confirm each panel opens, each representative filter changes visible rows, `Clear all` restores rows, role filters are visible, and red dots match pending/unread data.**
- [ ] **Step 7: Report any remaining gaps with route, role, and evidence rather than claiming untested CRUD behavior.**

