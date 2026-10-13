# LIVEY PAM CRM Deal, RBAC, and Field Semantics Fixes

## Goal

Deliver the requested CRM fixes as one coordinated release while preserving the existing partner-tenant restrictions and the current governed-assignment model. The change covers catalogue/company/deal terminology, regional access, currency display, deal creation and approval, task assignment, advanced filters, super-admin CRUD, and an explicitly scoped testing-mode verification bypass.

## Scope

### Data and terminology

- Product Catalogue displays and uses **Product Class** instead of the legacy module label.
- Company forms and records replace MRR with **Employee Count** and Health Score with **Credibility**. Add compatible storage/backfill where required rather than silently reinterpreting old values.
- Renewal Date is valid only for `LIVEYfy` and `RC`; both UI and server validation enforce this rule.
- Deal forms and exports use **Partner** instead of Account, **Customer Budget Per Unit** instead of Customer Budget, and **Price Per Unit** instead of Amount. Compatibility aliases remain during migration where existing records or APIs require them.
- POC and Partner lookups use authenticated, scope-aware dropdown queries.
- Currency is derived from the selected region/country, stored as an ISO currency code, and rendered with the matching symbol everywhere relevant.
- Catalogue selection supplies the price automatically; quantity and unit price produce the correct deal values. Server validation prevents arbitrary or stale client prices from bypassing catalogue rules.

### Roles, scope, and permissions

- Regional access applies consistently to reads, filters, dropdowns, and writes using the actor's governed geography.
- `rm` and `super_admin` may create deals for `partner_admin` and `partner_user` without fabricating assignments or weakening partner tenant boundaries.
- `super_admin`, `rm`, `kam`, `pam`, and `partner_admin` may edit deals, subject to server-side scope checks.
- `super_admin` has functional add/edit/delete access anywhere the product exposes those capabilities.
- `super_admin`, `rm`, `kam`, `pam`, and `partner_admin` may create tasks for other users, subject to scope checks.
- Pipeline and Deals receive advanced filters for KAM, PAM, Partner Admin, and Partner User, backed by the same scoped query model.

### Deal workflow

- Deal creation returns field-level, actionable validation errors instead of a generic system error.
- Deal Registration requires approval when the normalized USD value is greater than 100. Deals at or below 100 USD retain the existing lower-value path.
- The browser-safe ID helper replaces direct reliance on `globalThis.crypto.randomUUID`, fixing the screenshot's `randomUUID is not a function` failure while keeping server-side cryptographic UUID generation intact.

### Testing-mode verification

- Add an explicit opt-in environment configuration for local/staging testing.
- When enabled outside production, signup skips phone OTP and any local email-verification gate and renders the one-step flow from server capability state.
- Production ignores or rejects the bypass configuration and keeps verification enabled.
- Authenticated-user WhatsApp linking remains independently protected and is not disabled by signup test mode.

## Architecture

Use additive, compatibility-preserving changes:

1. Extend or migrate the canonical data fields and reference mappings.
2. Centralize role capability, geography scope, currency, catalogue pricing, lookup, and approval decisions in shared server/domain helpers.
3. Update commands and route loaders/actions to use those helpers.
4. Update UI labels, forms, filters, and exports to the new terminology and capability state.
5. Add focused tests before broad verification.

Existing security boundaries remain authoritative on the server. UI visibility is treated as a convenience only and never as authorization.

## Error handling

Commands must return the existing command failure contract with stable codes and field errors. Expected failures include:

- missing or out-of-scope Partner/POC;
- invalid region/currency combination;
- renewal date used with an unsupported company type;
- missing catalogue price or invalid quantity;
- approval required for a deal above the threshold;
- regional or role authorization denial;
- stale optimistic-concurrency version.

Unexpected failures are logged with the existing correlation/error-capture mechanisms and shown as a concise retryable message.

## Testing and verification

Add focused tests for:

- role capability matrices and super-admin CRUD;
- regional visibility and write scope;
- task creation for another user;
- advanced filter predicates;
- currency-by-region mapping and symbol formatting;
- company field and renewal-date validation;
- catalogue price and quantity calculations;
- POC/Partner lookup scoping;
- USD 100 approval threshold;
- browser-safe ID generation;
- test-mode verification behavior and production guard.

Run touched-file lint, focused Bun tests, and a production build. Existing unrelated failures are reported separately rather than fixed opportunistically.

## Non-goals

- Do not fabricate governance assignments or active contexts.
- Do not broaden partner visibility beyond the existing tenant/participant rules.
- Do not rewrite published Git history, force-push, rebase, or squash already-pushed commits.
- Do not overwrite unrelated uncommitted work already present in the checkout.
