# Superadmin Assignment Gate Bypass

## Goal

Prevent the `Assignment pending` and `Active context unavailable` screens from blocking an authenticated account with the existing `super_admin` role. Partner accounts must retain the current governed-assignment and active-context requirements.

## Approved behavior

- The existing `super_admin` role is the only bypass signal.
- Superadmins may render the authenticated application shell when `assignment` is missing.
- Superadmins may render the authenticated application shell when `activeContext` is missing.
- Assignment and active-context objects are not synthesized or persisted for this UI bypass.
- Existing session, profile, forced-password-reset, rejected-account, and partner onboarding behavior remains unchanged.
- Non-superadmin accounts continue to see the existing provisioning screens.

## Implementation

Update the authenticated route gate to derive `isSuperAdmin` from `hasRole("super_admin")` and apply it only to the two governed-provisioning branches. Keep the existing `getAuthenticatedGateState` helper and server authorization model unchanged.

Add focused regression coverage for the gate decision so the two roles remain distinct: superadmins pass without assignment/context, while partner accounts remain blocked. Run the relevant test suite, typecheck, lint, and production build before delivery.

## Deployment

Preserve unrelated working-tree changes. Commit only the approved spec and implementation changes, push the current `main` branch without rewriting history, then deploy through the repository's existing SSH workflow. Confirm the deployed service reports healthy after the rollout.

## Out of scope

- Creating default database assignments or active contexts.
- Changing server-side authorization policies.
- Changing role definitions or partner onboarding.
- Refactoring the broader authentication architecture.
