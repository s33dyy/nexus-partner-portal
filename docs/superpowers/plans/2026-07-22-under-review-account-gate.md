# Under Review Account Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock completed-but-unapproved partner users onto a single under-review page until an admin approves them, while giving super admins a one-click approve action in the user and roles editor.

**Architecture:** The authenticated layout will become the single authorization choke point for non-super-admin users. When a profile is in `under_review`, the shell will be replaced by a dedicated full-screen review page instead of the usual app chrome. The admin user editor will update profile and partner approval state directly so approval is visible immediately in the workspace data model.

**Tech Stack:** TanStack Router, React, Supabase client, shadcn/ui, lucide-react, Sonner

---

### Task 1: Add the under-review gate page and route-level guard

**Files:**
- Create: `src/components/under-review-page.tsx`
- Modify: `src/routes/_authenticated.tsx`

- [ ] **Step 1: Write the failing behavior in code first**

```tsx
// src/routes/_authenticated.tsx
const isUnderReview = profile?.partner_status === "under_review" && !hasRole("super_admin");
if (isUnderReview) {
  return <UnderReviewPage />;
}
```

- [ ] **Step 2: Run the app build and confirm the new component import is missing**

Run: `npm run build`
Expected: fail until `UnderReviewPage` is created and imported.

- [ ] **Step 3: Implement the minimal under-review page and gate logic**

```tsx
// src/components/under-review-page.tsx
import { useNavigate } from "@tanstack/react-router";
import { ShieldAlert, RefreshCcw, LogOut } from "lucide-react";

export function UnderReviewPage() {
  const { profile, refresh, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-xl border-dashed">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Your Account Is Under Review</CardTitle>
          <CardDescription>
            Thanks for completing your submission, {profile?.full_name ?? "partner"}.
            LIVEY is reviewing your details and documents now.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            You will regain access automatically once a super admin approves your account.
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                await refresh();
                navigate({ to: "/dashboard", replace: true });
              }}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              Check again
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await signOut();
                navigate({ to: "/auth", replace: true });
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Verify the gate behavior manually**

Run:

```bash
npm run build
```

Expected:
- Build succeeds.
- Non-super-admin users with `partner_status = "under_review"` see only the review page.
- Users with `partner_status = "submitted"` continue to reach onboarding.
- Users with `partner_status = "approved"` continue to the normal shell.

### Task 2: Add an approve-user action to the admin user and roles editor

**Files:**
- Modify: `src/routes/_authenticated/admin.users.tsx`

- [ ] **Step 1: Add the data needed for approval**

```tsx
// selected user query
supabase
  .from("profiles")
  .select("id, email, full_name, phone, company_name, partner_status, partner_id, is_seed, created_at")
```

- [ ] **Step 2: Add the approval action**

```tsx
const approveUser = async () => {
  if (!selectedUser || selectedUser.partner_status === "approved") return;
  setSaving(true);
  try {
    const profileRes = await supabase
      .from("profiles")
      .update({ partner_status: "approved", updated_at: new Date().toISOString() })
      .eq("id", selectedUser.id);
    if (profileRes.error) throw profileRes.error;

    if (selectedUser.partner_id) {
      const partnerRes = await supabase
        .from("partners")
        .update({ status: "approved" })
        .eq("id", selectedUser.partner_id);
      if (partnerRes.error) throw partnerRes.error;
    }

    toast.success("User approved");
    await load();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Failed to approve user");
  } finally {
    setSaving(false);
  }
};
```

- [ ] **Step 3: Surface the button in the role editor**

```tsx
<div className="flex flex-wrap gap-2">
  <Button onClick={() => void saveRoles()} disabled={saving}>
    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserRoundCog className="mr-2 h-4 w-4" />}
    Save access
  </Button>
  <Button
    variant="secondary"
    onClick={() => void approveUser()}
    disabled={saving || !selectedUser || selectedUser.partner_status === "approved"}
  >
    Approve user
  </Button>
</div>
```

- [ ] **Step 4: Verify the admin path**

Run:

```bash
npm run build
```

Expected:
- Build succeeds.
- The selected user can be approved from the editor without changing their roles.
- If the user has a linked partner record, that partner is approved too.

### Task 3: Regression check for status routing

**Files:**
- Modify: `src/routes/_authenticated.tsx`
- Modify: `src/routes/_authenticated/admin.users.tsx`
- Test: manual browser walkthrough

- [ ] **Step 1: Confirm the under-review guard does not affect approved users**

Run:

```bash
npm run build
```

Expected: approved partner accounts still render the existing authenticated shell.

- [ ] **Step 2: Confirm the under-review page is the only surfaced page**

Manual check:
- Log in as a partner whose profile status is `under_review`.
- Visit `/dashboard`, `/deals`, and `/partner`.
- Confirm the app shows only the review screen and never reveals the sidebar or other workspace pages.

- [ ] **Step 3: Commit the implementation**

```bash
git add src/components/under-review-page.tsx src/routes/_authenticated.tsx src/routes/_authenticated/admin.users.tsx
git commit -m "feat: gate under review partner accounts"
```
