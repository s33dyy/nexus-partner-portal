# LIVEY CRM Deal, RBAC, and Access-Control Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Fix the requested catalogue, company, currency, deal, task, regional-access, verification, and browser-ID failures while adding user-level CRUD access and an admin access-control configuration panel.

**Architecture:** Preserve governed assignments and partner tenant boundaries. Add a server-owned effective-access resolver where role CRUD is the default and explicit per-user rules override it; route task/deal/company/catalog commands and scoped reads through that resolver.

**Tech Stack:** TanStack Start, React, TypeScript, Bun tests, PostgreSQL/Supabase migrations, existing createServerFn wrappers, shadcn-style UI.

---

## Baseline constraints

- Work in the current checkout because it already contains user changes; do not reset, rebase, force-push, or stage unrelated files.
- Baseline bun test: 854 passing, 7 failing, and 5 errors. The errors are Playwright files loaded by Bun; failures include existing approval-threshold expectations. Use focused tests for each task and report unrelated failures separately.

### Task 1: Effective role and user access contracts

**Files:**
- Create: supabase/migrations/20261013000000_user_access_overrides.sql
- Modify: src/domain/contracts/features.ts
- Modify: src/server/rbac-policy.server.ts
- Test: src/server/rbac-policy.server.test.ts

- [ ] Step 1: Write failing tests for role defaults, explicit user allow/deny overrides, inheritance when absent, and immutable Super Admin authority.

    test("user override replaces the role decision", async () => {
      expect(resolveEffectiveCapability({
        role: "rm", feature: "tasks", operation: "delete",
        roleAllowed: false, userOverride: true,
      })).toBe(true);
    });

    test("missing override inherits the role decision", () => {
      expect(resolveEffectiveCapability({
        role: "partner_admin", feature: "tasks", operation: "update",
        roleAllowed: true, userOverride: null,
      })).toBe(true);
    });

    test("super_admin keeps structural authority", () => {
      expect(resolveEffectiveCapability({
        role: "super_admin", feature: "users", operation: "delete",
        roleAllowed: false, userOverride: false,
      })).toBe(true);
    });

- [ ] Step 2: Run bun test src/server/rbac-policy.server.test.ts and verify it fails because the resolver does not exist.
- [ ] Step 3: Add user_access_overrides keyed by (user_id, feature_key, operation), with explicit allow/deny decision, actor, timestamps, profile foreign keys, and Super Admin-only RLS.
- [ ] Step 4: Add typed override data, resolveEffectiveCapability, and loadEffectiveCapabilities(userId, roleKey) in src/server/rbac-policy.server.ts. Super Admin remains structurally full-access.
- [ ] Step 5: Run bun test src/server/rbac-policy.server.test.ts and verify it passes.
- [ ] Step 6: Commit only these task files:

    git add supabase/migrations/20261013000000_user_access_overrides.sql src/domain/contracts/features.ts src/server/rbac-policy.server.ts src/server/rbac-policy.server.test.ts
    git commit -m "feat: add effective user access overrides"

### Task 2: Server commands for RBAC and user access administration

**Files:**
- Modify: src/server/role-assignment-commands.server.ts
- Modify: src/integrations/local/role-permission-commands.ts
- Create: src/server/access-control-commands.server.test.ts
- Modify: src/server/table-policy.server.ts

- [ ] Step 1: Write a failing test for Super Admin-only user override saves:

    test("saveUserAccessOverride rejects a non-super-admin actor", async () => {
      const result = await saveUserAccessOverride({
        actor: buildActor({ roleKey: "rm" }),
        userId: "user-2", featureKey: "tasks",
        operation: "delete", decision: "allow",
      });
      expect(result.ok).toBe(false);
      expect(result.failure.code).toBe("POLICY_DENIED");
    });

- [ ] Step 2: Run bun test src/server/access-control-commands.server.test.ts and verify the expected failure.
- [ ] Step 3: Implement loadAccessControlSnapshot, saveRolePermissions, saveUserAccessOverride, removeUserAccessOverride, and loadEffectiveUserCapabilities, reusing command envelopes, correlation IDs, and audit/outbox patterns.
- [ ] Step 4: Add integration wrappers returning field-safe errors. Update getMyCapabilities to load effective user access rather than role-only access.
- [ ] Step 5: Extend table policy so overrides affect feature capability checks but never bypass geography, tenant, participant, lifecycle, or surface-flag constraints.
- [ ] Step 6: Run bun test src/server/access-control-commands.server.test.ts src/server/rbac-policy.server.test.ts src/server/table-policy.server.test.ts, then commit the four task files with feat: enforce user access overrides server-side.

### Task 3: Task-list RBAC, user-based access, and task CRUD

**Files:**
- Modify: src/server/task-commands.server.ts
- Modify: src/integrations/local/task-commands.ts
- Modify: src/routes/_authenticated/tasks.tsx
- Modify: src/server/task-commands.server.test.ts
- Modify: src/server/table-policy.server.test.ts

- [ ] Step 1: Write failing tests for scoped reads; create-for-other-user permissions for Super Admin/RM/KAM/PAM/Partner Admin; update/delete checks; and lifecycle transitions remaining command-owned.

    test("an in-scope PAM may assign a task to another user", async () => {
      const result = await createTask({
        actor: buildActor({ roleKey: "pam" }),
        data: { title: "Review renewal", assigneeId: "user-2", partnerId: "partner-1" },
      });
      expect(result.ok).toBe(true);
    });

    test("task lifecycle remains command-owned", async () => {
      const result = await updateTask({
        actor: buildActor({ roleKey: "super_admin" }),
        taskId: "task-1", patch: { status: "completed" },
      });
      expect(result.ok).toBe(false);
    });

- [ ] Step 2: Run bun test src/server/task-commands.server.test.ts and confirm the new behaviors fail.
- [ ] Step 3: Add task CRUD commands with effective capability checks, governed actor/scope checks, optimistic concurrency, audit events, and safe creator/assignee validation. Keep transitionTask and setTaskProposedCompletion as lifecycle paths.
- [ ] Step 4: Replace the task route’s broad client read with a scoped server loader/command and add assignee/creator fields. Add create, edit, and delete controls based on effective capabilities and server responses.
- [ ] Step 5: Add scoped user selection to task creation/editing, defaulting to the current user.
- [ ] Step 6: Run bun test src/server/task-commands.server.test.ts src/server/table-policy.server.test.ts, lint touched task files, then commit with feat: enforce task list RBAC and CRUD access.

### Task 4: Admin access-control configuration panel

**Files:**
- Modify: src/routes/_authenticated/admin.roles.tsx
- Modify: src/integrations/local/role-permission-commands.ts
- Create: src/components/access-control/access-control-view.test.tsx

- [ ] Step 1: Write failing component tests for role-matrix editing, user selection, CRUD override controls, inherited/allowed/denied labels, reset-to-role behavior, and Super Admin-only rendering.

    test("user access panel distinguishes an override from inheritance", () => {
      render(<AccessControlUserPanel snapshot={snapshotWithTasksDeleteOverride} />);
      expect(screen.getByText("Explicit user override")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reset to role default" })).toBeInTheDocument();
    });

- [ ] Step 2: Run bun test src/components/access-control/access-control-view.test.tsx and verify it fails.
- [ ] Step 3: Refactor the existing role page into Role defaults and User access tabs. Keep the current role CRUD table; add searchable user selection, effective-access preview for Tasks/Deals/Customers/Catalog/Users, explicit Allow/Deny/Inherited state, and reset controls.
- [ ] Step 4: Wire saves to server commands with loading, field-level errors, success confirmation, and an immediate-application explanation. The browser must not write permission tables directly.
- [ ] Step 5: Run bun test src/components/access-control/access-control-view.test.tsx src/server/access-control-commands.server.test.ts and commit with feat: add user access controls to admin panel.

### Task 5: Deal creation, lookups, pricing, approval, and browser IDs

**Files:**
- Modify: src/routes/_authenticated/deals.tsx
- Modify: src/server/deal-commands.server.ts
- Modify: src/server/dropdown-sources.server.ts
- Modify: src/integrations/local/client.ts
- Create: src/lib/browser-id.ts
- Test: src/server/deal-commands.server.test.ts
- Test: src/server/dropdown-sources.server.test.ts
- Test: src/lib/browser-id.test.ts

- [ ] Step 1: Write failing tests for Partner/POC lookup IDs, catalogue price times quantity, currency symbol selection, amount_usd greater than 100 approval, and browser IDs when crypto.randomUUID is absent.
- [ ] Step 2: Run bun test src/server/deal-commands.server.test.ts src/lib/browser-id.test.ts and verify feature-related failures.
- [ ] Step 3: Implement browser-safe ID generation using crypto.randomUUID when available and a standards-compatible fallback otherwise; replace browser-side direct calls only.
- [ ] Step 4: Repair deal form state: select Partner and POC by ID, load scoped options, display Customer Budget Per Unit and Price Per Unit, populate price from catalogue, derive currency from region, and remove dropdown-as-value serialization.
- [ ] Step 5: Update server deal validation for partner/POC scope, catalogue price, unit fields, currency, role capability, and approval state. Keep approval strictly above 100 normalized USD.
- [ ] Step 6: Run the focused deal, dropdown, and browser-id tests, then commit with fix: repair deal creation lookups pricing and ids.

### Task 6: Field terminology, company validation, currency, regional filters, and role editing

**Files:**
- Modify: src/routes/_authenticated/admin.catalog.tsx
- Modify: src/routes/_authenticated/customers.tsx
- Modify: src/routes/_authenticated/pipeline.tsx
- Modify: src/server/dropdown-sources.server.ts
- Modify: src/lib/deal-filters.ts
- Modify: src/domain/contracts/reference-data.ts
- Create: supabase/migrations/20261013010000_company_field_semantics.sql
- Test: src/domain/contracts/reference-data.test.ts
- Test: src/lib/deal-filters.test.ts

- [ ] Step 1: Write failing tests for Product Class, Employee Count/Credibility, renewal eligibility, region currency symbols, advanced role filters, and edit capability for requested roles.
- [ ] Step 2: Run bun test src/domain/contracts/reference-data.test.ts src/lib/deal-filters.test.ts and verify red.
- [ ] Step 3: Add additive company fields with explicit backfill rules; enforce renewal eligibility server-side for LIVEYfy and RC.
- [ ] Step 4: Update labels, exports, validation, and currency formatting across catalogue/company/pipeline/deal surfaces.
- [ ] Step 5: Add KAM/PAM/Partner Admin/Partner User filters to Pipeline and Deals, bound to scoped server queries rather than client-only filtering.
- [ ] Step 6: Run focused tests, lint touched files, and commit with fix: align CRM fields currency and regional filters.

### Task 7: Guarded test-mode verification bypass

**Files:**
- Modify: src/server/signup-verification.server.ts
- Modify: src/routes/auth.tsx
- Test: src/server/signup-verification.server.test.ts

- [ ] Step 1: Write failing tests for opt-in local/staging bypass, production refusal, and unchanged authenticated WhatsApp linking.
- [ ] Step 2: Run bun test src/server/signup-verification.server.test.ts and confirm red.
- [ ] Step 3: Implement a server-side bypass guard requiring the explicit flag and rejecting it when NODE_ENV=production. Return capability state so the client renders one-step or OTP flow correctly.
- [ ] Step 4: Run the focused verification tests and commit with feat: add guarded test-mode signup verification bypass.

### Task 8: Full verification and requirement audit

**Files:**
- Review: all files changed by Tasks 1–7

- [ ] Step 1: Run:
  bun test src/server/rbac-policy.server.test.ts src/server/access-control-commands.server.test.ts src/server/task-commands.server.test.ts src/server/deal-commands.server.test.ts src/server/signup-verification.server.test.ts src/domain/contracts/reference-data.test.ts src/lib/deal-filters.test.ts src/lib/browser-id.test.ts
- [ ] Step 2: Run touched-file eslint over all files changed by Tasks 1–7.
- [ ] Step 3: Run bun run build.
- [ ] Step 4: Audit every requested item, record baseline-only failures, verify no unrelated files are staged, and confirm no published history is rewritten.
- [ ] Step 5: Report exact test, lint, build, and migration results before any push or deployment.
