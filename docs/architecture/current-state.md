# Current State

## Repository Shape

- App framework: TanStack Start with file-based routing under `src/routes`.
- Language: TypeScript.
- Runtime data layer: `pg` Pool with a single SQL bootstrap file at `db/schema.sql`.
- Deployment: Railway build and start commands are defined in `railway.json`.

## Data Model

- The repo currently uses legacy portal tables such as `profiles`, `user_roles`, `partners`, `portal_deals`, `portal_customers`, `portal_team_members`, `portal_audit_events`, `lookup_values`, `sessions`, and `password_reset_tokens`.
- The SQL bootstrap is additive and idempotent, but the schema is still mostly feature-specific rather than governed by a shared contract layer.
- `lookup_values` now carries governed metadata columns for versioning, effective dates, retirement, source, and snapshots.

## Auth and Access

- Auth/session logic is implemented in the local server bridge and server helpers, not in a dedicated policy layer yet.
- The current app still contains role-aware visibility helpers in shared libraries and routes.
- Phase 0 introduces canonical contract modules so later phases can move toward server-enforced policy without duplicating string enums.

## Files and Downloads

- Document delivery still flows through server-side helpers and Cloudinary-backed file references.
- Public or unsafe links are still possible in legacy data and are now detectable by the inventory tool.

## API and Background Work

- The repo currently exposes direct route handlers and integration endpoints for Zoho Sign and local data operations.
- There is not yet a canonical outbox or inbox pattern for command replay; phase 0 adds the table shape and runtime helper.

## Test and CI Surface

- Tests use `bun:test`.
- Linting uses ESLint.
- Build uses `vite build`.
- Database bootstrap uses `bun scripts/bootstrap-db.ts`.
- Inventory inspection uses `bun scripts/inventory.ts`.

## Known Risks

- Legacy role arrays and lookup labels still exist in several helper modules.
- Some business labels are still stored as free text in legacy records.
- The phase 0 foundation reduces drift but does not yet migrate the entire product to the new command model.

