# Super-admin access, user creation, and numeric input sanitation

## Goal

Ensure existing and future super-admins can use the full CRM, create users without assignment-context failures, and cannot submit letters or special characters in whole-number fields.

## Design

### Super-admin governance

Add an idempotent server-side repair/ensure path for identities carrying the `super_admin` role. It must provide one active global `super_admin` assignment and one active context, end stale duplicates, and be safe to run repeatedly. Run it against all existing production super-admins during deployment. Capability resolution must treat `super_admin` as full CRUD independently of the role-permission table or a transiently missing assignment, so navigation does not fail closed during startup.

### User creation

Keep profile and legacy-role creation transactional. The governed assignment step must execute with the repaired super-admin actor context. Add regression coverage for a super-admin that starts without assignment/context and ensure user-facing failures preserve the specific authorization or assignment message.

### Input sanitation

Create shared input helpers for non-negative whole numbers and non-negative decimals. Whole-number controls use text input with numeric input mode and sanitize both typing and paste to ASCII digits only. Decimal controls allow digits and at most one decimal point. Domain/server validation remains authoritative; chart-only numeric props are out of scope.

### Verification and deployment

Run focused regression tests, the full available test/lint/build checks, and a live browser smoke test. Deploy without rewriting published history or overwriting unrelated dirty changes. Verify the production database has exactly one active assignment/context per existing super-admin and verify the live user-creation and sidebar behavior.

## Alternatives considered

1. One-time database seeding only: simpler, but future missing contexts can regress.
2. Bypassing governance for super-admin commands: quick, but weakens the governance model.
3. Idempotent repair plus explicit super-admin capability fallback: selected because it repairs current data and remains robust during startup/race conditions.
