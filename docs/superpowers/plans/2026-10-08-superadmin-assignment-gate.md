# Superadmin Assignment Gate Bypass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow authenticated `super_admin` users into the application shell without an assignment or active context while preserving governed-access gates for partner accounts.

**Architecture:** Keep authorization data and server policy unchanged. Add one role-derived boolean in the authenticated route gate and use it only for the two UI provisioning branches; extend the existing auth-routing regression tests to assert that a superadmin is ready without governed context while a partner remains context-pending.

**Tech Stack:** TanStack Start, React, TypeScript, Bun test, ESLint, Vite production build.

---

### Task 1: Add regression coverage for superadmin gate readiness

**Files:**
- Modify: `src/lib/auth-routing.test.ts`
- Test: `src/lib/auth-routing.test.ts`

- [ ] **Step 1: Add the failing test**

Add this test after the existing governed super-admin test:

```ts
test("treats a super-admin session as ready without a governed context", () => {
  expect(
    getAuthenticatedGateState({
      hasSession: true,
      pathname: "/dashboard",
      roles: ["super_admin"],
      profile: {
        partner_status: "approved",
        must_reset_password: false,
      },
      hasGovernedContext: false,
    }),
  ).toBe("ready");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
bun test src/lib/auth-routing.test.ts
```

Expected: FAIL because `getAuthenticatedGateState` currently returns `"context-pending"` whenever `hasGovernedContext` is false.

### Task 2: Implement the UI gate bypass

**Files:**
- Modify: `src/routes/_authenticated.tsx:28-137`

- [ ] **Step 1: Derive the existing role in `Gate`**

Immediately after the `useAuth()` destructuring, add:

```ts
const isSuperAdmin = hasRole("super_admin");
```

- [ ] **Step 2: Bypass the missing-assignment branch only for superadmins**

Change:

```tsx
if (!assignment) {
```

to:

```tsx
if (!assignment && !isSuperAdmin) {
```

- [ ] **Step 3: Bypass the missing-context branch only for superadmins**

Change:

```tsx
if (gateState === "context-pending") {
```

to:

```tsx
if (gateState === "context-pending" && !isSuperAdmin) {
```

Do not synthesize `assignment` or `activeContext`; the shell renders with the existing null values and existing downstream role checks remain responsible for authorization.

### Task 3: Verify and commit the implementation

**Files:**
- Modify: `src/lib/auth-routing.test.ts`
- Modify: `src/routes/_authenticated.tsx`

- [ ] **Step 1: Run focused auth tests**

Run:

```bash
bun test src/lib/auth-routing.test.ts
```

Expected: all tests pass, including the new superadmin-without-context test and the existing partner context-pending test.

- [ ] **Step 2: Run typecheck, lint, and production build**

Run:

```bash
bunx tsc --noEmit
bun run lint
bun run build
```

Expected: each command exits successfully.

- [ ] **Step 3: Inspect the diff and confirm unrelated changes are untouched**

Run:

```bash
git diff -- src/lib/auth-routing.test.ts src/routes/_authenticated.tsx
git status --short
```

Expected: only the two implementation files contain new changes; pre-existing modified/untracked files remain outside this change.

- [ ] **Step 4: Commit only the implementation files**

Run:

```bash
git add src/lib/auth-routing.test.ts src/routes/_authenticated.tsx
git commit -m "fix: bypass assignment gate for super admins"
```

### Task 4: Push and deploy over SSH

**Files:**
- No source changes.

- [ ] **Step 1: Push the current main branch without rewriting history**

Run:

```bash
git push origin main
```

Expected: the new commits are accepted by `origin/main`; do not force-push, rebase, amend, or squash.

- [ ] **Step 2: Resolve the repository's existing SSH deployment instructions**

Inspect the tracked deployment configuration and SSH helper names before running deployment:

```bash
git remote -v
rg -n -i 'ssh|deploy|docker compose|railway|hostinger' --glob '!node_modules/**' --glob '!docs/**' .
```

Use the existing SSH host/command found in the repository or the current shell configuration; do not invent a production target.

- [ ] **Step 3: Deploy and check health**

Run the discovered SSH deployment command, then query the deployed health endpoint or service status over SSH. Confirm the rollout completed successfully and the service is healthy before reporting completion.
