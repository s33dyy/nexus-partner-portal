# Zoho Sign Agreement Flow Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the partner agreement workflow so super admins upload a fresh partner-specific PDF, send it through Zoho Sign, partners keep basic access while waiting, and super admins perform the final approval after Zoho completion.

**Architecture:** Keep Zoho Sign as the only signing provider, but turn the agreement lifecycle into a shared state machine that every permission check and UI surface uses. The source of truth stays in Postgres through `profiles.partner_status` and `partners.status`, with a new signed-review state inserted between Zoho completion and final approval. Admin sending becomes a partner-specific upload-and-send action, while partner-facing screens become read-only status views with no manual upload fallback.

**Tech Stack:** TanStack Start, React, TypeScript, PostgreSQL, server-side Postgres helpers, Zoho Sign API, Supabase-style local client, Bun test runner, Radix/shadcn UI, TanStack Router.

---

## File Structure Map

- `db/schema.sql` owns the partner status enum and partner agreement columns.
- `supabase/migrations/20260726000001_signed_pending_review.sql` adds the database migration for existing environments.
- `src/server/livey-service.server.ts` owns the local-server `PartnerStatus` union and the table-column allowlist for partner rows.
- `src/hooks/use-auth.tsx` owns the authenticated profile status type.
- `src/lib/partner-status.ts` owns status arrays, labels, and access helpers.
- `src/hooks/use-partner-access.ts` owns access-level logic and redirect behavior.
- `src/routes/_authenticated.tsx` owns the auth gate and onboarding/agreement routing.
- `src/components/app-shell.tsx` owns the shared top banner and status badge.
- `src/components/app-sidebar.tsx` owns status-aware navigation visibility.
- `src/components/agreement-pending-banner.tsx` owns the partner-facing action banner.
- `src/components/partner-access-badge.tsx` owns the compact status badge labels.
- `src/routes/_authenticated/dashboard.tsx` owns the dashboard agreement card copy.
- `src/routes/_authenticated/partner.tsx` owns the partner summary page.
- `src/routes/_authenticated/partner.onboarding.tsx` owns post-submission redirects.
- `src/routes/_authenticated/admin.users.tsx` keeps the Users & Roles surface from bypassing the agreement workflow.
- `src/lib/zoho-sign.ts` owns Zoho request building and helper utilities.
- `src/server/zoho-api.server.ts` owns the Zoho send/callback/webhook endpoints.
- `src/routes/_authenticated/admin.partners.tsx` owns the super-admin upload/send/review sheet.
- `src/routes/_authenticated/partner.agreement.tsx` owns the partner-facing agreement status page.
- `src/lib/partner-workflow-copy.ts` centralizes agreement-banner and agreement-page copy.
- `src/lib/partner-status.test.ts`, `src/lib/zoho-sign.test.ts`, and `src/lib/partner-workflow-copy.test.ts` cover the core regression points.

---

### Task 1: Normalize partner workflow states and access rules

**Files:**
- Create: `src/lib/partner-status.test.ts`
- Modify: `db/schema.sql`
- Create: `supabase/migrations/20260726000001_signed_pending_review.sql`
- Modify: `src/server/livey-service.server.ts`
- Modify: `src/hooks/use-auth.tsx`
- Modify: `src/lib/partner-status.ts`
- Modify: `src/hooks/use-partner-access.ts`
- Modify: `src/routes/_authenticated.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/components/agreement-pending-banner.tsx`
- Modify: `src/components/partner-access-badge.tsx`
- Modify: `src/routes/_authenticated/dashboard.tsx`
- Modify: `src/routes/_authenticated/partner.tsx`
- Modify: `src/routes/_authenticated/partner.onboarding.tsx`
- Modify: `src/routes/_authenticated/admin.users.tsx`

- [ ] **Step 1: Write the failing status regression test**

```ts
import { expect, test } from "bun:test";
import {
  PARTNER_STATUSES,
  getStatusLabel,
  hasFullAccess,
  hasPartialAccess,
} from "@/lib/partner-status";

test("signed_pending_review stays in basic access but not full access", () => {
  expect(PARTNER_STATUSES).toContain("signed_pending_review");
  expect(hasPartialAccess("signed_pending_review")).toBe(true);
  expect(hasFullAccess("signed_pending_review")).toBe(false);
  expect(getStatusLabel("signed_pending_review")).toBe("Signed - Awaiting Review");
});
```

- [ ] **Step 2: Run the test so it fails before the implementation lands**

Run: `bun test src/lib/partner-status.test.ts -v`
Expected: fail because `signed_pending_review` is not yet part of the shared status model.

- [ ] **Step 3: Implement the shared status model and permission gates**

```ts
export const PARTNER_STATUSES = [
  "pending_partner_registration",
  "submitted",
  "under_review",
  "partial_approval",
  "pending_agreement",
  "signed_pending_review",
  "approved",
  "rejected",
  "need_more_info",
] as const;

export const PARTIAL_ACCESS_STATUSES: PartnerStatus[] = [
  "partial_approval",
  "pending_agreement",
  "signed_pending_review",
];

export const FULL_ACCESS_STATUSES: PartnerStatus[] = ["approved"];
```

Update the route gate and access hook so:

```ts
const isAgreementState =
  status === "partial_approval" ||
  status === "pending_agreement" ||
  status === "signed_pending_review";

return {
  canAccessDashboard: isAgreementState || hasFull,
  canAccessDeals: hasFull,
  canAccessPipeline: hasFull,
  canAccessCustomers: hasFull,
  canAccessAnalytics: hasFull,
  canAccessRewards: isAgreementState || hasFull,
  canAccessDocuments: isAgreementState || hasFull,
  canUploadDocuments: canUploadDocuments(status),
  canAccessSettings: isAgreementState || hasFull,
  canAccessNews: isAgreementState || hasFull,
  canAccessPartnerAgreement: isAgreementState,
};
```

Also update:

- `src/hooks/use-auth.tsx` so the profile union includes `signed_pending_review`
- `src/server/livey-service.server.ts` so the local server `PartnerStatus` union includes `signed_pending_review`
- `src/server/livey-service.server.ts` partner table columns so the new `agreement_source_doc_path` column is queryable
- `db/schema.sql` so the partner enum and partner table include `signed_pending_review` and `agreement_source_doc_path`
- `src/routes/_authenticated/admin.users.tsx` so the status dropdown includes the new state, but the page no longer acts as a shortcut around the agreement review flow
- `src/routes/_authenticated/admin.users.tsx` so the "Approve user" action is restricted to the user types that are allowed to bypass partner agreement review
- `src/routes/_authenticated.tsx`, `src/components/app-shell.tsx`, `src/components/app-sidebar.tsx`, `src/components/agreement-pending-banner.tsx`, `src/components/partner-access-badge.tsx`, `src/routes/_authenticated/dashboard.tsx`, `src/routes/_authenticated/partner.tsx`, and `src/routes/_authenticated/partner.onboarding.tsx` so every redirect and banner treats `signed_pending_review` as basic access, not full access

- [ ] **Step 4: Re-run the regression test and typecheck**

Run: `bun test src/lib/partner-status.test.ts -v`
Expected: pass.

Run: `bunx tsc --noEmit`
Expected: pass, or only surface unrelated pre-existing type errors.

- [ ] **Step 5: Commit the shared-state changes**

```bash
git add db/schema.sql supabase/migrations/20260726000001_signed_pending_review.sql src/server/livey-service.server.ts src/hooks/use-auth.tsx src/lib/partner-status.ts src/hooks/use-partner-access.ts src/routes/_authenticated.tsx src/components/app-shell.tsx src/components/app-sidebar.tsx src/components/agreement-pending-banner.tsx src/components/partner-access-badge.tsx src/routes/_authenticated/dashboard.tsx src/routes/_authenticated/partner.tsx src/routes/_authenticated/partner.onboarding.tsx src/routes/_authenticated/admin.users.tsx src/lib/partner-status.test.ts
git commit -m "feat: align partner access with agreement review flow"
```

---

### Task 2: Add fresh PDF upload and Zoho Sign send/review flow

**Files:**
- Create: `src/lib/zoho-sign.test.ts`
- Modify: `src/lib/zoho-sign.ts`
- Modify: `src/server/zoho-api.server.ts`
- Modify: `src/routes/_authenticated/admin.partners.tsx`

- [ ] **Step 1: Write the failing Zoho helper test**

```ts
import { expect, test } from "bun:test";
import {
  buildAgreementRequestName,
  buildAgreementSourceFilePath,
} from "@/lib/zoho-sign";

test("fresh agreement uploads are partner-specific", () => {
  expect(buildAgreementRequestName("Acme Labs")).toBe(
    "LIVEY Partner Agreement — Acme Labs",
  );
  expect(buildAgreementSourceFilePath("partner-123", 1710000000000)).toBe(
    "partner-123/agreement-source-1710000000000.pdf",
  );
});
```

- [ ] **Step 2: Run the test so it fails before the implementation lands**

Run: `bun test src/lib/zoho-sign.test.ts -v`
Expected: fail because the new helper functions do not exist yet.

- [ ] **Step 3: Implement the upload-and-send workflow**

Add helper functions in `src/lib/zoho-sign.ts` so request building is deterministic and testable:

```ts
export function buildAgreementRequestName(companyName: string) {
  return `LIVEY Partner Agreement — ${companyName}`;
}

export function buildAgreementSourceFilePath(partnerId: string, timestampMs: number) {
  return `${partnerId}/agreement-source-${timestampMs}.pdf`;
}
```

Update `src/server/zoho-api.server.ts` so `handleZohoSendAgreement`:

```ts
const form = await request.formData();
const file = form.get("file");
if (!(file instanceof File)) {
  return new Response(JSON.stringify({ error: "Agreement PDF is required" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}
```

Then:

- persist the uploaded PDF as the partner-specific source agreement document
- create the Zoho request from that exact upload
- write `agreement_source_doc_path`, `agreement_envelope_id`, `agreement_sent_at`, `agreement_provider`, and `status = 'pending_agreement'`
- update `profiles.partner_status = 'pending_agreement'`
- keep the existing Zoho OAuth token refresh logic intact
- keep the webhook verification intact
- change the webhook completion handler so Zoho completion moves the record to `signed_pending_review`, not `approved`
- keep the final approval action separate from the webhook so the super admin still has to review the signed return
- add or keep a refresh/resync path that looks up the Zoho request status from the stored request id

Update `src/routes/_authenticated/admin.partners.tsx` so the partner sheet:

- requires a PDF upload before sending
- sends the upload and partner metadata together as `FormData`
- shows the current Zoho status, sent time, and source document details
- exposes a refresh/resync action for delayed webhook delivery
- only enables the final approval action when the partner is already in `signed_pending_review`
- removes the old manual-upload confirmation path from the super-admin sheet because the signing flow is now Zoho-only

- [ ] **Step 4: Re-run the Zoho helper test and typecheck**

Run: `bun test src/lib/zoho-sign.test.ts -v`
Expected: pass.

Run: `bunx tsc --noEmit`
Expected: pass, or only surface unrelated pre-existing type errors.

- [ ] **Step 5: Commit the Zoho workflow changes**

```bash
git add src/lib/zoho-sign.ts src/lib/zoho-sign.test.ts src/server/zoho-api.server.ts src/routes/_authenticated/admin.partners.tsx
git commit -m "feat: require fresh agreement uploads for zoho sign"
```

---

### Task 3: Sweep partner-facing UI copy and remove manual upload fallback

**Files:**
- Create: `src/lib/partner-workflow-copy.ts`
- Create: `src/lib/partner-workflow-copy.test.ts`
- Modify: `src/routes/_authenticated/partner.agreement.tsx`
- Modify: `src/components/agreement-pending-banner.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/routes/_authenticated/dashboard.tsx`
- Modify: `src/routes/_authenticated/partner.tsx`
- Modify: `src/components/app-sidebar.tsx`
- Modify: `src/components/partner-access-badge.tsx`
- Modify: `src/routes/_authenticated/partner.onboarding.tsx`

- [ ] **Step 1: Write the failing UI-copy regression test**

```ts
import { expect, test } from "bun:test";
import { getAgreementPanelCopy } from "@/lib/partner-workflow-copy";

test("signed_pending_review is read-only and does not offer upload language", () => {
  const copy = getAgreementPanelCopy("signed_pending_review");

  expect(copy.title).toBe("Signed agreement awaiting review");
  expect(copy.primaryActionLabel).toBeNull();
  expect(copy.body).not.toContain("upload");
});
```

- [ ] **Step 2: Run the test so it fails before the refactor lands**

Run: `bun test src/lib/partner-workflow-copy.test.ts -v`
Expected: fail because the shared copy helper does not exist yet.

- [ ] **Step 3: Implement the shared copy helper and refactor the partner UI**

Create a small helper so the page, banner, dashboard card, and badge all say the same thing:

```ts
export function getAgreementPanelCopy(status: string) {
  if (status === "partial_approval") {
    return {
      title: "Agreement pending",
      body: "A super admin will upload and send your agreement through Zoho Sign.",
      primaryActionLabel: "View agreement",
    };
  }

  if (status === "pending_agreement") {
    return {
      title: "Agreement sent",
      body: "Check your Zoho Sign email link and complete the digital signature.",
      primaryActionLabel: "Open Zoho Sign",
    };
  }

  if (status === "signed_pending_review") {
    return {
      title: "Signed agreement awaiting review",
      body: "Zoho Sign has completed the signature. A super admin will review and approve the partner record next.",
      primaryActionLabel: null,
    };
  }

  return {
    title: "Agreement unavailable",
    body: "Your partner record is not ready for the agreement step yet.",
    primaryActionLabel: null,
  };
}
```

Refactor `src/routes/_authenticated/partner.agreement.tsx` so it:

- removes the manual upload card entirely
- removes every mention of the partner uploading a signed copy
- shows only the current Zoho status and the next expected step
- keeps the refresh button for status checks
- routes approved partners away from the agreement page

Update the rest of the partner-facing UI so it uses the same workflow language:

- `src/components/agreement-pending-banner.tsx` should show a basic-access message for `partial_approval`, `pending_agreement`, and `signed_pending_review`, with no upload fallback copy
- `src/components/app-shell.tsx` should show the shared banner for any non-approved agreement state that still needs attention
- `src/routes/_authenticated/dashboard.tsx` should show the agreement callout only while the partner is not yet approved, and the CTA should disappear once the workflow is in `signed_pending_review`
- `src/routes/_authenticated/partner.tsx` should use the shared copy helper instead of duplicating status copy in a second local map
- `src/components/app-sidebar.tsx` should stop exposing full workspace items until the partner is approved
- `src/components/partner-access-badge.tsx` should label `signed_pending_review` distinctly so super admins can tell it apart from `pending_agreement`
- `src/routes/_authenticated/partner.onboarding.tsx` should redirect `signed_pending_review` users to the agreement page only if they land in onboarding by mistake

- [ ] **Step 4: Re-run the copy regression test and lint the UI**

Run: `bun test src/lib/partner-workflow-copy.test.ts -v`
Expected: pass.

Run: `bun run lint`
Expected: pass, or only surface unrelated pre-existing lint issues.

- [ ] **Step 5: Commit the UI sweep**

```bash
git add src/lib/partner-workflow-copy.ts src/lib/partner-workflow-copy.test.ts src/routes/_authenticated/partner.agreement.tsx src/components/agreement-pending-banner.tsx src/components/app-shell.tsx src/routes/_authenticated/dashboard.tsx src/routes/_authenticated/partner.tsx src/components/app-sidebar.tsx src/components/partner-access-badge.tsx src/routes/_authenticated/partner.onboarding.tsx
git commit -m "feat: clean up partner agreement messaging"
```

---

### Task 4: Verify the full workflow and close the loop

**Files:**
- Modify: any files needed to fix issues found during verification
- No new feature files should be added in this task unless verification exposes a concrete bug

- [ ] **Step 1: Run the full targeted test suite**

Run: `bun test src/lib/partner-status.test.ts src/lib/zoho-sign.test.ts src/lib/partner-workflow-copy.test.ts -v`
Expected: all three test files pass.

- [ ] **Step 2: Run schema and TypeScript verification**

If `DATABASE_URL` or the local DB config is available, run:

```bash
bun run db:migrate
```

Expected: the new migration applies cleanly and the agreement columns/status enum are accepted by the database.

Run: `bunx tsc --noEmit`
Expected: pass.

- [ ] **Step 3: Run the app-level checks**

Run: `bun run lint`
Expected: pass.

Run: `bun run build`
Expected: pass and produce a clean production build.

- [ ] **Step 4: Fix any regression that shows up in verification**

If any command fails:

```ts
// Make the smallest targeted fix in the file that actually failed.
// Then re-run the exact command before moving on.
```

- [ ] **Step 5: Final commit after verification fixes**

```bash
git add -A
git commit -m "fix: complete zoho sign agreement cleanup"
```

## Definition of Done

- Super admins upload a fresh partner-specific agreement PDF before every Zoho Sign send.
- Partners no longer see any manual upload fallback for the agreement.
- Partners with `partial_approval`, `pending_agreement`, or `signed_pending_review` keep basic portal access only.
- Full workspace access opens only after super admin approval.
- Zoho completion advances the partner to `signed_pending_review`, not `approved`.
- Status text, banners, badges, route guards, and admin actions all tell the same story.
