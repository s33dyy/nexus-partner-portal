# Implementation Status

## Phase

- Phase 2: Deals, Pricing, Pipeline, Tasks, and Rewards
- Checkpoint: deal lifecycle domain commands (2C slice: stage transitions, Won/Lost) landed; customer merge/participant governance and pricing foundations landed previously; identity.change_user_role added as a named command (closes a live "Edit user" bug); broader phase 2 still in progress
- Checkpoint (2026-07-30): deal creation joined the named-command path (`deal.create`); a first slice of Phase 2's Tasks module landed end-to-end (schema, named commands, workspace route); named Ticket lifecycle commands landed over the existing Support module; a scoped Phase 3 slice landed — an Assistant (chatbot) restricted to drafting/creating a Deal and listing/monitoring the caller's own Deals, backed by OpenRouter with dynamic cheapest-model selection. See "2026-07-30 session" below for detail and explicitly deferred items.
- Previous checkpoint: Phase 0 (0A-0E) complete
- Phase 1 status: data model (tenant/geography/assignment/active-context) is in place, but a dedicated audit found Phase 1 enforcement is **not** at its exit gate — see "Phase 1 Audit Findings" below. Phase 2 work is proceeding on top of this partial foundation per explicit user direction rather than blocking on full Phase 1 closure.
- Checkpoint (2026-07-31): a formal 6-package Phase 1 workflow (role runtime, schema/pipeline fix, policy enforcement, Active Context chooser, Assignment lifecycle, integration) was launched and failed on session limits before its verify/integrate step ran; only the role-runtime and schema/pipeline packages left usable partial output. This session's actual work was stabilizing that partial output (found and fixed a recurring migration bug — inline columns added to `CREATE TABLE IF NOT EXISTS` for already-existing tables never apply — across 10+ tables; fixed a client-side bug that silently broke the entire dashboard for every user; registered several tables that were never wired into the generic query policy, which had left Insight Hub fully non-functional since before this session), full-table demo seeding, and production deployment. Phase 1's real audit findings (policy-layer bypasses, no Active Context chooser, no Assignment lifecycle commands, static navigation) remain open — see "2026-07-31 session" below for the full accounting.
- Checkpoint (2026-07-31, continued): ran the supplemental seed script against **production** (it had only been run against local dev previously); read `current gaps.md`'s existing chapter-by-chapter accounting against `product.md` and fixed four more S1 items from it, each with regression tests, deployed to production and verified live: rewards now gate on the outcome-review PO approval instead of the pipeline stage merely reaching "won" (§2.3); the ticket internal-note visibility flag — found the column had never actually existed on `support_ticket_comments` despite the app depending on it, meaning every ticket reply was failing in production, plus a related bug where LIVEY-internal roles could read no ticket except ones they personally created (§13f); Settings' Governance/Configuration export sections are now gated to super_admin only (§16e); and audit events now stamp actor identity from the server-verified session instead of trusting client input (§19f). See "2026-07-31 session (continued)" below for full detail.

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
- Added `deal.create` named command and wired the manual deal-creation form to it (see "Added: `deal.create`..." below for full detail).
- Added the Assistant (chatbot): `src/server/openrouter.server.ts`, `src/domain/contracts/assistant.ts`, `src/server/assistant.server.ts`, `src/integrations/local/assistant.ts`, `src/components/assistant-panel.tsx`, and the `assistant_messages` schema table — scoped to drafting/creating a Deal and listing the caller's own Deals only.
- Added the Tasks module: `tasks`/`task_transitions` schema tables, `src/server/task-commands.server.ts`, `src/integrations/local/task-commands.ts`, `src/routes/_authenticated/tasks.tsx`, and a sidebar nav entry.
- Added named Ticket lifecycle commands (`src/server/ticket-commands.server.ts`, `src/integrations/local/ticket-commands.ts`) and wired `support.tsx` to them in place of raw inserts/updates.

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
- Insight Hub / learning (blueprint §14) — not started; needs its own schema and command layer.
- PO-review-gated reward issuance (blueprint §15) — no PO-review workflow exists yet, so `Approved Won` is never reached and no reward is ever released; `PO_REVIEW_STATE_MACHINE` exists unwired in `domain/contracts/state-machine.ts`.
- Real provider wiring for Zoho Books, WhatsApp Business Platform, GyFTR/QuickSilver, and DHL (blueprint §17) — no credentials/accounts exist in this environment.
- This environment's `bun run dev` 404s on every route ("Cannot GET /") — reproduces on the unmodified codebase, so it predates and is unrelated to the 2026-07-30 session's changes, but it blocks interactive browser verification of any UI work until fixed.

### Fixed: "Edit user" role-change flow via a real named command (2026-07-30)

Built `identity.change_user_role` as the first named domain command outside the deal aggregate, following the same pattern as `deal-commands.server.ts`: `src/server/user-role-commands.server.ts` loads the target user's current `user_roles` rows, checks policy via `evaluateActiveContextPolicy` plus `governance.ts`'s existing `canGrantRole` (super_admin can grant anything; partner_admin can only grant partner_user; no other role can grant), and atomically replaces the role set (`user_roles` only has one governed role per user today) plus writes a `domain_activity_events` row and a `command_outbox` envelope in one transaction. Existence-safe: a user with zero roles denies with `POLICY_DENIED` rather than a distinguishable "not found."

`user_roles.role` is the Postgres `app_role` enum (`super_admin`/`partner_admin`/`partner_user` only) — a different, smaller set than the governance `RoleKey` taxonomy (`rm`/`pam`/`kam`/... which belongs to the mostly-unwired Assignment system). The command validates against `app_role`'s three values specifically, not the full `RoleKey` union.

Extracted the actor-resolution helper (`resolveDealCommandActor`/`DealCommandActor`) out of `deal-commands.server.ts` into a shared `src/server/governed-actor.server.ts` (`resolveGovernedActor`/`GovernedActor`), since this is the second command module needing the identical pattern. `deal-commands.server.ts`'s existing exports are preserved as thin re-exports, so no other file needed to change.

Wired `admin.users.tsx`'s `saveRoles()` to call the command instead of the blocked direct `user_roles` delete+insert; the `profiles.partner_status` update alongside it is untouched (it already worked once the earlier self-service-table fix landed).

Known scoped limitation: `user_roles` has no version column, so this command does not have true optimistic concurrency — `newVersion` is a placeholder `1`. Not a regression (the old code had none either), but worth closing if this table ever gets concurrent-edit pressure.

Added 7 regression tests (`user-role-commands.server.test.ts`): unknown-role rejection, escalation denial, partner_admin granting partner_user, inactive-assignment denial, no-op when role is unchanged, existence-safe denial for a roleless user, and the full BEGIN/SELECT/DELETE/INSERT×2/COMMIT transaction shape.

**Follow-up bug found while manually verifying this fix in production**: the "Edit user" role dropdown still failed after the command landed, now with a clear `"partner admin" is not a governed role` validation error instead of a generic one — real progress (no more silent failure), but still not usable. Root cause: `src/domain/contracts/reference-data.ts`'s `GOVERNED_REFERENCE_BUCKETS` seeds every bucket's lookup-value `value` as `valueKey.replace(/_/g, " ")` (a humanized label, e.g. "partner admin"), and `LookupCombobox` (`src/components/lookup-combobox.tsx`) submits an option's `value` directly as the field's stored value — it has no separate machine-key concept. For the `"users.role"` bucket this fed a Postgres enum (`app_role`) that only accepts `super_admin`/`partner_admin`/`partner_user`, so every selection failed the new command's role check (previously it likely failed the old blocked-write path just as silently). The same pattern feeds `"team.portal_role"`, which `partner.team.tsx` compares with exact `=== "partner_admin"` checks — same class of silent failure there. Fixed both buckets to seed `value: valueKey` instead. **This pattern (`valueKey.replace(/_/g, " ")`) appears in 13 other buckets in the same file** — not touched, since each needs individual verification of whether anything downstream does an exact match against it (most are likely fine as free-text display dropdowns); flagged as a follow-up audit, not fixed blindly.

Since `seedGovernedReferenceData` only runs from the destructive `scripts/bootstrap-db.ts` (not on every deploy's `db:migrate`), the corrected values needed a one-off non-destructive backfill against the live DB — it's an idempotent `ON CONFLICT (field_name, value_key) DO UPDATE` upsert into `lookup_values`, so re-running it doesn't touch any other table or drop data.

Added `reference-data.test.ts`: asserts both buckets' seeded values are exactly `ROLE_KEYS` with no spaces.

### Added: `deal.create` named command, a Tasks module, named Ticket commands, and a scoped Assistant/chatbot (2026-07-30)

Session scope, per explicit user direction: extend the existing architecture (not a rewrite) as far down the blueprint's own priority order (§20.1) as one session reasonably allows, plus a chatbot restricted to creating and monitoring Deals only, backed by OpenRouter always auto-selecting the cheapest available chat model.

**`deal.create`** (`src/server/deal-commands.server.ts`): the first named command for Deal *creation*, following the exact pattern of the existing stage-transition commands (governed policy check, transactional `portal_deals` insert plus `deal_transitions`/`domain_activity_events`/`command_outbox` rows). Partner-scoped actors always get their own `partner_id` forced onto the new deal (a client-supplied `partnerId` is ignored) rather than trusted from input. Region auto-resolves from country via the existing `world-geography.ts` Sales Region mapping when not given. `src/routes/_authenticated/deals.tsx`'s manual "create deal" form now calls this command instead of a raw `supabase.from("portal_deals").insert(...)`, so the UI and the new Assistant create deals through the identical governed path (blueprint §12.3/§18.5). 3 new regression tests added to `deal-commands.server.test.ts`.

**Assistant (chatbot)** — deliberately narrow scope: it may only (a) draft a new Deal from free text for explicit user confirmation, or (b) list/describe the caller's own authorised Deals. Nothing else is wired up as a capability, so there's no reliance on the model "behaving" — the code simply has no handler for anything else.
- `src/server/openrouter.server.ts`: fetches OpenRouter's `/models` pricing list and picks the cheapest chat-capable entry by `prompt + completion` price (cached ~1h; falls back to a small fixed model if the pricing fetch fails). `runChatCompletion()` calls `/chat/completions` with whichever model that resolves to.
- The model is used only for intent classification and field extraction from free text, via a single-JSON-object response contract (`src/server/assistant.server.ts`'s `SYSTEM_PROMPT`) — every Deal list or draft preview shown to the user is built by server code from real `portal_deals` rows (via the existing `queryTable()`/`table-policy.server.ts` scoping, no new policy surface), never invented by the model. A malformed/unparseable model response degrades to showing the raw text with no action executed, rather than erroring.
- Confirmation is a separate explicit step (`confirmAssistantDeal`) that calls `deal.create` — the model never executes a write itself.
- New append-only `assistant_messages` table (`db/schema.sql`) logs every turn: user text, proposed action, retrieved deal IDs, confirmation, outcome, model used, correlation ID. No delete path anywhere.
- UI: `src/components/assistant-panel.tsx`, a slide-over chat panel launched from a new header icon in `src/components/app-shell.tsx` (text-only, matching blueprint §12.1's release requirement — no voice).
- `OPENROUTER_API_KEY` added to `.env` (and a placeholder in `.env.example`); never hardcoded in source.

**Tasks module** (blueprint §10 — previously 0% built, only unused taxonomy constants existed): new `tasks`/`task_transitions` schema tables, `src/server/task-commands.server.ts` (`createTask`, `transitionTask`), and `src/routes/_authenticated/tasks.tsx` (My Tasks workspace with status tabs and lifecycle actions). The existing canonical `TASK_STATE_MACHINE` in `domain/contracts/state-machine.ts` is a generic placeholder (`draft/queued/open/in_progress/blocked/waiting/done/canceled`, with `done`/`canceled` as dead-end terminal states) that predates this module and doesn't match §10.2's specific 5-state model with reopen-with-reason transitions — this module implements §10.2 directly instead, the same way `deal-commands.server.ts` already intentionally diverges from the mismatched canonical 8-stage deal list. 8 regression tests added.

**Named Ticket commands** over the existing partial Support implementation: `src/server/ticket-commands.server.ts` (`createTicket`, `addTicketReply`, `acceptTicket`, `markTicketWaitingOnPartner`, `closeTicket`, `requestReopen`, `decideReopen`), wired into `src/routes/_authenticated/support.tsx` in place of its previous raw inserts/updates. Same taxonomy-mismatch situation as Tasks: the canonical `TICKET_STATE_MACHINE` (8 states: `open/triaged/waiting_on_partner/waiting_on_livey/resolved/closed/reopened/canceled`) doesn't match §13.4's 5-label lifecycle or the `support_tickets.status` values already live in the database (`open/in_progress/waiting_on_partner/closed`) — this module implements §13.4's actual states/transitions directly. Only LIVEY Support/Super Admin can accept/close/decide-reopen; a Partner requester can only request a reopen, never reopen directly, matching §13.5. A reply only auto-transitions status in the one case §13.4 defines (`waiting_on_partner` → `in_progress` on a Partner reply); replying otherwise never changes status. 11 regression tests added.

**Scope decision on "no deletions... create deals and monitor deals with chatbot"**: read as scoping the *chatbot's* own capabilities, not as a mandate to remove pre-existing unrelated delete affordances elsewhere in the app (e.g. `admin.news.tsx`/`admin.rewards.tsx` catalog-item delete, draft-document removal before submission). Those are untouched — flagged here in case that reading needs correcting.

**Explicitly deferred, not silently dropped:**
- Insight Hub / learning (blueprint §14) — no schema, no route, still only unused `LEARNING_STATUSES`/`LEARNING_STATE_MACHINE` taxonomy constants. Not attempted this session; would need its own schema (Track/Subject/Lesson/Enrollment/Assessment/Certificate) and command layer sized similarly to Tasks/Tickets above.
- PO-review-gated reward issuance (blueprint §15) — `markDealWon` still does not create any reward, which is *correct* per §15.11 ("points are not created when Deal is merely marked Won"), but there is still no PO-review workflow to ever reach `Approved Won` and actually release one. `PO_REVIEW_STATE_MACHINE` already exists in `domain/contracts/state-machine.ts` unwired. Not attempted this session.
- Zoho Books, WhatsApp Business Platform, GyFTR/QuickSilver, DHL (blueprint §17, phase 6) — no real provider credentials/accounts exist in this environment; building these now would only produce non-functional stubs, which the blueprint itself prohibits ("no client-only approximation of a later security requirement"). Zoho **Sign** (agreement e-signature) was already implemented before this session and is untouched.
- Verification of this session's UI changes was via `bun test` (202/202 pass, including 36 new/updated tests), `bunx tsc --noEmit` (clean on every touched/new file), and `bun run build` (production build succeeds, all new route/command chunks bundle). Interactive browser verification could not be completed: this environment's `bun run dev` returns a bare 404 ("Cannot GET /") for every route, confirmed to reproduce identically on the unmodified pre-session codebase (via `git stash`), so it is a pre-existing environment issue unrelated to these changes, not something this session introduced or fixed.

## Migrations Created

- No separate migration file yet; the additive changes are in `db/schema.sql`.
- Latest additive changes: `portal_deals.version` (optimistic concurrency, default 1) and the append-only `deal_transitions` table with a `deal_transitions_deal_id_idx` index.
- 2026-07-30: added `assistant_messages` (append-only chatbot conversation/audit log), `tasks` + `task_transitions` (Tasks module). No changes to `support_tickets`/`support_ticket_comments` schema — the new Ticket commands reuse the existing columns.

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

- `bun test src/domain/contracts/reference-data.test.ts`
- Result: `1 pass`, `0 fail`, `22 expect() calls`
- `bun test` (full suite)
- Result: `170 pass`, `0 fail`, `1668 expect() calls`
- `bun run build` / `bunx eslint src/domain/contracts/reference-data.ts src/domain/contracts/reference-data.test.ts`
- Result: build succeeded, lint clean

### Checkpoint 1A: real geography data — Global → Sales Region → Country (2026-07-30)

User feedback correctly called out that "1A essentially done" (an earlier status line in this doc) was misleading: the *mechanism* (schema, `buildGeographyGraph`, ancestor/descendant/containment functions, tests) was complete, but the actual governed geography **data** was a 5-node toy tree (Global → APAC → India → "India West" → Maharashtra) — nowhere near enough for geography-based RBAC to mean anything in practice, and "India West" was itself a modeling error (a Province/State-level concept mistakenly seeded as a `sales_region` node, sibling to APAC).

Added `src/domain/contracts/world-geography.ts`: every ISO 3166-1 country/territory (248, spot-checked against well-known codes, zero duplicates) with its ISO 4217 reference currency, partitioned into 7 LIVEY Sales Regions (North America, Latin America & Caribbean, Europe, Middle East & Africa, India, Greater China, Asia Pacific). The blueprint (product.md 5.1/23.3) requires stable country codes and exactly-one-region-per-country but does not mandate specific region names — that's explicitly Super-Admin-governed — so this 7-region partition is a reasonable default, not a hardcoded blueprint requirement; everything downstream keys off `regionKey`/`code` so it can be re-governed later without code changes.

Rewrote `buildGovernanceSeedRows` in `governance.ts` to generate the full tree (Global + 7 regions + 248 countries + one illustrative Province/State, Maharashtra) via a new `buildWorldGeographyRows` helper, instead of 5 hand-written node literals. `GOVERNANCE_GEOGRAPHY_NODE_IDS` now only fixes `global` (stable for backward compatibility with `deal-commands.server.ts`'s existing geography check) plus `india`/`maharashtra` (still useful shortcuts); other node IDs are derived via new exported `salesRegionNodeId(key)` / `countryNodeId(code)` / `provinceNodeId(code, slug)` functions rather than enumerated. Every country gets two aliases (name + ISO code) so free-text resolution (e.g. "India" or "IN") works either way.

Unified a second, previously-disconnected, incomplete geography dataset: `reference-data.ts`'s `GOVERNED_REFERENCE_BUCKETS` had its own hand-maintained, smaller, inconsistent country/region lists (`COUNTRY_CODES`: 20 countries; `salesRegionItems`: "india-west/south/north/east" + "apac"/"emea"/"americas" — a *third*, different region scheme, unused by any live UI). Replaced both with data mapped directly from `world-geography.ts`, so the onboarding-form country/region dropdowns and the RBAC geography tree can no longer drift apart. Added a new `geography.country_currency` bucket (country code → ISO 4217 currency) for reference/display use.

**Explicitly did not touch** the authoritative money model: `taxonomy.ts`'s `CurrencyCode` (USD/INR only) remains the sole set `MoneyDTO`/fixed-point pricing calculations accept, per the blueprint's "USD is authoritative for commercial calculations; local currency is a separately labelled reference snapshot" invariant. The new currency data is reference/lookup only — expanding the authoritative calculation currency set to ~154 currencies would need real FX-rate coverage the app doesn't have (today only INR conversion exists), and wasn't asked for.

**Scope explicitly not attempted**: Province/State subdivisions for all 248 countries (thousands of ISO 3166-2 rows) — the user asked for "all nations and territories," which this delivers at the country level; only one illustrative province (Maharashtra) exists beyond that, as before.

Fixed a genuine test-determinism bug surfaced by this change: `governance.test.ts`'s "seed rows stay stable" test called `buildGovernanceSeedRows` twice with no explicit `issuedAt`, relying on both calls completing within the same wall-clock millisecond (`Date.now()`) — true when the seed was 5 nodes, no longer reliably true once it's ~500 rows. Fixed by pinning `issuedAt`/`expiresAt`/`correlationId` in the test so it genuinely proves same-input → same-output.

Also fixed a silent pre-existing regression from earlier in this session: `src/lib/deal-filters.test.ts`'s `DealRecord` test fixture was missing `version` (added to the type when the deal-command work landed) — caught by a full repo-wide `tsc --noEmit` sweep, which I had not been running after the first few checkpoints (only scoped file lists). Now confirmed clean against the full pre-existing baseline.

Live Railway data: backfilled non-destructively — `geography.country_currency`/`governance.country_code`/`governance.sales_region` lookup_values buckets via the existing idempotent `seedGovernedReferenceData` upsert path; the geography_nodes/geography_node_aliases tree via a new one-off script calling `buildGovernanceSeedRows` and upserting only `.tenants`/`.geographyNodes`/`.geographyAliases` (never `.assignments`/`.activeContexts`/`.assignmentEvents`, to avoid touching any existing seeded assignment data).

Also fixed unrelated repo housekeeping found in the process: the canonical blueprint path `docs/LIVEY-PAM-CRM-BLUEPRINT.md` (required by the Universal Operating Prompt) was a 38-line stub: the real 6,091-line blueprint had been sitting untracked at `product.md` in the repo root for this entire session. Moved it to the canonical path.

**Remaining for full Phase 1 Checkpoint 1A**: none for country-level data. Province/State-level RBAC (if ever needed beyond the single Maharashtra example) is unscoped.

**Live backfill history (2026-07-30)** — the geography-tree backfill hit three real, distinct collisions against the original 5-node placeholder seed still live in the DB, each caught by an actual constraint violation (no silent partial writes; each attempt was one transaction that rolled back cleanly on failure):
1. `geography_nodes.node_code` is globally unique. The old placeholder nodes (`geo-apac`, `geo-india`, `geo-india-west`, `geo-in-maharashtra`) used `node_code` values (`apac`, `in`, `india-west`, `in-mh`) that the new tree's differently-`node_id`'d nodes also wanted. Verified no `assignments.geography_ceiling_node_id` referenced any of the four (only `geo-global` was ever used), then deleted them — cascading their aliases via `ON DELETE CASCADE`.
2. `geography_node_aliases.legacy_value` is *also* globally unique (not scoped per node). The pre-existing `alias-global` row (legacy_value "Global", still attached to the preserved `geo-global` node) collided with the new tree's own "Global" alias under a new alias-ID scheme. Deleted the one stray row.
3. A genuine design bug in the new data itself, not leftover rows: the new "India" Sales Region and the "India" country both wanted `legacy_value = "India"`. Fixed by no longer aliasing Sales Regions by display name at all (`buildWorldGeographyRows`) — nothing in the app resolves a region from free text; only countries need that, via a deal's `country` field. Regions are addressed by their stable derived ID (`salesRegionNodeId(key)`) instead. Re-verified programmatically (`buildGovernanceSeedRows(...).geographyAliases` has zero duplicate `legacyValue`s) before the successful 4th attempt.

Final live state verified: 1 `global` + 7 `sales_region` + 248 `country` + 1 `province_state` nodes, 498 aliases, correct parent chain (spot-checked `geo-global` → `geo-region-india` → `geo-country-in` → `geo-province-in-maharashtra`).

## 2026-07-31 session: Phase 1 workflow failure, stabilization, full-table seeding, deployment

**What was asked**: implement the 8-phase prompt pack the user pasted (Universal Operating Prompt + Phase 0–7), starting with Phase 1 per dependency order. Mid-run the user redirected to a narrower, concrete ask: "till whats done, deploy, check proper deployment and seed all data populate all tables... I should be able to properly see all accounts all deals, clients, tasks, proper chatbot interface, proper learning courses and certifications and everything." This section covers only that narrower scope. **Phases 2–7 of the prompt pack were not attempted.**

### Phase 1 workflow: launched, then failed on session limits

A 6-work-package Workflow was launched (role runtime spine; schema dedup + Negotiation→Won fix; policy-layer enforcement; Active Context chooser; Assignment lifecycle commands; integration/verify). All 9 agents (5 work packages + verify + integrate) failed with `You've hit your session limit`, and the workflow's own report/verify/integrate step never ran — no adversarial review happened, and `docs/implementation-status.md`/`current gaps.md` were never updated by the workflow itself.

**Only two of the six work packages left anything resembling their intended deliverable on disk**, because agents write files as they go, not only at completion:
- **Package A (role runtime)** landed close to complete: `AppRole` widened from 3 values to the full 9-value `RoleKey`; `src/lib/partner-status.ts` rewritten so LIVEY-internal roles (rm/pam/kam/isr/livey_support/restricted_distributor) are no longer gated by `profile.partner_status`; `app-sidebar.tsx` partially reworked. **Not delivered**: `user-role-commands.server.ts` was never touched, so granting a governed role still does not create/supersede an `assignments` row — role-grants and the Assignment table remain disconnected.
- **Package B (schema dedup + Negotiation→Won)**: landed and, after the fixes below, correct.
- **Package C (policy-layer enforcement)**: **not delivered**. `table-policy.server.ts`'s core deliverable — wiring `applyTablePolicy` to `governance.ts`'s role-power/geography-ceiling model — never happened. The three Phase 1 audit security-critical findings above (direct-query bypasses, flat ownership-only scoping, dead session revocation) are **still open**, unchanged by this session.
- **Package D (Active Context chooser)**: **not delivered**. No `context-commands.server.ts`, `select-context.tsx`, or `context-switcher.tsx` exist. `use-auth.tsx` still takes `typedAssignments[0]`.
- **Package E (Assignment lifecycle commands)**: **not delivered**. No `assignment-commands.server.ts`, no offboarding/reassignment queue.
- Beyond the six packages' assigned scope, agents also independently added (unrequested, discovered during audit): a discount-request workflow (`discount_requests` table + `pricing-commands.server.ts` additions), ticket SLA fields (`human_id`/`response_due_at`/`resolve_due_at` on `support_tickets`), a `learning-commands.server.ts` module (enroll/assessment commands), and a `src/integrations/gyftr/` stub. These were reviewed for safety (not for completeness) and kept where they compiled, tested, and matched already-existing UI expectations.

**Given the failure, this session's actual work was not "continue Phase 1" but "assess what a failed run left behind, decide what's safe to keep, fix what's broken, and deliver the user's concrete ask."**

### Stabilizing the salvaged output

Systematic audit (`git diff`, then a purpose-built script diffing every `CREATE TABLE IF NOT EXISTS` in `db/schema.sql` against the live database's actual `information_schema.columns`) found a **recurring, previously-undiagnosed migration bug class**, most from before this session, one introduced by it:

1. `app_role` enum widening used a bare `CREATE TYPE` inside the file's existing `duplicate_object`-swallowing `DO` block — a no-op on any already-migrated database (this session's regression; fixed with `ALTER TYPE ... ADD VALUE IF NOT EXISTS`).
2. Columns added **inline** to a `CREATE TABLE IF NOT EXISTS` for a table that already existed on this database never actually land, because `CREATE TABLE IF NOT EXISTS` no-ops entirely rather than reconciling columns. Found and fixed for: `support_tickets` (human_id/response_due_at/resolve_due_at, this session's regression), `learning_enrollments` (certificate_token/is_certified, this session's regression), and, pre-existing from before this session: `portal_catalog_items` (6 columns) and all 8 of the governed pricing/catalogue tables (`products`, `product_variants`, `product_skus`, `combos`, `combo_components`, `price_books`, `price_rows`, `fx_snapshots` — ironically the very tables Package B's dedup correctly resolved in *text*, but which still silently failed to apply because the tables already existed). Fixed with idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` appended at the true end of `db/schema.sql`, matching the file's own established convention.
3. A second, larger pre-existing bug independent of the above: `admin.learning.tsx` and `insight-hub.tsx` (both predate this session) query `learning_tracks.is_published`/`tier_requirement`, `learning_subjects.order_index`, `learning_lessons.subject_id`/`order_index`/`is_required`, and `learning_enrollments.progress_percent` — none of which the schema ever defined. Every one of those queries threw, silently swallowed by empty `catch {}` blocks, so **Insight Hub has been fully non-functional (empty) since before this session**, for every user, regardless of seed data. Fixed by adding the missing columns (Track → Subject → Lesson, no Course level, per product.md §14.2) and backfilling `is_published` from `status`.
4. `domain_activity_events`, `deal_line_items`, and all six `learning_*` tables were never registered in `livey-service.server.ts`'s `TABLE_COLUMNS` allowlist or `table-policy.server.ts`'s scope/feature maps, so the generic client `supabase.from(...)` path (used by the dashboard Activity tab, the deal Activity Timeline, and all of Insight Hub) threw "Unsupported table" for every read, also silently swallowed. Registered all of them: `domain_activity_events` and `portal_audit_events` are now both super-admin-only reads (a real per-record activity ACL is future work); `deal_line_items` uses the existing `linked-deal` scope kind; `learning_tracks/subjects/lessons/assessments` are public-read (like `portal_news_posts`/`portal_catalog_items`) with super-admin-only writes; `learning_enrollments`/`learning_assessment_attempts` are scoped to the caller's own `user_id`.
5. `dashboard.tsx`'s new Activity tab called `.limit(30)` on the local `supabase` client shim's `QueryBuilder`, which has no `limit()` method — a plain client-side `TypeError` thrown synchronously during the dashboard's `Promise.allSettled([...])` array construction, before any of its 8 queries ever fired. Caught by `loadDashboard`'s empty `catch {}`, this **broke the entire dashboard for every single user** (not just the Activity tab) — every KPI, the deal/customer/partner/reward/news feed all went silently empty. Fixed by adding real `limit` support end-to-end: `QueryBuilder.limit()` → `TableQuery.limit`/`TableQueryLike.limit` → a validated (`Number.isInteger`, capped at 1000), safely-inlined `LIMIT` clause in `queryTableWithAuthContext`.
6. Two further UI stubs, unrelated to the failed workflow (pre-existing, from before this session, first documented in `current gaps.md` §9b as gap 9b): `deal-line-items.tsx` (`useState<any[]>([])`, comment "In a real implementation this would be fetched from DB"; "Add Item" posted a hardcoded `productId: "dummy-product"`) and `deal-participant-tags.tsx` (same pattern; "Tag Someone" posted a hardcoded `participantUserId: "dummy-user-id"`). Rewired both to fetch real rows via the now-registered tables; removed the two hardcoded-fake-data add buttons (no real product/user picker UI exists) rather than ship a button that would silently write garbage literal strings into real commercial records — `deal_line_items.product_id`/`deal_participants.actor_id` have no FK constraint, so this would not even have failed loudly.

Every fix above has a regression test (`table-policy.server.test.ts` gained 5 new tests: `domain_activity_events` super-admin-only, `deal_line_items` linked-deal unscoped-for-super-admin, Insight Hub public-read + write-lock, `learning_enrollments`/`learning_assessment_attempts` user-scoping). Verified end-to-end in a real browser against the **production build** (`bun run build` + `node .output/server/index.mjs`), not `vite dev` — `vite dev`'s SSR routing returns a bare h3 404 for every route in this sandbox (Vite's own asset/module serving works fine; confirmed unrelated to any change this session, and irrelevant to the actual Railway deploy path, which only ever runs the production build).

### Full-table seeding

`scripts/seed-phase1-supplement.ts` (new): additive, idempotent (deterministic UUIDs derived from a SHA-256 of a stable namespace + key, every write an `INSERT ... ON CONFLICT DO UPDATE`), reads whatever partners/customers/deals/profiles already exist rather than assuming a fixed fixture, and populates: portal catalogue items; `deal_line_items` + `pricing_revisions` for every deal; `deal_outcome_reviews` for Won deals; `deal_participants`/`customer_participants` (RM/ISR/KAM tags); `discount_requests` for Proposal/Negotiation-stage deals; `tasks` across all five states; `support_tickets` + comments across all five states; the full Insight Hub content tree (3 tracks × 5 subjects × 7 lessons × 3 assessments) with enrollments cycling through not-enrolled/in-progress/certified plus real assessment attempts; reward catalogue + point-award + redemption rows for Won deals; 3 news posts; notifications; `partner_documents`/`deal_documents` backed by real PDF bytes (the repo's existing `tmp/dummy-docs/*.pdf` fixtures) loaded into `document_blobs`; `portal_audit_events`; `domain_activity_events` + `deal_transitions` + `task_transitions` (realistic per-deal history, driving the newly-fixed Activity Timeline); `portal_customer_activities`; `partner_review_notes`; a short real Assistant conversation transcript; and a thin instance of the governed pricing/catalogue layer (products/variants/skus/price book/price rows/one combo) for schema completeness, even though no current UI reads it. Also includes a one-time data-hygiene fix: migrates any deal still on the retired `approved` pipeline stage (pre-existing seed data predates the canonical 8-stage model) to `negotiation`, since a deal on a stage no longer in `DEAL_STAGE_ORDER` is invisible on the pipeline board.

Left deliberately empty (verified correct, not a gap): `command_inbox` (no inbound webhook traffic in dev), `customer_merge_events` (no duplicates seeded), `fx_snapshots`/`learning_courses`/`portal_demo_feed_items`/`portal_demo_metrics`/`portal_demo_partner_spotlights` (dead tables — zero references anywhere in `src/`), `password_reset_tokens`/`zoho_sign_tokens` (ephemeral/provider-connection state), `role_geography_access` (empty is the documented default meaning "unrestricted").

### Verification

`bun test src`: 206 pass, 0 fail (baseline was 202; +4 from this session's new tests). `bun run lint`: clean, 0 errors/warnings, repo-wide. `bun run build`: clean. Browser-verified against the production build, logged in as both `super_admin` (`maya.admin@livey.tech`) and a `partner_user` (`northstar.user@livey.tech`, confirming partner-scoped RBAC actually isolates data — Karan Mehta's dashboard shows Northstar's 1 deal/$4,250, not the global $67,650): Dashboard (KPIs, News/Activity tabs), Deals list + detail (line items, participants, outcome-review gate, activity timeline), Pipeline, Customers, Tasks (all 5 states with working transition buttons), Insight Hub (tracks, tier-gating, live enroll flow, progress bar), Rewards, Support (ticket numbering, threaded replies), and the Assistant chatbot (live OpenRouter-backed "show me my deals" query returning real deal data).

**Local-only dev password set for verification** (not applied in production): `maya.admin@livey.tech` / `northstar.admin@livey.tech` / `northstar.user@livey.tech` on the local dev database only, password `Verify-Dev-2026!`.

### Deployment

Railway project `adventurous-learning`, service `nexus-partner-portal`, already linked and online at `https://systemforgelabs.xyz`, deploying from `origin` (`s33dyy/nexus-partner-portal` on GitHub) — `railway.json`'s `startCommand` (`bun run db:migrate && bun run start`) already applies `db/schema.sql` on every deploy, so no separate migration step is needed beyond pushing. Production database (read-only checked via `railway connect Postgres` — `railway run` fails because the app's own `DATABASE_URL` is Railway's internal-only `postgres.railway.internal` hostname, unreachable outside Railway's network; the `Postgres` service's own `DATABASE_PUBLIC_URL` is externally reachable) currently holds the original 5-partner `prod-demo-seed` fixture (5 partners, 7 deals, 5 customers) — smaller and different from the local dev database's organically-grown 10-partner set. The supplemental seed script is written to work against either.

**Remaining for this entry**: push, confirm the live deploy is healthy, run the supplemental seed script against `DATABASE_PUBLIC_URL`, and do a final live-site check — tracked as the immediate next step, not yet complete as of this writing.

### Explicitly still open (unchanged by this session)

Every Phase 1 Audit Finding from 2026-07-30 above remains open: generic-path policy bypasses on document upload/download and the Zoho Sign webhook; `table-policy.server.ts` still does flat ownership scoping only, with no role-power/geography-ceiling enforcement; `revokeUserSessionsAndContexts` is still uncalled dead code; no Assignment self-lifecycle commands exist; no Active Context chooser exists (`typedAssignments[0]`); `app-sidebar.tsx` is still materially static role-key filtering rather than capability-generated; RBAC test coverage is still far short of the full role × scope × assignment-state matrix. `current gaps.md` at the repo root has the full chapter-by-chapter accounting against `product.md`; it was not re-run against this session's changes and should be treated as stale for the specific items fixed above (role runtime, the dashboard/timeline/Insight Hub bugs, the seed data) but otherwise accurate.

## 2026-07-31 session (continued): production seeding, four more S1 fixes from `current gaps.md`

**What was asked**: per explicit user direction, read `product.md`, find bugs/errors/gaps, fix them, and seed data — all in production (Railway CLI already authenticated by the user).

Given `current gaps.md` already had a thorough, recent (same-day) chapter-by-chapter accounting against `product.md` — not stale enough to warrant redoing — this session worked from it directly rather than re-deriving a gap analysis from scratch, following its own §20 suggested sequencing: seed production first (bounded, zero-risk, already staged from the prior session), then fix bounded S1 items in priority order. The large rebuilds `current gaps.md` documents (discount workflow, Working-Draft→Pricing-Revision model, notification recipient-resolution rewrite, full policy-layer rewrite, email/WhatsApp delivery infrastructure, Auto CRM, Insight Hub assessments/certificates) were explicitly not attempted — each is a multi-day effort on its own, not a same-session fix.

### Production seeding

Ran `scripts/seed-phase1-supplement.ts` (written in the prior session but never executed against production — the prior session's "Remaining for this entry" note) against `DATABASE_PUBLIC_URL`. Confirmed via row counts post-run: 5 partners, 7 deals, 7 deal line items, 7 tasks, 5 support tickets, 9 ticket comments, 3 learning tracks, 21 enrollments, 5 reward catalog items, 4 news posts, 15 partner documents, 29 activity events, etc.

### Fixed: rewards released on `stage = won` instead of the outcome-review approval (§2.3)

`awardDealWinPoints` was called directly from `deals.tsx` (two call sites), `pipeline.tsx`, and `admin.deals.tsx` the instant a deal's pipeline `stage` reached `"won"`, using the free-text `deal.amount` as the basis — violating product.md §15.11 ("points are not created when Deal is merely marked Won"; the basis must be the final approved reward-eligible DTP total). Moved award issuance into `outcome-review-commands.server.ts`'s `approvePO` (the actual PO-approval command, the closest existing state to canonical `approved_won`), inside the same transaction as the approval. The new `awardApprovedWinRewards` helper: is idempotent (checks for an existing `reward_point_events` row for the deal before writing, so `approvePO` can't double-award); prefers the latest `pricing_revisions.total_dtp_usd` where `is_final = TRUE` over `portal_deals.amount_usd`/`amount` when a final revision exists; and reads collaborator splits from `portal_deal_collaborators` directly (falling back to the deal owner as sole 100% recipient when none exist), reusing the existing pure `calculateDealRewardAllocations` allocator. Removed the four premature call sites and their now-dead `collaboratorsByDealId` pipeline state / `selectedDealCollaboratorsForPayout` deals-page derivation. 5 new tests in a new `outcome-review-commands.server.test.ts` (this module had zero test coverage before this fix): correct allocation, revision-total preference, multi-collaborator split, idempotency, and non-super_admin denial awarding nothing.

### Fixed: ticket internal notes were not actually internal, and the reply feature was broken outright (§13f)

While fixing this, found `ticket-commands.server.ts`'s `addTicketReply` INSERTs `is_internal`, `support.tsx` reads and client-side-filters on `comment.is_internal`, and `portal-records.ts`'s `SupportTicketCommentRecord` types it — but `support_ticket_comments`'s `CREATE TABLE IF NOT EXISTS` never defined that column, and no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` existed for it either. Confirmed directly against production via `psql \d support_ticket_comments`: the column did not exist. Every ticket reply insert has been failing in production with `column "is_internal" does not exist` since the ticket-command module landed — the same recurring migration-bug class the 2026-07-31 session above diagnosed for other tables, just not caught for this one until now. Added the column.

Beyond the missing column, the visibility filter itself was client-JS-only (`support.tsx` fetched every comment over the network regardless of role, then hid internal ones in the render) — a real leak of internal LIVEY notes to Partner users, matching this exact gap in `current gaps.md` §13f. Moved filtering server-side: `table-policy.server.ts`'s `linked-ticket` scope branch now forces an `is_internal = false` filter onto every `select`/`count` for any actor who isn't `super_admin`/`livey_support`, and rejects an `insert` with `is_internal: true` from anyone else. Added the identical restriction at the command layer (`addTicketReply` now denies `isInternal: true` from a non-Support/non-Super-Admin actor with `POLICY_DENIED`), since that path writes via raw SQL and doesn't go through `table-policy.server.ts` at all.

**Related bug found and fixed while verifying the above**: the generic table-policy path (`getScopeSpec`'s `"column"` kind, used for `support_tickets`, and `assertLinkedTicketAccess`, used for `support_ticket_comments`) only ever recognised `partner_id`-owns-row or `userId`-created-row. A LIVEY-internal role (`rm`/`pam`/`kam`/`isr`/`livey_support`) has no `partnerId`, so it fell through to "the row's `created_by`/`author_id` equals me" — meaning a Support agent's ticket queue was invisible through this path unless they personally created every ticket. Added `hasGlobalLiveySupportAccess` (mirrors the identical "geography ceiling === Global" fail-closed policy `ticket-commands.server.ts`'s `authorizeTicketActor` already uses on the write side) and wired it into both the `support_tickets` read scope and `assertLinkedTicketAccess`, scoped narrowly to these two tables for now — the same gap likely exists on other ownership-scoped tables (`portal_deals`, `tasks`, etc.) for LIVEY-internal roles and needs its own per-table review; not fixed here beyond tickets. 7 new/updated tests across `table-policy.server.test.ts` and `ticket-commands.server.test.ts`.

### Fixed: partner-facing Settings could show Governance/Configuration export sections (§16e)

product.md §16.4 forbids "Governance exports; Configuration exports" on partner-facing Settings, but `settings.tsx` always rendered those two `SectionBlock`s regardless of role — even with zero visible datasets, the card header and "No exportable datasets are visible in this section for your current role" message still rendered, which is itself still "including" the section per the spec's intent. Gated both blocks to `role === "super_admin"`, matching the existing convention already used for the Integrations card further down the same page. Also recategorized two datasets in `export-registry.ts` that were letting `partner_admin` see a "Governance exports" section at all: `portal-team-members` moved from `group: "governance"` to `"operational"` (it's genuinely partner-operational, company-scoped data — the export for `/partner/team`, not an administrative record); `portal-news-posts` changed from `visibleTo: ADMIN_ROLES` to `SUPER_ADMIN_ONLY` (bulk-exporting the global published-content feed is a LIVEY content-administration action). The specific `partner-documents` dataset `current gaps.md` cited as `visibleTo: ALL_ROLES` no longer exists in the registry at all (resolved in an earlier, undocumented pass) — that detail was stale, but the structural page-identity violation it was describing was real and is what this fix closes. `settings.tsx` is still literally titled "Export hub" and centralizes exports rather than each module owning its own — that IA-level point (distinct from the access-control violation just fixed) is still open. 2 new tests.

### Fixed: audit events trusted client-supplied actor identity (§19f)

`recordAuditEvent` (`workflow-events.ts`) is called from client route components (`deals.tsx`, `pipeline.tsx`, `admin.deals.tsx`, etc.) with `actorName`/`actorRole` read from client-side React state (`profile`, `hasRole()`), then inserted via the generic `queryTable()` path with no server-side check on those two fields — a tampered client could attribute any audit event to any name or role, defeating product.md §19.8's non-repudiation requirement. Added `portal_audit_events.actor_id` (FK to `profiles`) and a `withNonRepudiableActor` helper in `table-policy.server.ts` that, on every insert to this table, looks up the caller's real `profiles.full_name` and derives their role from the server-verified `auth.roles` (not client input), then overwrites `actor_id`/`actor_name`/`actor_role` on the row regardless of what the client sent. Registered `actor_id` in `TABLE_COLUMNS` so it isn't silently dropped by the write allowlist. Narrative fields (`action`, `target_type`, `outcome`, `details`) remain client-supplied — closing that fully means moving audit writes entirely server-side into the domain command modules (product.md §18.8), a larger change not attempted here. 2 new tests.

### Verified: duplicate `products`/`price_books` schema definitions (§18b) — already resolved

`current gaps.md` flagged `products`, `product_variants`, `product_skus`, `combos`, `combo_components`, `price_books`, `price_rows`, and `fx_snapshots` as each defined twice in `db/schema.sql`. Grepped the current file: exactly one `CREATE TABLE IF NOT EXISTS` per table remains for all eight — this was already resolved by the 2026-07-31 session's Package B schema-dedup work above. No change needed.

### Verified: the "cheap to land" §4a-c UI items — already resolved

Checked `pipeline.tsx` for the `group-hover`/`opacity-0` hidden-card-fields pattern §4b describes: no matches, already removed. Checked `deal-line-items.tsx`'s delete button (§4c): has a working `handleRemove` handler, already wired. Checked `insight-hub.tsx`'s "View certificate"/"Continue learning"/"Start track" buttons (§4c): "View certificate" and "Start track" have real handlers (`handleViewCertificate`, `handleStart`, both calling real commands); "Continue learning" is honestly `disabled` (greyed out, not a deceptive no-op) pending an actual lesson-content viewer, which doesn't exist yet — a separate, larger gap (§14b), not a quick fix. All three were already fixed in the 2026-07-31 session above. `admin.integrations.tsx`'s Operations Centre (`INITIAL_PROVIDERS` hardcoded mock data, no-op pause/resume/reconnect buttons) is still unfixed, but it is properly part of the separate, large §2.7/§17 integration-layer gap (needs real `provider_connections`/`sync_jobs`/etc. schema and a worker) — not attempted, since a partial fix here would just be new mock UI.

### Fixed: document upload/download/delete had no authentication or authorization check at all (§2.6 finding 1, document half)

The Phase 1 audit's finding 1 (`docs/implementation-status.md` "Phase 1 Audit Findings" above) said `uploadDocumentBlob`/`createDocumentDataUrl`/`removeDocumentBlobs` bypass `applyTablePolicy` by querying the database directly. Tracing the actual client-reachable entry points (`uploadDocument`/`createSignedUrl`/`removeDocuments`, the `createServerFn` handlers in `src/integrations/local/client.ts` that call those three functions) found the severity was worse than "bypasses the generic policy layer": there was no authentication or authorization check whatsoever on any of the three. Any caller — including an anonymous one with no session at all — could call `createSignedUrl` with a guessed or otherwise-obtained `file_path` and read the full contents of any partner or deal document across every tenant; call `uploadDocument` to overwrite the stored bytes at any existing `file_path` (the underlying `document_blobs` insert is `ON CONFLICT (file_path) DO UPDATE`); or call `removeDocuments` to delete any document outright. This is a live, exploitable, cross-tenant confidentiality and integrity vulnerability, not merely an architectural gap.

Added `assertDocumentAccessWithAuthContext` in `livey-service.server.ts`, deliberately mirroring the ownership rule `table-policy.server.ts` already enforces for the `partner_documents`/`deal_documents` rows themselves rather than inventing a new policy: `super_admin` is unscoped; otherwise the caller's `partner_id` or `uploaded_by`/`user_id` must match the row found by looking up `file_path` in the table matching the request's bucket (`partner-documents` → `partner_documents`, `deal-documents` → `deal_documents`); a `file_path` with no matching row is only valid for a fresh `write`, and only under a prefix matching the caller's own `partner_id` (the `{partnerId}/...` convention both existing upload call sites — `partner.onboarding.tsx`, `deal-documents.tsx` — already use). Wired into all three `createServerFn` handlers before they touch the blob functions. Split into `assertDocumentAccessWithAuthContext` (pure, takes an explicit auth shape) plus a thin `assertDocumentAccess` wrapper that calls `getAuthContext()`, matching the codebase's existing `queryTableWithAuthContext`/`queryTable` split — the pure function is unit-testable without a request-scoped session cookie, which a bare `getAuthContext()` call is not in this test environment.

Known residual gap, matching the identical gap already fixed for `support_tickets` in the §13f fix above: no LIVEY-internal-role (rm/pam/kam/isr/livey_support) bypass exists here, consistent with the fact that these roles don't have one on the generic `partner_documents`/`deal_documents` read path either — not widened in this fix. The Zoho Sign inbound webhook handler, audit finding 1's other named bypass, is unrelated to the document-serving path and is still open. 9 new tests in `livey-service.server.test.ts`.

### Deployment

Three commits pushed to `origin/main`, each auto-deployed by Railway and verified live (`railway status` showing a new deployment ID + Online, `bun scripts/apply-migrations.ts` succeeding in the deploy logs, `curl` returning 200, and the new schema columns confirmed present via direct `psql` against `DATABASE_PUBLIC_URL`): `1540241` (§2.3, §13f, §16e), `f9b426e` (§19f), and `e493bb8` (§2.6 document-access bypass). No login credentials for the production site were available this session, so UI-level verification was done via direct database queries (row counts, `\d` column checks) rather than an authenticated browser pass — noted here rather than silently claimed as browser-verified.

### Verification

`bun test src`: 226 pass, 0 fail (baseline 206 before this session's tests; +20 new/updated across `table-policy.server.test.ts`, `ticket-commands.server.test.ts`, `outcome-review-commands.server.test.ts` (new file), `export-registry.test.ts`, `livey-service.server.test.ts`). `bunx tsc --noEmit` clean on every touched file (repo-wide pre-existing unrelated errors in `src/integrations/local/lookups.ts` and `livey-service.server.test.ts` untouched, confirmed present identically on `main` before this session). `bunx eslint` clean on every touched file. `bun run build` clean after every commit.

### Explicitly still open (unchanged by this session)

Everything in `current gaps.md` not called out as fixed above: the entire §2.4 notification-broadcast rewrite, the remaining §2.6 policy-layer findings (the Zoho Sign webhook's own direct-DB bypass, no real role-power/geography-ceiling enforcement beyond the deal/ticket/user-role command modules and now document access, dead session revocation, no Assignment lifecycle commands, no Active Context chooser, static navigation), §2.7's fabricated Operations Centre, the three-dimension deal model split, the discount workflow, Working-Draft→Pricing-Revision, Contact entity, Coverage Exceptions, auto-tagging, SLA policy, Insight Hub assessments/certificates, all external provider integrations beyond Zoho Sign, and every other item across chapters 4-19 and 23. `current gaps.md` itself is now updated in place with today's fixes rather than left to go stale a second time.
