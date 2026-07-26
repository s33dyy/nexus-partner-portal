# LIVEY Partner Portal Zoho Sign Agreement Flow Cleanup Design

**Goal:** Fix the partner agreement workflow so super admins upload a fresh agreement PDF per partner, create an embedded Zoho Sign request without email delivery, partners complete digital signing from a direct in-app button with basic portal access only, and super admins perform the final approval after signing.

**Architecture:** Keep Zoho Sign as the only signing provider, but make the agreement lifecycle a first-class shared workflow instead of a loose collection of UI states. The source of truth stays in Postgres through `profiles.partner_status` and `partners.status`, with one additional review state after Zoho completion so super admins can confirm the signed return before full access opens. Admin-only sending moves to the partner approval sheet, while partner-facing screens become read-only status and signing surfaces with no manual upload fallback.

**Tech Stack:** TanStack Start, React, TypeScript, PostgreSQL, Supabase client, server-side Postgres helpers, Zoho Sign API, Radix UI-based components, TanStack Router.

---

## Requirements

- Zoho Sign must remain the only signing provider.
- The super admin must upload a fresh agreement PDF for each partner at send time.
- The uploaded PDF must be associated with that specific partner and agreement request.
- The partner admin must not see any manual upload fallback for the agreement.
- Partner admins with `partial_approval` or `pending_agreement` keep basic portal access only.
- Full workspace access must remain locked until the super admin final-approves the signed agreement.
- The app must support the complete flow:
  - partner is partially approved,
  - super admin uploads and sends a fresh agreement PDF through Zoho Sign,
  - partner signs in Zoho Sign,
  - webhook marks the agreement as signed and awaiting review,
  - super admin reviews the signed agreement and approves the partner.
- UI labels, banners, badges, and redirects must all agree on the same status meanings.
- Permission logic must be aligned across route guards, sidebar items, dashboard cards, and agreement pages.
- Any current partner-facing copy that implies upload fallback or manual signing must be removed.

## Status Model

Use one workflow model across the portal:

- `pending_partner_registration` - registration not started
- `submitted` - registration submitted for review
- `under_review` - admin is reviewing the application
- `partial_approval` - basic portal access starts, agreement not sent yet
- `pending_agreement` - Zoho Sign request sent, partner is waiting to sign
- `signed_pending_review` - Zoho Sign completed, super admin still needs to review and approve
- `approved` - full portal access granted
- `rejected` - application declined
- `need_more_info` - partner must update their submission

The important distinction is that Zoho completion does not immediately unlock full access. It only moves the partner into `signed_pending_review`, where the super admin can verify the signed document and decide whether to approve.

## Agreement Flow

1. Super admin reviews a partner in the admin approvals screen.
2. Super admin chooses partial approval.
3. The partner immediately gets basic access to the portal.
4. Super admin uploads a fresh PDF for that partner and sends it through Zoho Sign.
5. The backend stores the upload metadata and creates the Zoho request.
6. Partner status moves to `pending_agreement`.
7. The partner opens the agreement from a `Sign with Zoho Sign` button in the portal, which opens Zoho Sign in a new tab, and signs digitally.
8. Zoho webhook updates the partner to `signed_pending_review`.
9. Super admin opens the partner record, reviews the signed agreement, and marks the partner `approved`.
10. Full portal access is unlocked only after that final approval.

## Data Model

- Add or reuse partner agreement fields so the app can track:
  - Zoho request/envelope id
  - agreement sent timestamp
  - signed timestamp
  - signed document path or signed artifact pointer
  - provider name, which stays `zohosign`
  - uploaded source PDF path for the partner-specific agreement that was sent
- Add the `signed_pending_review` status to the partner status enum and any mirrored status typing.
- Keep both `partners.status` and `profiles.partner_status` synchronized on every state transition.
- Keep Zoho token storage server-only and out of the browser bundle.
- Keep document storage in the existing partner document bucket, but distinguish between:
  - the admin-uploaded source agreement PDF,
  - the signed return artifact,
  - any supporting partner documents.

## Runtime Flow

### Admin Send Path

1. Super admin opens a partner in the approvals sheet.
2. The admin uploads a fresh PDF from the partner detail panel.
3. The admin clicks send.
4. The server stores the file and creates the Zoho Sign request from that exact upload.
5. The server writes `agreement_sent_at`, Zoho request id, source PDF path, and `pending_agreement` status.
6. The UI closes the sheet and refreshes the list.

### Partner Signing Path

1. Partner sees a banner and agreement page while access is limited.
2. Partner only sees Zoho Sign status, a direct `Sign with Zoho Sign` button, and agreement progress.
3. Clicking the button opens Zoho Sign in a new tab for an embedded signing session.
4. The partner signs through Zoho Sign.
5. Webhook marks the record as signed and pending review.
6. Partner can stay in the portal with basic access while waiting for super admin approval.

### Final Approval Path

1. Super admin opens the same partner record after signing completes.
2. Admin views the signed-agreement status and any signed artifact link.
3. Admin confirms the review and marks the partner `approved`.
4. Full access is granted everywhere the app checks partner status.

## Permission Model

Basic access should be available for:

- dashboard
- settings
- notifications
- support
- partner onboarding history or read-only profile views
- partner agreement page
- documents
- news feed

Full access should remain reserved for `approved`:

- deals
- pipeline
- customers
- analytics
- workspace sections that expose operational partner activity
- any page that assumes the partner can act on live business records

Route guards and helper hooks must treat `partial_approval`, `pending_agreement`, and `signed_pending_review` as basic-access states, but not as full-access states.

## File Boundaries

- `db/schema.sql` owns the new status enum value and partner agreement source-file fields.
- `supabase/migrations/*.sql` owns the corresponding migration for existing environments.
- `src/server/zoho-api.server.ts` owns send, callback, and webhook behavior.
- `src/lib/zoho-sign.ts` owns Zoho request creation and token handling.
- `src/lib/partner-status.ts` owns status labels, progress, and access helpers.
- `src/hooks/use-partner-access.ts` owns access levels and route-guard decisions.
- `src/routes/_authenticated.tsx` owns the auth gate and onboarding/agreement redirects.
- `src/components/app-shell.tsx` owns the shared banner and header status badge.
- `src/components/app-sidebar.tsx` owns status-aware navigation visibility.
- `src/components/agreement-pending-banner.tsx` owns the partner-facing nudge text.
- `src/components/partner-access-badge.tsx` owns the compact status badge labels.
- `src/routes/_authenticated/admin.partners.tsx` owns the super-admin approve/send/review sheet.
- `src/routes/_authenticated/partner.agreement.tsx` owns the partner-facing agreement status page.
- `src/routes/_authenticated/dashboard.tsx` owns the partner dashboard banner copy.
- `src/routes/_authenticated/partner.onboarding.tsx` owns onboarding redirects once agreement states change.
- `src/routes/_authenticated/partner.tsx` owns partner summary status display.

## UI Cleanup

- Remove the partner-facing manual upload card and related copy from the agreement page.
- Replace any language that says the partner can upload the signed agreement themselves or check an email link.
- Replace the email-link CTA with a direct `Sign with Zoho Sign` button that opens a new tab.
- Make the agreement page clearly show the current status:
  - partially approved
  - agreement sent
  - signed, awaiting admin review
  - approved
- Update the admin partner sheet so uploading the PDF is part of the send action.
- Keep the admin sheet focused on:
  - upload source PDF,
  - send via Zoho Sign,
  - view Zoho request status,
  - inspect signed return,
  - final approve.
- Adjust the sidebar so partners in basic access do not see workspace items that depend on approval.
- Adjust banners and badges so they do not imply full approval before the super admin reviews the signed agreement.

## Reliability And Error Handling

- If Zoho token exchange or request creation fails, the admin send action must return a clear error and leave the partner status unchanged.
- If webhook delivery fails or is delayed, the admin sheet should still support a refresh/resync action based on the stored Zoho request id.
- If the partner has already signed but the webhook has not yet arrived, the UI should still show the partner as waiting for review rather than approved.
- If the uploaded source PDF is missing or invalid, the send action must stop before creating the Zoho request.
- If the signed artifact is missing from storage, the admin should still be able to see the signed status and continue the review process.

## Testing

- Verify the status helper functions classify `partial_approval`, `pending_agreement`, and `signed_pending_review` correctly.
- Verify the auth gate and route guards send partners to the correct page for each state.
- Verify the partner agreement page no longer renders manual upload UI.
- Verify the admin approvals sheet requires a PDF upload before sending.
- Verify the Zoho webhook changes the partner into the signed-review state instead of final approval.
- Verify the final approval action remains admin-only.
- Verify the sidebar and dashboard banners do not expose full-access routes before approval.

## Definition Of Done

- Super admins can upload and send a unique agreement PDF for each partner.
- Partners can only sign through Zoho Sign.
- Manual partner upload fallback is gone.
- Basic access starts at partial approval and continues through pending agreement and signed review.
- Full access only begins after super admin approval.
- Status text, badges, banners, route guards, and admin screens all agree on the workflow.
