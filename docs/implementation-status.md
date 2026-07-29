# Implementation Status

## Phase

- Phase 1: Hierarchy and RBAC Foundation
- Checkpoint: central generic-table policy foundation complete
- Previous checkpoint: Phase 0 (0A-0E) complete

## Repository Findings

- TanStack Start app with file-based routing.
- Single SQL schema file at `db/schema.sql`.
- Existing role/status helpers in `src/lib`.
- Existing lookup values and audit tables but no canonical contract registry yet.
- Existing cloud/file and Zoho Sign integrations already rely on server helpers.
- The current auth bridge still reads `profiles`, `user_roles`, and session rows directly, so governed context had to be added additively instead of replacing the legacy flow in one step.

## Assumptions

- The new shared contract modules are the source of truth for phase 0 and later phases.
- Existing legacy helpers remain in place for compatibility until later phases migrate consumers.
- Live inventory reads are opt-in only.
- Phase 1 continues as an incremental enforcement rollout, so the first slice seeds and exposes governed context without yet replacing every route guard.

## Completed Items

- Added canonical contract modules under `src/domain/contracts`.
- Added governed reference-data seed generation.
- Added feature-flag registry and seed rows.
- Added command/outbox/inbox and active-context envelope contracts.
- Added state-machine registry and helper.
- Added telemetry correlation and redaction helpers.
- Added a read-only inventory analyzer and CLI wrapper.
- Extended `lookup_values`, added `feature_flags`, `command_outbox`, `command_inbox`, and `domain_activity_events` schema tables.
- Added current-state, data dictionary, decision log, inventory plan, traceability, feature-flag, blueprint, and fixture-matrix docs.
- Verified phase 0 helpers with targeted tests, full Bun tests, build, targeted lint, and live inventory CLI smoke test.
- Added governed tenant, geography, assignment, assignment-event, session-revocation, and active-context schema tables.
- Added governed geography and assignment helpers in `src/domain/contracts/governance.ts`.
- Seeded the bootstrap database with a livey-org tenant, a small governed geography tree, and a super-admin assignment plus active context.
- Loaded governed assignment/context data through the local auth bridge and surfaced it in the app shell.
- Reworked the authenticated shell to show active governed context, remove the free-text global search affordance, and expose explicit loading, denied, and no-context fallback states.
- Added focused coverage for shell context summaries and gate-state handling.
- Added focused tests for geography ancestry, assignment validation, active-context issuance, and policy denials.
- Added a central generic-table policy module and wired it into `queryTable()` so scoped reads/counts are enforced server-side before SQL executes.
- Added targeted policy tests for bootstrap-safe lookup reads, anonymous denial, and scoped partner reads through the local table query path.
- Verified the governed-context slice with targeted Bun tests, `bun run build`, and targeted ESLint on the touched files.

## Remaining Items

- Update any legacy helpers that still need to import the canonical registries.
- Add named assignment transition commands and session/context revocation flows.
- Expand policy enforcement beyond the local generic-table path to explicit row-action commands, export/import/file flows, assistant retrieval, and worker/webhook entrypoints.
- Add route-level denial and fallback states for the remaining partner-facing screens.

## Migrations Created

- No separate migration file yet; the additive changes are in `db/schema.sql`.

## Feature Flags

- Registry lives in `src/domain/contracts/feature-flags.ts`.
- Seed rows are created during database bootstrap.

## Baseline CI Commands

- `bun run db:bootstrap`
- `bun run inventory -- --fixture <path>`
- `bun test`
- `bun run lint`
- `bun run build`

## Known Risks and Exceptions

- The repo still contains legacy helper modules that predate the canonical contracts.
- The inventory tool is intentionally conservative and may flag legacy text fields that are still tolerated by the current app.
- The repository-wide `bun run lint` invocation took too long to finish in this session, so the phase 0 files were validated with a targeted ESLint pass instead.
- The new governed-context code currently exposes the assignment/context shape and seeds the data, but it does not yet enforce every phase-1 route boundary or chooser flow.

## Test Evidence

- `bun test src/domain/contracts/contracts.test.ts src/domain/contracts/telemetry.test.ts src/server/inventory-report.test.ts src/server/command-runtime.server.test.ts`
- Result: `10 pass`, `0 fail`, `1190 expect() calls`
- `bun test`
- Result: `115 pass`, `0 fail`, `1436 expect() calls`
- `bun run build`
- Result: client, SSR, and Nitro builds completed successfully
- `bunx eslint src/domain/contracts src/server/inventory-report.ts src/server/command-runtime.server.ts src/server.ts src/lib/lookup-fields.ts src/lib/partner-status.ts scripts/inventory.ts scripts/bootstrap-db.ts`
- Result: passed after auto-formatting
- Inventory smoke test:
  - `bun run inventory -- --fixture <temp-json>`
  - Result: report generated successfully with read-only fixture input
- `bun test src/domain/contracts/governance.test.ts src/domain/contracts/contracts.test.ts src/domain/contracts/telemetry.test.ts src/server/inventory-report.test.ts src/server/command-runtime.server.test.ts`
- Result: `14 pass`, `0 fail`, `1209 expect() calls`
- `bunx eslint src/domain/contracts/governance.ts src/domain/contracts/governance.test.ts src/domain/contracts/index.ts src/hooks/use-auth.tsx src/components/app-shell.tsx src/server/livey-service.server.ts src/server/inventory-report.ts scripts/bootstrap-db.ts`
- Result: passed with no warnings after the final Fast Refresh suppression
- `bun run build`
- Result: client, SSR, and Nitro builds completed successfully after the governed-context changes
