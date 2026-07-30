# Implementation Status

## Phase

- Phase 2: Deals, Pricing, Pipeline, Tasks, and Rewards
- Checkpoint: deal lifecycle domain commands (2C slice: stage transitions, Won/Lost) landed; customer merge/participant governance and pricing foundations landed previously; identity.change_user_role added as a named command (closes a live "Edit user" bug); broader phase 2 still in progress
- Previous checkpoint: Phase 0 (0A-0E) complete
- Phase 1 status: data model (tenant/geography/assignment/active-context) is in place, but a dedicated audit found Phase 1 enforcement is **not** at its exit gate — see "Phase 1 Audit Findings" below. Phase 2 work is proceeding on top of this partial foundation per explicit user direction rather than blocking on full Phase 1 closure.

## Phase 1 Audit Findings (2026-07-30)

A gap analysis against the Phase 1 exit gate found:

1. **Security-critical**: several server paths bypass policy entirely by querying the database directly — e.g. `uploadDocumentBlob`/`createDocumentDataUrl`/`removeDocumentBlobs` in `src/server/livey-service.server.ts`, and the inbound Zoho Sign webhook handler in `src/server/zoho-api.server.ts`.
2. **Security-critical**: the "central policy module" (`src/server/table-policy.server.ts`, wired into `queryTable()`) only does flat `partner_id`/`user_id` ownership scoping. It never calls into `src/domain/contracts/governance.ts`'s role-power/geography-ceiling model, so the governed RBAC model is not actually enforced for generic table reads/writes yet. It also only covers the generic-table path — no export, import, file, assistant, notification, worker/job, or webhook surface consults it.
3. **Security-critical**: `revokeUserSessionsAndContexts` (session/context revocation on offboarding) has zero callers anywhere in the app outside its own test — it is dead code today.
4. No named commands exist yet to transition an Assignment's own lifecycle (Scheduled → Active → Suspended/Ended/Revoked) — there is currently no in-app way to do this at all.
5. No Active Context chooser/switcher exists — the shell shows a single seeded context with a "refresh" action, not a real selector, narrowing-scope flow, deep-link handling, or context-switch audit event.
6. Navigation (`app-sidebar.tsx`) is static role-key filtering, not capability/context-generated from the active Assignment or geography ceiling.
7. RBAC/tenant-isolation test coverage (`governance.test.ts`, `table-policy.server.test.ts`) is a handful of tests, far short of the required role × scope × assignment-state matrix.

Given this, the deal-command work below deliberately closes part of gap 2 for the deal domain specifically (real policy checks using `evaluateActiveContextPolicy` plus partner/geography scoping), rather than waiting on a full Phase 1 policy-layer rewrite. The remaining gaps (1, 3, 4, 5, 6, 7) are unresolved and should be treated as open risk for any future phase that assumes Phase 1 is complete.

### Fixed: `assignment.status` was always undefined from `getAuthContext()` (2026-07-30)

Discovered while manually verifying the deal-command work in production: every `moveDealStageForward`/`markDealWon` call failed with "Assignment is not active" for a real active super_admin. Root cause was in `loadGovernedAuthState`'s join query in `src/server/livey-service.server.ts` — it selects both `ac.revoked_at`/`ac.revocation_reason` (active_contexts) and `a.revoked_at`/`a.revocation_reason` (assignments) unaliased in the same result set, and `mapAssignmentRow` read `row.status` when the assignment's status column is always aliased as `assignment_status` (never selected as bare `status`) to avoid colliding with anything — so `AssignmentRecord.status` was silently `undefined` for literally every user, in every code path that has ever called `getAuthContext()`, since this function was written in Phase 1. Nothing surfaced it before because no prior code actually branched on `assignment.status` at runtime — the deal-command module is the first to do so. Fixed `mapAssignmentRow` to read `row.assignment_status`, and additionally aliased `ac.revoked_at`/`ac.revocation_reason` as `context_revoked_at`/`context_revocation_reason` (and updated `mapActiveContextRow` to match) to remove a second, currently-benign-but-latent version of the same collision for the context's own revocation fields. Added a regression test in `livey-service.server.test.ts` that fails without the fix (verified by reverting locally and re-running).

### Fixed: super_admin ownership-scope bug (2026-07-30)

While investigating a live report that "Users & Roles" showed only 1 user for a logged-in super_admin, found that `applyTablePolicy` in `src/server/table-policy.server.ts` computed a `superAdmin` flag but never used it to bypass the flat ownership-scope filter on: the `BOOTSTRAP_SELF_SERVICE_TABLES` branch (`profiles`, `partners`), the `BOOTSTRAP_READ_ONLY_TABLES` branch (`user_roles`, `assignments`, `active_contexts`, `sessions`), the generic per-table `column` scope branch (`portal_deals`, `portal_customers`, `notifications`, `reward_point_events`, `reward_redemptions`, `portal_customer_activities`, `partner_documents`, `deal_documents`, `partner_review_notes`, `support_tickets`, `portal_team_members`), and the `linked-deal`/`linked-ticket` no-id fallback paths. In practice this meant a super_admin's own `user_id`/`id` was always forced into the query filters — reads silently returned only their own rows, and updates targeting another user's row (e.g. `admin.users.tsx`'s `saveRoles`/`approveUser`, which does `.eq("id", selectedUser.id)`) threw "Access denied" outright because the client-supplied filter conflicted with the forced own-id filter. This affected Users & Roles, Partner Approvals, and likely Deals/Customers/Pipeline visibility for super_admin across the live app. Fixed by returning the query unscoped (delete still forbidden on self-service tables) whenever `superAdmin` is true, in every branch listed above. Added 6 regression tests in `table-policy.server.test.ts` covering unscoped super_admin reads/updates on each affected branch, plus a baseline test confirming non-super-admin reads remain scoped.

## Known Taxonomy Mismatch: Deal Stages

`src/domain/contracts/taxonomy.ts`'s `DEAL_STAGES` (canonical, used by `DEAL_STATE_MACHINE`) has exactly eight stages with no "approved" stage, per the blueprint ("Approved is never a pipeline stage"). The deployed pipeline UI and schema (`src/lib/portal-records.ts` `DEAL_STAGE_ORDER`) has always carried a ninth "approved" stage between negotiation and won, and live/seeded deal rows already use it (e.g. the prod-demo "Northstar Cloud Suite" deal is seeded at stage "approved"). The new deal-command module (`src/server/deal-commands.server.ts`) intentionally enforces the nine-stage order actually in production, not the narrower canonical list, to avoid breaking existing data and UI. Reconciling the two (likely: rename the UI's "approved" pipeline column to a deal `status` value instead of a `stage`) is a product decision with visible UI impact and needs explicit sign-off before it's changed.

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
- Reworked the authenticated shell to show active governed context, remove the free-text global search affordance, and expose explicit assignment-pending, loading, denied, and no-context fallback states.
- Added focused coverage for shell context summaries and gate-state handling.
- Added focused tests for geography ancestry, assignment validation, active-context issuance, and policy denials.
- Added a central generic-table policy module and wired it into `queryTable()` so scoped reads/counts are enforced server-side before SQL executes, including bootstrap-safe self-service reads for the auth bridge.
- Added targeted policy tests for bootstrap-safe lookup reads, anonymous denial, and scoped partner reads through the local table query path.
- Verified the governed-context slice with targeted Bun tests, `bun run build`, and targeted ESLint on the touched files.
- Added governed customer duplicate detection, merge planning, participant tag history helpers, and customer merge redirect helpers in `src/lib/customer-governance.ts`.
- Added customer merge and coverage-tag persistence tables plus merge-history metadata to `db/schema.sql`.
- Extended customer records with merge and identity fields in `src/lib/portal-records.ts`.
- Wired the customer screen to surface duplicate candidates, merge preview, participant history, and governed add/end flows in `src/routes/_authenticated/customers.tsx`.
- Added focused tests for customer duplicate detection, merge planning, participant tag history, and route-compatible governance payloads.
- Added fixed-point pricing helpers, canonical pricing tables, and timestamped FX snapshot support.
- Added governed product, variant, SKU, combo, combo-component, price-book, and price-row builders plus archive/import validation helpers.
- Added the canonical pricing validation bridge into the legacy catalog import path and surfaced pricing metadata on the admin catalog projection.
- Added `version` optimistic-concurrency column and an append-only `deal_transitions` table to `db/schema.sql` for deals.
- Added `src/server/deal-commands.server.ts`: named domain commands `moveDealStageForward`, `moveDealStageBackward` (reasoned), `markDealWon`, `markDealLost`. Each command loads the canonical deal row with `SELECT ... FOR UPDATE`, evaluates governed policy (`evaluateActiveContextPolicy` plus partner/geography scoping — super_admin full access, partner-scoped roles must match the deal's `partner_id`, LIVEY-side roles fail closed unless their assignment has a Global geography ceiling), checks optimistic concurrency against the client's `expectedVersion`, validates the stage transition, and atomically writes the `portal_deals` row, a `deal_transitions` audit row, a `domain_activity_events` row, and a `command_outbox` envelope in one transaction.
- Added `src/integrations/local/deal-commands.ts` exposing the above as TanStack `createServerFn` calls, resolving the caller's actor from `getAuthContext()` server-side.
- Wired `src/routes/_authenticated/deals.tsx` (`advance`, `closeAs`) and `src/routes/_authenticated/pipeline.tsx` (`moveDeal`) to call the new commands instead of writing `stage`/`status` directly via `supabase.from("portal_deals").update(...)`. Non-lifecycle field edits (notes, deal detail editing) still use the existing generic update path, since the "no direct stage/status writes" rule is specifically about lifecycle fields.
- Added `src/server/deal-commands.server.test.ts`: policy allow/deny (assignment-inactive, partner-mismatch, geography fail-closed), optimistic-concurrency conflict, valid/invalid forward and backward transitions, terminal-stage rejection for Won/Lost, and existence-leak-safe denial for a missing deal.

## Remaining Items

- Finish deal-side participant tagging and coverage propagation (`deal_participants` table exists, builders exist in `customer-governance.ts`, but no route wires them yet).
- Expand phase 2 into full deal aggregates (line items, immutable Pricing Revision), registration decisions, discount request/decision workflow, PO/outcome review, tasks, activity feed, and rewards — the deal-command slice landed so far covers only stage lifecycle transitions and Won/Lost, not the rest of Checkpoint 2C/2D/2E/2G.
- Resolve the deal-stage taxonomy mismatch (canonical 8-stage list vs. deployed 9-stage list with "approved") — needs a product decision since it affects visible pipeline columns.
- Finish the remaining pricing projection polish once the canonical price-book editing flows are ready to land.
- Update any legacy helpers that still need to import the canonical registries.
- Add named assignment transition commands and session/context revocation flows (Phase 1 gap — `revokeUserSessionsAndContexts` is currently unused).
- Expand policy enforcement beyond the local generic-table path and the new deal-command module to explicit row-action commands for other domains, export/import/file flows, assistant retrieval, and worker/webhook entrypoints. In particular, fix the direct-DB-write bypasses in `livey-service.server.ts` document-blob handlers and the Zoho Sign webhook handler.
- Add a real Active Context chooser/switcher and make navigation capability-generated (Phase 1 gaps).
- Add route-level denial and fallback states for the remaining partner-facing screens.
- Expand RBAC/tenant-isolation test coverage toward the full role × scope × assignment-state matrix required by the blueprint.
- ~~Known broken feature: `admin.users.tsx`'s "Edit user" role-change flow~~ — **fixed** (see below). `assignments`/`active_contexts`/`sessions` remain read-only via the generic path with no named commands yet; that part of gap 4 is still open.

### Fixed: "Edit user" role-change flow via a real named command (2026-07-30)

Built `identity.change_user_role` as the first named domain command outside the deal aggregate, following the same pattern as `deal-commands.server.ts`: `src/server/user-role-commands.server.ts` loads the target user's current `user_roles` rows, checks policy via `evaluateActiveContextPolicy` plus `governance.ts`'s existing `canGrantRole` (super_admin can grant anything; partner_admin can only grant partner_user; no other role can grant), and atomically replaces the role set (`user_roles` only has one governed role per user today) plus writes a `domain_activity_events` row and a `command_outbox` envelope in one transaction. Existence-safe: a user with zero roles denies with `POLICY_DENIED` rather than a distinguishable "not found."

`user_roles.role` is the Postgres `app_role` enum (`super_admin`/`partner_admin`/`partner_user` only) — a different, smaller set than the governance `RoleKey` taxonomy (`rm`/`pam`/`kam`/... which belongs to the mostly-unwired Assignment system). The command validates against `app_role`'s three values specifically, not the full `RoleKey` union.

Extracted the actor-resolution helper (`resolveDealCommandActor`/`DealCommandActor`) out of `deal-commands.server.ts` into a shared `src/server/governed-actor.server.ts` (`resolveGovernedActor`/`GovernedActor`), since this is the second command module needing the identical pattern. `deal-commands.server.ts`'s existing exports are preserved as thin re-exports, so no other file needed to change.

Wired `admin.users.tsx`'s `saveRoles()` to call the command instead of the blocked direct `user_roles` delete+insert; the `profiles.partner_status` update alongside it is untouched (it already worked once the earlier self-service-table fix landed).

Known scoped limitation: `user_roles` has no version column, so this command does not have true optimistic concurrency — `newVersion` is a placeholder `1`. Not a regression (the old code had none either), but worth closing if this table ever gets concurrent-edit pressure.

Added 7 regression tests (`user-role-commands.server.test.ts`): unknown-role rejection, escalation denial, partner_admin granting partner_user, inactive-assignment denial, no-op when role is unchanged, existence-safe denial for a roleless user, and the full BEGIN/SELECT/DELETE/INSERT×2/COMMIT transaction shape.

## Migrations Created

- No separate migration file yet; the additive changes are in `db/schema.sql`.
- Latest additive changes: `portal_deals.version` (optimistic concurrency, default 1) and the append-only `deal_transitions` table with a `deal_transitions_deal_id_idx` index.

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
- The deal-command policy check fails closed for any LIVEY-side assignment (rm/pam/kam/isr/livey_support) whose geography ceiling is narrower than Global, because deal `country`/`region` are free-text and cannot yet be resolved to a governed geography node with confidence for most values (only Global/APAC/India/India West/Maharashtra have seed aliases). No such assignments exist in the current seed data, so this has not been exercised against real LIVEY-role deal traffic yet — once regional RM/PAM/KAM/ISR assignments are seeded, this will need either broader geography aliasing or an explicit scoped-access decision.
- Deal participant tagging (`deal_participants` table, builders in `customer-governance.ts`) still is not wired into any deal route, so deal-level participant coverage (PAM/KAM/RM/ISR tagging) is not yet enforced or visible in the UI.

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
- `bun test src/lib/customer-governance.test.ts src/lib/portal-records.test.ts`
- Result: `7 pass`, `0 fail`, `35 expect() calls`
- `bunx eslint src/lib/customer-governance.ts src/lib/customer-governance.test.ts src/lib/portal-records.ts src/routes/_authenticated/customers.tsx`
- Result: passed with no warnings after formatting
- `bun run build`
- Result: client, SSR, and Nitro builds completed successfully after the phase-2 customer-governance slice
- `bun test src/server/deal-commands.server.test.ts`
- Result: `14 pass`, `0 fail`, `40 expect() calls`
- `bun test` (full suite)
- Result: `153 pass`, `0 fail`, `1586 expect() calls`
- `bunx tsc --noEmit -p tsconfig.json` (scoped review of touched files; the repo has pre-existing unrelated type errors elsewhere that are not part of this slice)
- Result: no errors in `deal-commands.server.ts`, `deal-commands.server.test.ts`, `integrations/local/deal-commands.ts`, `routes/_authenticated/deals.tsx`, `routes/_authenticated/pipeline.tsx`, `lib/portal-records.ts`
- `bunx eslint src/server/deal-commands.server.ts src/server/deal-commands.server.test.ts src/integrations/local/deal-commands.ts src/routes/_authenticated/deals.tsx src/routes/_authenticated/pipeline.tsx src/lib/portal-records.ts`
- Result: passed after auto-formatting
- `bun run build`
- Result: client, SSR, and Nitro builds completed successfully after the deal-command slice
- `bun test src/server/table-policy.server.test.ts`
- Result: `9 pass`, `0 fail`, `19 expect() calls`
- `bun test` (full suite)
- Result: `159 pass`, `0 fail`, `1595 expect() calls`
- `bunx tsc --noEmit -p tsconfig.json` (scoped)
- Result: no errors in `table-policy.server.ts`, `table-policy.server.test.ts`
- `bunx eslint src/server/table-policy.server.ts src/server/table-policy.server.test.ts`
- Result: passed with no warnings
- `bun run build`
- Result: client, SSR, and Nitro builds completed successfully after the super_admin scope-bypass fix
- `bun test src/server/livey-service.server.test.ts`
- Result: `3 pass`, `0 fail`, `9 expect() calls`; confirmed the new test fails (`Expected: "active", Received: undefined`) when the `row.status` bug is reintroduced
- `bun test` (full suite)
- Result: `160 pass`, `0 fail`, `1599 expect() calls`
- `bunx tsc --noEmit -p tsconfig.json` (scoped) / `bunx eslint src/server/livey-service.server.ts src/server/livey-service.server.test.ts`
- Result: no errors, no warnings
- `bun run build`
- Result: client, SSR, and Nitro builds completed successfully after the assignment-status fix
- Manual browser verification against production (`https://systemforgelabs.xyz`, logged in as `arjun.admin@livey.tech`), after the super_admin scope-bypass fix but before this assignment-status fix: Users & Roles correctly showed all 15 seeded profiles/roles, Partner Approvals correctly showed all 5 seeded partners, and Deals correctly listed all 5 seeded deals — but clicking "Advance stage" on Harbor Onboarding Package failed with `POLICY_DENIED — Assignment is not active`, which is what led to discovering this bug.
- Re-verified in production after redeploying this fix: "Advance stage" on Harbor Onboarding Package succeeded (`demo` → `testing`), confirmed directly against the DB (`portal_deals.version` 1→2, a `deal_transitions` row correctly attributed to `assignment-prod-super-admin-2`).

### Fixed: Customers page crashed to an empty state for every user (2026-07-30)

Continuing the manual browser QA pass, found the Customers page always showed "0 accounts" / empty state for every role, including super_admin. Root cause: `customer_participants` and `customer_merge_events` — both tables introduced by the earlier customer-merge-governance commit and queried directly by `src/routes/_authenticated/customers.tsx` — were never added to `TABLE_COLUMNS` in `src/server/livey-service.server.ts`. `queryTableWithAuthContext`'s `assertTable` throws `Unsupported table: ...` for any table not in that allowlist; `customers.tsx`'s `load()` runs three queries in one `Promise.all`, so the throw rejects the whole batch and the catch block resets everything to an empty state — silently, for every user, since this table was added. This was **not** caused by anything in this session's earlier fixes; it predates them.

While fixing this, also found and fixed two related gaps in the same area:
- `portal_customers`'s `TABLE_COLUMNS` entry was stale — missing every column added by the customer-merge-governance migration (`domain`, `phone`, `tax_registration_id`, `provider_customer_id`, `address`, `origin`, `duplicate_review_status`, `master_customer_id`, `merged_into_customer_id`, `merged_at`, `merge_reason`, `external_ids`, `country`). Since `TABLE_COLUMNS` filters which fields an INSERT/UPDATE is allowed to write, any generic-path write to those fields (e.g. merge operations) was silently dropped rather than erroring.
- `customer_participants`, `deal_participants`, and `customer_merge_events` had no entry in `table-policy.server.ts`'s `getScopeSpec`, so — once the missing-table crash was fixed — they would have fallen through to the final unscoped catch-all, meaning any authenticated user (including `partner_user`) could read/write every partner's participant and merge-history rows. Added partner-scoped (fallback to `actor_id`) entries for all three, matching the existing pattern used for `partner_review_notes`/`support_tickets`.

Also added `version` to `portal_deals`'s `TABLE_COLUMNS` (harmless gap — nothing writes it via the generic path yet, since the new deal-command module writes it via raw SQL, but left stale it would have silently dropped `version` from any future generic-path deal update) and added `deal_participants` to `TABLE_COLUMNS` for forward-compatibility with the still-unwired deal-participant-tagging feature noted in Remaining Items.

Added a regression test (`livey-service.server.test.ts`) asserting every table name referenced by a client `.from(...)` call across `src/routes`, `src/lib`, `src/hooks`, and `src/components` is registered in `TABLE_COLUMNS` — confirmed it fails with the original `Unsupported table: customer_merge_events` error when the entries are removed. Added scoping regression tests in `table-policy.server.test.ts` for the three newly-scoped tables (partner-scoped for ordinary roles, unscoped for super_admin).

- `bun test src/server/user-role-commands.server.test.ts`
- Result: `7 pass`, `0 fail`, `17 expect() calls`
- `bun test` (full suite)
- Result: `169 pass`, `0 fail`, `1646 expect() calls`
- `bunx tsc --noEmit -p tsconfig.json` (scoped) / `bunx eslint` on all touched files
- Result: no errors, no warnings (after auto-formatting)
- `bun run build`
- Result: client, SSR, and Nitro builds completed successfully after the identity.change_user_role command
