# Super-admin access, user creation, and numeric input sanitation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair super-admin governance and capability resolution, make user creation reliable, and enforce sanitized numeric inputs across whole-number form controls.

**Architecture:** Add a focused governance helper in the server service that can idempotently provision a global super-admin assignment/context, use it during auth-context resolution, and return full capabilities for super-admins. Add pure input sanitizers and apply them to whole-number controls while retaining decimal support where appropriate. Keep database repair explicit and verifiable through a deployment script/command.

**Tech Stack:** TanStack Start server functions, PostgreSQL, React, TypeScript, Bun test runner, ESLint, Vite build, Docker Compose.

---

### Task 1: Add failing governance and capability regression tests

**Files:**
- Create: `src/server/superadmin-governance.test.ts`
- Modify: `src/server/rbac-policy.server.test.ts`

- [ ] **Step 1: Write failing tests**

Cover these behaviors with the existing test conventions:

```ts
test("super admins resolve full capabilities without a role-permission query", async () => {
  const capabilities = await capabilitiesForAuth({ roles: ["super_admin"], assignmentRole: null });
  expect(capabilities.users.read).toBe(true);
  expect(capabilities.integrations.read).toBe(true);
  expect(capabilities.distribution.delete).toBe(false);
});

test("missing super-admin governance is repaired idempotently", async () => {
  const first = await ensureSuperAdminGovernance(fakePool, "admin-1");
  const second = await ensureSuperAdminGovernance(fakePool, "admin-1");
  expect(first.assignmentId).toBe(second.assignmentId);
  expect(fakePool.activeAssignments("admin-1")).toHaveLength(1);
  expect(fakePool.activeContexts("admin-1")).toHaveLength(1);
});
```

Use the repository's existing mocked `pool.query` style; do not connect to production from unit tests.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test src/server/superadmin-governance.test.ts src/server/rbac-policy.server.test.ts
```

Expected: failures for the missing helper/full-capability behavior.

### Task 2: Implement idempotent super-admin governance repair

**Files:**
- Modify: `src/server/livey-service.server.ts`
- Modify: `src/domain/contracts/governance.ts` only if a canonical assignment/context factory is required
- Test: `src/server/superadmin-governance.test.ts`

- [ ] **Step 1: Implement the helper**

Add an exported helper with the shape:

```ts
export async function ensureSuperAdminGovernance(userId: string): Promise<{
  assignment: AssignmentRecord;
  activeContext: ActiveContextRecord;
}>;
```

Within one transaction, verify the profile still has a `super_admin` role, find an active global `super_admin` assignment and non-revoked active context, end/revoke duplicate active rows, and insert missing rows using `randomUUID()` plus `issueActiveContextFromAssignment`. Do not modify non-super-admin assignments. Make repeated calls return the same surviving active assignment/context.

- [ ] **Step 2: Call the helper while resolving super-admin auth state**

In `resolveAuthContextForProfile`, after loading roles and before returning governed state, call `ensureSuperAdminGovernance(profileId)` only when `roles.includes("super_admin")` and the loaded state is incomplete. Re-load the repaired state and return it. This ensures existing accounts self-heal on login without creating duplicates on every request.

- [ ] **Step 3: Run the focused tests**

```bash
bun test src/server/superadmin-governance.test.ts
```

Expected: all governance tests pass.

### Task 3: Make super-admin capabilities and assignment commands robust

**Files:**
- Modify: `src/server/rbac-policy.server.ts`
- Modify: `src/integrations/local/role-permission-commands.ts`
- Modify: `src/integrations/local/role-assignment-commands.ts` only if the repaired auth context does not fully cover the actor path
- Test: `src/server/rbac-policy.server.test.ts`

- [ ] **Step 1: Write the failing capability test**

Assert that `loadRoleCapabilities("super_admin")` returns every feature with `create/read/update=true` and preserves the intentional `distribution.delete=false` rule.

- [ ] **Step 2: Implement the explicit super-admin matrix**

In `loadRoleCapabilities`, return a full capability object for `super_admin` without relying on database seed rows. Keep distribution deletion false because inventory history is non-destructive by policy. Leave all other roles database-backed.

- [ ] **Step 3: Run focused tests**

```bash
bun test src/server/rbac-policy.server.test.ts src/server/role-assignment-commands.server.test.ts
```

Expected: all focused RBAC/assignment tests pass.

### Task 4: Add sanitized numeric input helpers and tests

**Files:**
- Create: `src/lib/input-sanitizers.ts`
- Create: `src/lib/input-sanitizers.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
test("sanitizeWholeNumber keeps only ASCII digits", () => {
  expect(sanitizeWholeNumber("12e+3abc! 4")).toBe("1234");
});

test("sanitizeDecimal keeps one decimal point and digits", () => {
  expect(sanitizeDecimal("1e+2.50.4abc")).toBe("12.504");
});

test("empty numeric input stays empty", () => {
  expect(sanitizeWholeNumber("")).toBe("");
  expect(sanitizeDecimal("")).toBe("");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test src/lib/input-sanitizers.test.ts
```

- [ ] **Step 3: Implement the pure helpers**

Use `/[^0-9]/g` for whole numbers. For decimals, remove non-digits/non-dots, keep the first dot, and remove later dots. Do not coerce to `Number` inside the helper so empty input remains editable.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test src/lib/input-sanitizers.test.ts
```

### Task 5: Apply sanitation to whole-number and decimal form controls

**Files:**
- Modify: `src/routes/_authenticated/partner.onboarding.tsx`
- Modify: `src/routes/_authenticated/customers.tsx`
- Modify: `src/components/customer-quick-create-dialog.tsx`
- Modify: `src/routes/_authenticated/admin.catalog.tsx`
- Modify: `src/routes/_authenticated/deals.tsx`
- Modify: `src/routes/_authenticated/admin.deals.tsx`
- Modify: `src/routes/_authenticated/admin.rewards.tsx`
- Modify: `src/components/distribution/stock-request-dialog.tsx`
- Modify: `src/components/distribution/stock-admin-panel.tsx`
- Modify: `src/components/distribution/stock-tracking-panel.tsx`
- Modify: `src/components/outreach/sequence-builder.tsx`
- Modify: `src/components/deal-line-items.tsx`
- Modify: `src/components/analytics-breakdown-dialog.tsx`
- Modify: relevant domain validators for values changed from `Number(...)` immediately

- [ ] **Step 1: Replace whole-number controls**

Use `type="text" inputMode="numeric" pattern="[0-9]*"` and sanitize in `onChange`, preserving an empty string during editing. Convert to a number only at submit/validation boundaries. Apply to years, counts, quantities, stock, health scores, and other non-negative integer fields.

- [ ] **Step 2: Sanitize decimal controls**

Use the decimal helper for amounts, rates, and percentages. Permit one decimal point; reject letters, exponent notation, signs, and other punctuation.

- [ ] **Step 3: Add submit-boundary validation**

Before requests are sent, reject values that are not `^[0-9]+$` for whole numbers or `^[0-9]+(?:\.[0-9]+)?$` for decimals, with field-specific validation messages. Preserve existing min/max constraints.

- [ ] **Step 4: Run helper and route tests**

```bash
bun test src/lib/input-sanitizers.test.ts src/lib/*.test.ts
```

Expected: no regressions and no non-numeric payloads accepted by the updated validators.

### Task 6: Add an explicit production repair command and deploy

**Files:**
- Create: `scripts/repair-superadmin-governance.ts`
- Modify: `package.json` to add `db:repair-superadmins`
- Test: `scripts/repair-superadmin-governance.test.ts` if script logic is extracted into a pure helper

- [ ] **Step 1: Implement an idempotent repair command**

The command must enumerate profiles joined to `user_roles` where role is `super_admin`, call the shared repair helper for each, and print counts of repaired/already-valid accounts. It must not truncate tables or change non-super-admin users.

- [ ] **Step 2: Run local typecheck/build checks**

```bash
bun run lint
bun run build
```

Expected: exit code 0.

- [ ] **Step 3: Commit implementation changes**

```bash
git add src/server src/lib src/routes src/components scripts package.json
git commit -m "fix: restore superadmin access and sanitize numeric inputs"
```

- [ ] **Step 4: Push/deploy without rewriting history**

Because the remote checkout contains unrelated uncommitted changes, first inspect its status again. Use a fast-forward-safe update or transfer only the implementation commit/files; do not force-push, reset, rebase, or overwrite those remote changes.

- [ ] **Step 5: Repair and verify production data**

Run the repair command inside the app container, then query:

```sql
SELECT p.email,
       count(*) FILTER (WHERE a.status = 'active') AS active_assignments,
       count(*) FILTER (WHERE ac.revoked_at IS NULL) AS active_contexts
FROM profiles p
JOIN user_roles ur ON ur.user_id = p.id AND ur.role = 'super_admin'
LEFT JOIN assignments a ON a.user_id = p.id
LEFT JOIN active_contexts ac ON ac.user_id = p.id
GROUP BY p.id, p.email
ORDER BY p.email;
```

Expected: every existing super-admin has one active assignment and one non-revoked context.

- [ ] **Step 6: Live smoke test**

At `http://46.202.160.107:3000`, sign in as a super-admin, confirm all intended sidebar modules are visible, create a disposable test user, confirm it appears in the directory with an active assignment, and remove only the disposable account if the product supports safe deletion. Check app logs for errors after the test.
