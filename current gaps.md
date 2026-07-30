# Current Gaps — `product.md` vs. the shipped product

| Attribute | Value |
| --- | --- |
| Analysed | 30 July 2026 |
| Specification | `product.md` (Blueprint v1.0, 6,091 lines, 23 chapters) |
| Codebase | `main` @ `3e5cbc2`, 32 routes / ~20k route LOC, `db/schema.sql` (69 tables) |
| Method | Chapter-by-chapter read of `product.md`, then direct inspection of routes, server commands, domain contracts, and schema |
| Related | `docs/implementation-status.md` (Phase 1 audit findings — still open, and re-confirmed below) |

This document records **only gaps**: places where the shipped product does not do what
`product.md` says it must. Where something is already correct it is noted briefly so the
list is not mistaken for a full inventory.

> **2026-07-31 update.** A Phase 1 implementation pass (see
> `docs/implementation-status.md`'s "2026-07-31 session") closed a narrow slice of what's
> below: the role-runtime gap in §2.1/5e/7c (all 9 canonical roles now resolve at runtime,
> though the deeper capability-generated-navigation and role-grant-creates-Assignment pieces
> remain open); the Negotiation→Won breakage in §2.2; the `deal-line-items.tsx`/
> `deal-activity-timeline.tsx` fabricated-data stubs in §2.8/9b (both now read real data,
> plus `deal-participant-tags.tsx`, not separately listed below, had the same issue); and the
> Insight Hub being fully non-functional (a pre-existing schema/UI mismatch this pass found
> and fixed, not previously itemized as its own gap here). The §2.6 policy-layer findings,
> §2.4 notification broadcast issue, §2.3 reward-on-`won`-not-`approved_won` issue, and
> everything else below are **unchanged and still open** — this pass did not attempt them.



Severity legend:

- **S1 — Blocking / unsafe.** Violates a security, financial, or acceptance-criteria
  invariant, or the feature is functionally broken in the live app.
- **S2 — Major.** A required capability is absent or is present only as a non-functional stub.
- **S3 — Divergent.** The capability exists but does not match the canonical model, labels,
  or contract.

---

## 1. Summary by chapter

| Ch. | Area | State | Worst severity |
| --- | --- | --- | --- |
| 4 | Experience & interaction system | Partial — free-text search still everywhere, hover-only pipeline actions, dead controls | S2 |
| 5 | Hierarchy, identity, context, RBAC | Partial — data model exists, enforcement and 6 of 9 roles do not | **S1** |
| 6 | Auth, onboarding, profiles, teams | Partial — onboarding wizard good; no email verification, no MFA, no rate limits, 4 of 13 lifecycle states missing | **S1** |
| 7 | Navigation & role dashboards | Partial — 1 dashboard for 9 roles; static role-key nav | S2 |
| 8 | Partners, Customers, Contacts | Partial — no Contact entity; POC is free text | S2 |
| 9 | Deals, pricing, approvals, pipeline | Partial — three state dimensions collapsed into two text columns; line items are a stub; **Negotiation → Won is broken** | **S1** |
| 10 | Tasks | Partial — basic CRUD + transitions; no templates, watchers, recurrence, dependencies, checklists | S2 |
| 11 | News, Activity, Notifications, Delivery | Partial — notifications broadcast by `partner_id`; no Activity tab; no digest/email/WhatsApp at all | **S1** |
| 12 | Assistant, Website/WhatsApp, Auto CRM | Minimal — Assistant does 2 of 11 capabilities; **Auto CRM, website assistant, WhatsApp entirely absent** | S2 |
| 13 | Support & ticketing | Partial — no ticket number, no customer, no SLA, no attachments, no reopen request | S2 |
| 14 | Insight Hub, assessments, certification | Skeleton — content tables only; **no assessments, attempts, or certificates** | S2 |
| 15 | Rewards & fulfillment | **Incorrect** — points released on `stage = won`, not on `approved_won`; no reservation; no GyFTR | **S1** |
| 16 | Analytics, imports, exports, settings | Partial — Settings is an export hub, which the spec forbids; 3 of 15 report groups | S2 |
| 17 | External integrations | Absent — Zoho Sign only; Operations Centre is hardcoded mock data; no outbox worker, inbox, links, or reconciliation | **S1** |
| 18 | Canonical data model | Partial — contracts exist but the live tables are the legacy portal schema; duplicate `products` definitions | S2 |
| 19 | Security, privacy, reliability, a11y | Partial — see Phase 1 audit; no rate limits, MFA, retention, or observability | **S1** |
| 23 | Governed defaults & dictionaries | **Divergent** — 10 of 16 canonical dictionaries do not match `taxonomy.ts` | S2 |

Chapters 20 (migration), 21 (test catalogue), and 22 (traceability) are process
chapters; their gaps are folded into §12 below.

---

## 2. S1 gaps — fix before anything else

### 2.1 Only 3 of 9 canonical roles actually work at runtime

`product.md` §1.4 / §5.4 defines nine roles. `src/domain/contracts/taxonomy.ts:1` and the
admin screens (`admin.users.tsx:74`, `admin.roles.tsx:230`) let a Super Admin assign all nine.
But the live auth bridge only understands three:

```
src/hooks/use-auth.tsx:12       export type AppRole = "super_admin" | "partner_admin" | "partner_user";
src/server/livey-service.server.ts:19   export type AppRole = "super_admin" | "partner_admin" | "partner_user";
src/hooks/use-partner-access.ts:12-16   roles = [super_admin?, partner_admin?, partner_user?].filter(Boolean)
```

A user assigned `rm`, `pam`, `kam`, `isr`, `livey_support`, or `restricted_distributor`
resolves to `roles = []`. `getPartnerAccessFlags` (`src/lib/partner-status.ts:90`) then keys
everything off `profile.partner_status`, which for an internal user is
`pending_partner_registration` → `accessLevel: "none"` → `useRequireAccess` redirects them to
`/partner/onboarding` (`src/hooks/use-partner-access.ts:43`).

**Effect:** the entire LIVEY internal team — the #1 stated product priority — cannot use the
product. Every RM/PAM/KAM/ISR/Support/Distributor behaviour downstream (auto-tagging,
regional dashboards, discount approval, won review, ticket queues, Distributor safe view)
is unreachable, not merely unimplemented.

---

### 2.2 Negotiation → Won cannot be performed

`DEAL_STAGE_ORDER` was corrected to the canonical 8 stages
(`src/lib/portal-records.ts:3`), but the code that consumed the old 9-stage list with
`approved` was not updated:

- `src/server/deal-commands.server.ts:45-51` — `FORWARD_NEXT_STAGE` skips any pair touching a
  terminal stage, so `negotiation` has **no** forward target. `moveDealStageForward` from
  Negotiation always fails.
- `src/server/deal-commands.server.ts:347` — `if (stage === "approved") actions.push("deal.mark_won")`
  is unreachable; `deal.mark_won` is never advertised as a next authorised action.
- `src/routes/_authenticated/pipeline.tsx:246` — `deal.stage === "approved" ? markDealWon(...) : moveDealStageForward(...)`
  can never take the `markDealWon` branch.
- `src/routes/_authenticated/pipeline.tsx:468` — the board renders `xl:grid-cols-7` for 8 stages.

**Effect:** the pipeline board cannot close a deal. §9.15 (Won/Lost flow), §9.19, and the
whole reward chain are unreachable from the primary operational surface.

---

### 2.3 Rewards are released on `stage = won`, which §15.11 forbids

`product.md` §15.1/§15.11: *"Points are not created when Deal is merely marked Won"* —
`outcome_review_status = Approved Won` is the only trigger, and the basis is the **final
approved reward-eligible DTP total**.

Shipped behaviour:

```
src/routes/_authenticated/deals.tsx:1525   if (stage === "won") { await awardDealWinPoints(...) }
src/routes/_authenticated/deals.tsx:1600   (second call site, closeAs)
src/routes/_authenticated/admin.deals.tsx:342
src/routes/_authenticated/pipeline.tsx:277
```

Every call passes `dealAmount: deal.amount` — the free-text deal amount column — times
`reward_rate_percent`. It never reads `deal_line_items`, `pricing_revisions`, or
`deal_outcome_reviews`. `deal_outcome_reviews` exists and is written by
`outcome-review-commands.server.ts`, but nothing gates the reward on it.

Additional reward gaps:

- No points-conversion-rate policy (§15.2). `src/lib/rewards.ts:3` has a flat
  `DEAL_WIN_REWARD_POINTS = 500` constant, which is never used.
- No largest-remainder allocation, no "split must total exactly 100.00%" guard (§15.3).
- No contributor-eligibility guard — §15.3 requires Won approval to be *blocked* when no
  eligible Partner contributor exists; `awardDealWinPoints` silently falls back to
  `fallbackUserId` (`src/lib/rewards.ts:139`).
- No ledger event taxonomy (§15.4): `reward_point_events.source_type` is free text; there is
  no reversal, reservation, release, expiry, or migration event type.
- Redemption does **not** reserve points (§15.7). `rewards.tsx:234` inserts a
  `reward_redemptions` row with `status: 'requested'` and no balance check, no stock
  decrement, and no transaction.

---

### 2.4 Transactional notifications are broadcast to whole partner organisations

`product.md` §11.5: *"Notifications do not target all members of a Partner merely because
`partner_id` matches."* §5.8: transactional notifications go to **active typed participants
only**.

Shipped behaviour writes one row keyed to `partner_id` and every partner user reads it:

```
src/lib/workflow-events.ts:24            db.from("notifications").insert({ ... partner_id ... })
src/components/app-shell.tsx:70-79       unread count queried by partner_id (super_admin: unscoped, all rows)
src/routes/_authenticated/deals.tsx:896
src/routes/_authenticated/pipeline.tsx:169
src/routes/_authenticated/admin.deals.tsx:217
```

The `deal_participants` / `customer_participants` tables exist (`db/schema.sql:396,412`) but
no notification path consults them. There is no recipient-resolution algorithm, no
watchers, no self-notification suppression, no send-time re-authorisation, no preference
policy, and no dedupe — i.e. none of §5.8's seven canonical steps.

The `notifications` table (`db/schema.sql:1236`) also has no category, deep link, context
label, mandatory/critical flag, or delivery linkage.

---

### 2.5 No external delivery exists at all

§11.7, §17.6, §17.7 require an email + WhatsApp digest pipeline with delivery states,
retries, provider receipts, consent, and suppression.

There is **no mail transport in the repository** — no `nodemailer`, `resend`, `sendgrid`,
`postmark`, or SMTP client in `package.json` or `src/`. There is no WhatsApp adapter, no
`delivery_attempts` table, no digest scheduler, and no `external delivery` state machine
(§23.4). Password reset, invitation, and email-verification messages therefore also have no
delivery channel.

---

### 2.6 Policy layer still bypassed (Phase 1 audit, re-confirmed)

The findings in `docs/implementation-status.md` are unchanged in the working tree:

1. `uploadDocumentBlob` / `createDocumentDataUrl` / `removeDocumentBlobs`
   (`src/server/livey-service.server.ts:1775,1864,1936`) and the Zoho Sign webhook handler
   query the database directly, bypassing `applyTablePolicy` entirely.
2. `src/server/table-policy.server.ts` performs flat `partner_id`/`user_id` ownership scoping
   and never calls `src/domain/contracts/governance.ts`. The governed role-power and
   geography-ceiling model is not enforced for generic reads/writes. Export, import, file,
   assistant, worker, and webhook surfaces do not consult it at all.
3. `revokeUserSessionsAndContexts` (`src/server/livey-service.server.ts:1266`) has no callers
   outside its own test — offboarding session revocation (§5.9 step 1) is dead code.
4. No commands exist to transition an Assignment's own lifecycle
   (Scheduled → Active → Suspended/Ended/Revoked, §5.2). There is no in-app way to do it.
5. No Active Context chooser exists. `src/hooks/use-auth.tsx:78` takes
   `typedAssignments[0]` — the first row. §5.3's login Assignment selection, "Start in"
   geography cascade, Switch Assignment / View Within header control, deep-link handling,
   and context-switch audit event are all absent.
6. `src/components/app-sidebar.tsx` is static role-key filtering, not capability/context
   generation (§7.1).
7. RBAC test coverage is far short of the role × scope × assignment-state matrix in §21.2.

---

### 2.7 Integration Operations Centre is fabricated data

§17.3 requires a real Operations Centre. `src/routes/_authenticated/admin.integrations.tsx:52`
defines `INITIAL_PROVIDERS` as a hardcoded array with fake values
(`lastOutbound: "2 mins ago"`, `conflicts: 2`) held in `useState`. Pause / resume /
reconnect / retry buttons mutate local state only.

A Super Admin is shown invented integration health. Nothing in §17.2's canonical record set
exists in the schema: no `provider_connections`, `external_links`, `webhook_receipts`,
`sync_jobs`, `sync_conflicts`, `delivery_attempts`, or `dead_letter_items`.
`command_outbox` / `command_inbox` tables exist (`db/schema.sql:880,899`) and
`deal-commands.server.ts` appends to the outbox, but **no worker drains it** — outbound
integration work is written and never processed.

---

### 2.8 The Deal Activity timeline shows invented events

`src/components/deal-activity-timeline.tsx:8-14` renders three hardcoded rows
("Deal Created", "Pricing Revision Frozen", "Deal Registration Submitted") with
`new Date()` timestamps and fake actor names "John Doe" / "Jane Smith". It is rendered in
the live deal detail sheet (`src/routes/_authenticated/deals.tsx:2464`).

Real events **are** being written to `domain_activity_events` by the deal, task, ticket, and
user-role command modules. Nothing reads them. §9.17 and §11.3 (Activity is append-only,
authoritative, and user-visible) are unmet, and the current screen is actively misleading.

---

### 2.9 Authentication has no verification, MFA, or rate limiting

§6.1 requires email verification, MFA challenge, rate limits by account/IP/device, and
security events for new devices. §6.2 makes email verification a hard gate before onboarding
("unverified identities cannot enter Partner onboarding").

Grep across `src/` returns no matches for rate limiting, MFA/TOTP, `email_verified`, or
verification tokens. `signUpLocal` (`src/server/livey-service.server.ts:1407`) creates a
usable account immediately. Passwords use bcrypt cost 10.

---

## 3. Chapter 4 — Experience and interaction system

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 4a | §2.1.6, §4.6: *"All free-text search inputs are removed."* Also §9.13, §10.3, §13.8, §14.8, §15.6, §16.5 each restate it. | 14 pages still ship a search box: `rewards.tsx:376`, `deals.tsx:1717`, `admin.audit.tsx:167`, `partner.team.tsx:428`, `support.tsx:392`, `admin.partners.tsx:620`, `pipeline.tsx:443`, `admin.deals.tsx:426`, `admin.news.tsx:309`, `documents.tsx:315`, `admin.rewards.tsx:592`, `admin.users.tsx:468`, `deal-documents.tsx:367`, `customers.tsx:762` | S2 |
| 4b | §4.8: *"no hover-only disclosure"*; §9.19: *"Pipeline cards expose Partner, POC, Product, and value without hover"* | `pipeline.tsx:502` — owner, region, product, probability, **Move forward**, and **Notes** are `max-h-0 opacity-0 pointer-events-none` until `lg:group-hover`. Only account name and amount are always visible. | S2 |
| 4c | §4.4: *"The product does not render controls that appear available but do nothing."* | `insight-hub.tsx:300-320` — "View certificate", "Continue learning", "Start track" have no `onClick`. `deal-line-items.tsx:96` — delete button has no handler. `admin.integrations.tsx` — every operator action is a no-op. | S2 |
| 4d | §4.3: header must contain breadcrumb, **active-context switcher**, assistant launcher, notification indicator, help entry, user menu | `app-shell.tsx:104-160` has a read-only context badge plus a "Refresh context" button. No switcher, no breadcrumb, no help entry. | S2 |
| 4e | §4.6: saved personal views, shared governed views, filter chips, column visibility/ordering, pagination/virtualisation | None implemented on any list. No `saved_views` table. | S2 |
| 4f | §4.5: drafts autosave; consequential submissions show a review step; closing a dialog with unsaved changes prompts | Only the partner onboarding wizard autosaves. No review step on deal submit; no unsaved-changes prompt anywhere. | S3 |
| 4g | §4.7: long-running imports/exports/syncs show progress, allow navigation away, and produce a durable completion notification | Exports are synchronous client-side CSV/XLSX writes (`src/lib/csv-export.ts`, `analytics-export.ts`). No async job model. | S3 |
| 4h | §4.8: WCAG 2.2 AA release target, zero critical violations in release testing | `eslint-plugin-jsx-a11y` and Playwright are installed; `e2e/` contains 2 specs (`auth-rbac`, `deal-pipeline`). No a11y audit, no captions/transcripts (no video content model exists), no accessible drag-and-drop alternative. | S3 |

---

## 4. Chapter 5 — Hierarchy, identity, context, RBAC

Beyond the S1 items in §2.1, §2.6:

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 5a | §5.4 Distributor safe view: exact readable-field set and a 6-command allowlist (`customer.addSharedNote`, `task.createForSelf`, `task.updateAssigned`, `task.completeAssigned`, `document.uploadSharedFulfillment`, `logistics.updateDistributorFulfillment`) | Nothing. The role key `restricted_distributor` exists in taxonomy and can be assigned, but no safe view, no allowlist, no fulfillment record. | S2 |
| 5b | §5.4 Distributor fulfillment state machine (`awaiting_stock` → … → `delivered`, `exception`) | Absent. No table, no states, no commands. | S2 |
| 5c | §5.7 automatic tagging: RM auto-tagged on every in-scope regional deal; ISR auto-tagged from Sourced; PAM + KAM added atomically on `Testing → Qualified` | `deal_participants` table exists; `participant-commands.server.ts` provides manual add/remove. No automatic tagging engine, no `Testing → Qualified` handoff logic (§9.11). | **S1** |
| 5d | §5.7 Coverage Exception: entity, 4-state machine, queue, SLA, blocks the protected Deal action | Entirely absent — no table, no states, no queue. Missing PAM/KAM coverage therefore silently does nothing instead of blocking. | **S1** |
| 5e | §5.5 permission matrix: 43 capabilities × 9 roles with G/S/T/O/A semantics | `role_permissions` (`db/schema.sql:1485`) is a flat `role × feature` CRUD boolean grid. It has no scope semantics (global vs. assignment-scope vs. tagged-only vs. own vs. approval authority), so `T` (tagged-only) and `A` (approval) can't be expressed. | S2 |
| 5f | §5.5: *"Field-level policy may be stricter than page access"* | No field-level policy layer exists. | S2 |
| 5g | §5.9 offboarding: reassignment queue, temporary ownership, permanent-reassignment confirmation, task/approval/ticket/saved-view reassignment | None. Only session revocation exists — and it is dead code (§2.6 item 3). | S2 |
| 5h | §5.10 authorisation administration: role/context simulation preview, versioned effective-dated policy, impact preview, bulk-change reason + result report, emergency time-limited access | None. `admin.roles.tsx` writes permission rows directly with no versioning, preview, or audit. | S2 |
| 5i | §5.1: Partner/Customer geography as effective-dated **many-to-many** coverage relationships | `portal_customers.country` / `.region` are single TEXT columns (`db/schema.sql:359-361`); partner coverage is not modelled. Province/State is not stored on either. | S2 |

---

## 5. Chapter 6 — Authentication, onboarding, profiles, teams

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 6a | §6.3: 13 partner lifecycle states | `PARTNER_LIFECYCLE_STATUSES` (`taxonomy.ts:47`) has 9. Missing `email_unverified`, `profile_incomplete`, `draft`, `suspended`, `offboarded`. `need_more_info` is used where the canonical key is `changes_requested`; `pending_agreement` where canonical is `agreement_pending`. There is no way to suspend or offboard a partner. | S2 |
| 6b | §6.3: every listed transition, with actor/guard/side-effect, and *"all unlisted transition pairs and direct status-field updates are rejected"* | `admin.partners.tsx:323` does `.update({ partner_status: decision })` — a direct status-field write with no transition table, no guard, no side effects, and no state machine. | **S1** |
| 6c | §6.6: *"Approvers cannot approve their own prospective Partner application without a second authorised reviewer."* | No maker/checker check anywhere. | S2 |
| 6d | §6.6: duplicate company / domain / tax ID / relationship-assignment warnings in the approval queue; PAM/RM assignment recommendations | Absent from `admin.partners.tsx`. | S3 |
| 6e | §6.7: credential status must be shown as Invited / Delivered / Opened / Activated / Expired / Revoked; resend invalidates earlier secrets | `issueTemporaryPasswordForUser` (`livey-service.server.ts:1755`) sets `must_reset_password`. No credential-status model, no expiry, no resend invalidation. | S3 |
| 6f | §6.8: Profile must contain assignments/contexts, security, notification + digest preferences, accessibility preferences, locale/timezone/reference currency, active sessions, trusted devices, deactivation path. *"Password change and security controls appear in Profile, not in a disconnected export settings area."* | `settings.tsx` is titled **"Export hub"** with a password card bolted on at line 254. None of the other Profile sections exist. This is the exact anti-pattern §6.8 calls out. | S2 |
| 6g | §6.9: team invitation must capture partner role, job title, responsibility, **Region/Country/Province assignment**, start/end date, manager, permission preview; a Partner Admin can grant only at or below their own authority | `partner.team.tsx` invites by name/email/role. No geography assignment, no manager, no permission preview, no authority-ceiling check. This is the "country selector while inviting team and country-based RBAC" item from the source notes. | **S1** |
| 6h | §6.2: sequence step 2–3 — email verification gates onboarding | See §2.9. | **S1** |
| 6i | §6.5: Section 23.3 is the *sole* registry for Business Type / Years in Business / Annual Turnover / Employee Count / Business Focus; forms store stable keys and reject retired keys | `partner.onboarding.tsx` reads `partner-onboarding-lookups.ts`. Needs verification that these are the §23.3 keys and that retired keys are rejected; there is no key-version snapshot on submitted revisions. | S3 |
| 6j | §6.4: application **revisions** — Draft freezes a revision on submit, Changes Requested unlocks only requested fields, prior revision is locked | Onboarding writes fields straight onto the `partners` row. No revision model, no field-level unlock. | S2 |

Correct today: the 5-step onboarding wizard structure (`partner.onboarding.tsx:45`) matches
§6.4's sections, and it autosaves.

---

## 6. Chapter 7 — Navigation and dashboards

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 7a | §7.3–§7.11: nine distinct role dashboards with named cards and panels | One dashboard (`dashboard.tsx`) with a super-admin/partner-admin branch (`:88`, `:228`). No RM, PAM, KAM, ISR, Support, or Distributor dashboard. | S2 |
| 7b | §7.2: *"independently scrollable News and Activity tabs"* | `dashboard.tsx:491` renders a News feed card only. There is no Activity tab. (This is the "separate news feed and activity feed" item from the source notes.) | S2 |
| 7c | §7.1: navigation *"assembled from authorised capabilities and active context"*; 7 named groups | `app-sidebar.tsx:47-84` is 4 hardcoded arrays filtered by role key. Missing entirely: Leads/Auto CRM, News, Activity, Certifications, Shipments, Won Reviews, Geography & Reference Data, Pricing & Discount Policy, Partner Performance, Help. | S2 |
| 7d | §7.2: 4–6 clickable KPI cards, data-freshness indicator, sticky Profile/Quick-Actions rail, assistant suggestions grounded in visible data | KPI cards are clickable (`dashboard.tsx:466`) and the rail is sticky (`:541`) — **done**. No freshness indicator; no grounded assistant suggestions. | S3 |
| 7e | §7.9: Distributor dashboard *"never reveals totals or counts from untagged records"* | No Distributor dashboard. | S2 |
| 7f | §7.3: `"Your Standing"` and `"My Redemptions"` must not appear for Super Admin | Needs confirmation in `admin.rewards.tsx`; the separate `/rewards` route is hidden from super_admin (`app-sidebar.tsx:164`), which covers the main case. | S3 |

---

## 7. Chapter 8 — Partners, Customers, Contacts

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 8a | §8.4: a Contact is a first-class entity; *"records link to a Contact ID rather than copy a free-form POC name"*; fields include WhatsApp eligibility, consent, preferred channel, timezone | **No Contact table exists.** `portal_deals.contact_name` is TEXT (`db/schema.sql:312`); `poc_profile_id` points at `profiles`, i.e. portal users, not customer contacts. The canonical POC field set (Name / Job Title / Email / Phone / Preferred Channel) is not stored. | S2 |
| 8b | §8.1: Partner detail tabs — Summary, Company, Team, Coverage, Agreements & Documents, Deals, Customers, Learning, Rewards, Support, Activity, Audit | `partner.tsx` is a single company-profile page. No tabbed partner record. | S2 |
| 8c | §8.3: Customer needs service locations, industry, account health, assigned KAM and RM, originating Partner, Zoho Books identity | `portal_customers` has `health_score`, `segment`, `account_owner` (TEXT). No KAM/RM assignment, no service locations, no province/state. | S2 |
| 8d | §8.5: saving a next step timestamps Activity, optionally creates a Task, identifies assignee, records due date + timezone, and notifies typed participants | `portal_customer_activities` (`db/schema.sql:385`) stores `summary` + `next_step` only. No task creation, no assignee, no due date, no notification. | S2 |
| 8e | §8.7: `dealParticipant.addDistributor` / `removeDistributor` and the two Customer participant commands, with safe-field preview, reason, effective dates, work transfer, and queued-notification cancellation | `participant-commands.server.ts` provides generic add/remove. No Distributor-specific commands, no safe-field preview, no work-transfer step. Customer↔Deal participant independence is not enforced. | S2 |
| 8f | §8.6: duplicate detection on 8 governed signals; merge preserves external IDs and redirects old links | **Largely done** — `src/lib/customer-governance.ts`, `customer_merge_events` table, merge UI in `customers.tsx`. Gap: detection does not cover Zoho Books identifier or address similarity, and there is no cross-scope merge prohibition. | S3 |

---

## 8. Chapter 9 — Deals, pricing, approvals, pipeline

Beyond the S1 items in §2.2, §2.3:

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 9a | §9.1/§9.2: three **separate** dimensions — `registration_status`, `pipeline_stage`, `outcome_review_status`. *"These dimensions must not be collapsed into one ambiguous `status` or `stage` field."* | `portal_deals` has `stage` TEXT + `status` TEXT + a `commercial_approved` boolean (`db/schema.sql:318-319,334`). Registration status and outcome review status are not columns. `deal_outcome_reviews` is a separate table with a non-canonical status vocabulary. | **S1** |
| 9b | §9.3 Section 2: full line-item model with catalogue price version, tier adjustment, PTP, DTP, proposed selling price, UoM, line totals | `deal-line-items.tsx:11` — `useState<any[]>([])` with the comment *"In a real implementation this would be fetched from DB"*. The list is **always empty**. `handleAdd` (`:20`) posts `productId: "dummy-product"`, `msrpUsd: 1000`, `ptpUsd: 800`, `dtpUsd: 800`, `proposedSellingPriceUsd: 900` — hardcoded. Delete is a no-op. | **S1** |
| 9c | §9.5 pricing formulas, fixed-point decimal, half-up to 2dp; commercial floor `Proposed ≥ DTP` blocks progression | `src/lib/pricing-domain.ts` implements formulas and is tested, but nothing in the UI or the deal commands enforces the floor or recomputes totals from lines. `portal_deals.amount` remains a TEXT field parsed by `parseDealAmount`. | **S1** |
| 9d | §9.5/§9.7: registration threshold on PTP total; USD 5,000.00 auto-approves, 5,000.01 requires review; Working Pricing Draft → immutable Pricing Revision; `superseded_by_revision_id`; the 7×2 reprice result matrix | `requiresSuperAdminApproval` exists in `portal-records.ts` and `submitDealForRegistration` exists, but there is no Working Draft / immutable Revision distinction, no `superseded_by_revision_id`, no Registration Decision record, and no reprice matrix. `pricing_revisions` (`db/schema.sql:1339`) has `revision_number` + totals only. | **S1** |
| 9e | §9.7: registration lifecycle contract — 8 commands including **Cancel registration** and **Reopen registration** | Only `submitDealForRegistration`. No approve/request-changes/reject/begin-revision/cancel/reopen commands. Registration decisions are not recorded with reason codes. | S2 |
| 9f | §9.8: minimum forward requirements per stage (demo task + outcome, test plan + technical contact, customer budget, price snapshot, discount approval, proposal document…) | Only one check exists: `pipeline.tsx:237` requires `customer_budget` before Qualified. No stage exit/entry criteria in the domain command. | **S1** |
| 9g | §9.8: probability override restricted to 0/25/50/100 with a reason, recorded in Activity | `deal-probability-select.tsx` exists but is **not rendered anywhere** (0 usages in routes). `portal_deals.probability` is a free INTEGER. | S2 |
| 9h | §9.10: backward movement dialog requires destination stage, **reason category**, explanation, treatment of stage tasks, treatment of approved discount snapshots, notification preview | `moveDealStageBackward` (`deal-commands.server.ts:378`) requires a non-empty free-text reason — good — but there is no reason **category**, no task treatment, no supersession of proposals/approvals, and no notification preview. | S2 |
| 9i | §9.11 post-Testing handoff (7 steps, atomic PAM+KAM add, Coverage Exception on failure) | Absent — see §5c/§5d. | **S1** |
| 9j | §9.12 discount workflow: fields hidden before Proposal; request → PAM/RM/Super Admin decision; snapshot approver + policy version + percentage + DTP + reason; revised requests supersede; Proposal cannot advance with an unresolved decision; Super Admin discount policy (max per role, auto-approval bands, floor, escalation, effective dates) | **Entirely absent.** `deal_line_items.discount_pct` exists as a column; there is no request, no approval, no policy, no gating. This is the source note *"when deal is moved to testing to proposal, then discount is added"* and *"Discounted Transfer Price after proposal stage"*. | **S1** |
| 9k | §9.13 pipeline card must show Partner, Customer, POC, product/line/quantity summary, stage-specific value label, probability, next task + due state, next-task assignee, RM/ISR/PAM/KAM chips, registration/outcome indicator, participant avatars, stale/blocked indicator | Card shows account name + amount always; owner/region/product/probability on hover. None of the rest exists. Won/Lost column colouring (§9.13: Won green, Lost red) is not applied. | S2 |
| 9l | §9.13 board controls: 17 named filters + saved views + visible-queue export; no free-text search | `pipeline.tsx` has region + stage filter + a search box. Missing: country, province, partner, partner user, customer, product, registration status, outcome status, participant, task state, close-date range, value range, probability, saved views. | S2 |
| 9m | §9.14 deal detail tabs: Overview, Products & Pricing, Participants, Tasks, Documents, Activity, Approvals, Rewards, Accounting, Shipment | `deals.tsx` renders one long sheet. No Approvals, Rewards, Accounting, or Shipment surface. The "eye icon beside Notes/Activity" with filterable timeline (§9.14, and an explicit source-note item) does not exist. | S2 |
| 9n | §9.15 Won/Lost: Lost available only from Negotiation with a loss reason; Won requires outcome date + PO Upload Now / Submit Later + confirmed final lines + contributor split | `markDealLost` (`deal-commands.server.ts:412`) accepts an **optional** reason and can fire from any non-terminal stage. `markDealWon` takes no outcome date, no PO choice, no contributor confirmation. `deal-outcome-review.tsx:57` hardcodes `const reason = "Admin action"` for approve/reject decisions, and takes the PO document as a **URL text field** rather than an upload. | **S1** |
| 9o | §9.15 outcome review state machine (6 states, 11 transitions) | `deal_outcome_reviews.status` uses `not_applicable` / `requested` / `received` / `approved` / `rejected` (`outcome-review-commands.server.ts:50,96,126,151`) — none of the canonical keys, and no transition guard table. | S2 |
| 9p | §9.16 deal documents: version, scan result, hash, expiry, approval status, expiring signed URLs; *"PO upload is available only for a Deal in Won or an explicitly authorised review state"* | `deal_documents` (`db/schema.sql:284`) has no version, hash, scan result, or approval status. `createDocumentDataUrl` (`livey-service.server.ts:1864`) returns a **data URL**, not an expiring signed URL — the whole file is inlined and cannot be revoked. No malware scanning anywhere. | **S1** |
| 9q | §9.18 imports: template download, dry-run preview, registration-outcome preview, row-level results, all-or-nothing mode, audit | `src/lib/deal-import.ts` + `bulk-import.ts` exist with row validation. No template download, no dry-run preview stage, no registration preview, no rollback strategy. | S3 |
| 9r | §9.4 catalogue: effective-dated MSRP and Base PTP in USD, tier adjustments, discount policy, reward eligibility, Zoho Books item ID, shipment attributes; *"Prices are numeric decimal values, not currency-formatted strings"* | `portal_catalog_items.list_price` and `.margin` are **TEXT** (`db/schema.sql:581-582`). No effective dating, no Base PTP, no tier adjustment table, no reward-eligibility flag, no Books item ID. | S2 |
| 9s | §9.4 partner tiers Registered/Silver/Gold/Platinum with effective-dated PTP adjustment | `portal_catalog_items.partner_tier` is a per-item TEXT column. No tier policy, no tier history, no PTP adjustment. | S2 |
| 9t | §9.6: local currency is display-only with rate/provider/timestamp, labelled "Reference only" | FX snapshot columns exist on `portal_deals` and `fx-rates.server.ts` fetches rates — partly done. Not verified that the UI labels them "Reference only" or that they are excluded from thresholds. | S3 |

---

## 9. Chapter 10 — Tasks

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 10a | §10.1: Task must carry human-readable Task ID, structured type, watchers, active context, **multiple** related records, timezone, start date, recurrence rule, dependencies, checklist, blocking-stage indicator, completion evidence, automation source/template | `tasks` (`db/schema.sql:1432`) has title, description, status, priority, one `related_type`/`related_id` pair, assignee, creator, partner, `due_at`, `blocked_reason`. Everything else is missing. §10.7 explicitly requires *"A Task can relate to several records without duplicating the Task."* | S2 |
| 10b | §10.4: stage templates that create required/optional tasks, assign by participant role, compute due dates from stage entry, require evidence, **block transitions**, and cancel/retain/reopen on backward movement; versioned templates | Entirely absent. No template table, no stage→task automation, no transition blocking. This is the source note *"task module integrated to pipeline and deals"*. | S2 |
| 10c | §10.5: assignee must have access to every related record; out-of-scope assignment rejected; internal vs. partner-visible descriptions separated | No scope validation on assignment; one `description` field. | S2 |
| 10d | §10.6: reminders, escalation by configurable role path, dedupe, offboarding reassignment | None. | S2 |
| 10e | §10.3: My Tasks views — Today / Upcoming / Overdue / Blocked / Assigned by Me / Completed, saved views, calendar and board presentations | `tasks.tsx` (449 lines) is a single list. | S3 |
| 10f | §23.4 task keys `todo`/`in_progress`/`blocked`/`completed`/`cancelled` | `taxonomy.ts:101` adds `draft`, `queued`, `open`, `waiting`; the table default is `'to_do'` (underscore). Three vocabularies in play. | S3 |

Correct today: `task-commands.server.ts` implements guarded transitions with an append-only
`task_transitions` log and writes `domain_activity_events`.

---

## 10. Chapter 11 — News, Activity, Notifications

Beyond §2.4, §2.5, §2.8:

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 11a | §11.2: News post needs summary, body, author, publisher role, **publication status**, publication + expiry timestamps, pinned/priority, **audience expression**, digest behaviour, acknowledgement requirement, revisions, analytics | `portal_news_posts` (`db/schema.sql:771`) has title, caption, image path, alt text, poster name/role. No status, no scheduling, no expiry, no audience, no revisions. Every post is global. | S2 |
| 11b | §11.2 audience dimensions: Global / Region / Country / Province / Partner / Customer / team domain / role / user / tier / cohort, with server-side expansion and a pre-publication audience estimate | Absent. This is the source note *"feed targeting based on region, partner, user, partner admin"*. | S2 |
| 11c | §11.2 News lifecycle contract (Draft → Scheduled → Published → Expired → Archived) | Absent — posts are created published. | S2 |
| 11d | §11.4: separate News and Activity tabs, each independently scrollable with structured filters, unread state, deep links | Only a News card on the dashboard. | S2 |
| 11e | §11.6 notification centre: category and status filters, Mark All **Visible** Read, deep links, context labels, mandatory/critical indicator, preferences link | `notifications.tsx` (183 lines) lists rows and has "Mark all as read" that updates every unread row regardless of visible scope (`:80`). No categories, no deep links, no context labels. | S3 |
| 11f | §11.7 digest preferences: channel toggles, daily/weekly schedule, timezone, permitted categories, quiet days, language | No preference model at all. | S2 |
| 11g | §11.8 delivery state machine (9 states) with retries, backoff, idempotency, signature-validated provider callbacks | Absent. | S2 |

---

## 11. Chapter 12 — Assistant, website/WhatsApp, Auto CRM

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 12a | §12.2: 11 Assistant capabilities — explain screens/fields/roles, answer product & pricing-policy & training questions, retrieve Deals/Customers/Partners/Tasks/Tickets/courses/rewards/shipments/News/Activity, compare metrics, **convert requests into visible structured filters**, summarise records, draft Deal/Lead/Customer/Contact/Task/Ticket/note/News, suggest next actions, navigate, explain access denials | `assistant.server.ts:27` restricts the Assistant to exactly two intents: `create_deal_draft` and `list_deals`. Everything else returns a refusal. Since §2.1.6 makes the Assistant the **replacement** for the removed search bars, this is the load-bearing gap behind gap 4a. | S2 |
| 12b | §12.1: contextual suggestions based on the current page; optional speech input / read-aloud, independently disableable | Neither. | S3 |
| 12c | §12.5 website business assistant (public FAQs, product discovery, lead qualification, consent capture, callback request, human handoff) | Does not exist. | S2 |
| 12d | §12.6 / §17.6 WhatsApp business workflow (Cloud API, templates, webhooks, consent, session rules, identity matching, handoff) | Does not exist. No adapter, no webhook route, no consent model. | S2 |
| 12e | §12.7–§12.11 **Auto CRM**: Lead entity, 10-state lifecycle with 25 guarded transitions, capture fields, deduplication, enrichment, explainable scoring, 7-level routing order, claim, structured conversion preview, human handoff | **The entire module is absent.** No `leads` table, no route, no navigation entry. The only trace is `LEAD_STATE_MACHINE` in `state-machine.ts:320` with 5 non-canonical states (`new`/`contacted`/`qualified`/`converted`/`disqualified`) that nothing consumes. | S2 |
| 12f | §12.3: consequential actions execute *"through the same authorised domain service used by the UI"*, with re-authentication for high-risk actions | Deal creation does route through `createDeal` — **correct**. No re-authentication tier exists. | S3 |
| 12g | §12.4: prompt-injection resistance; assistant logs separate user text, retrieved sources, proposed action, confirmation, execution result, and policy decision | `assistant_messages` (`db/schema.sql:1304`) records `proposed_action`, `action_payload`, `retrieved_deal_ids`, `confirmed`, `outcome` — reasonable. No explicit injection-resistance test coverage. | S3 |

---

## 12. Chapter 13 — Support and ticketing

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 13a | §13.1: human-readable ticket number `LIV-SUP-YYYY-######`, generated atomically, unique, never reused | No number column at all (`db/schema.sql:1247`). §13.10 lists this first. Explicit source-note item. | S2 |
| 13b | §13.1: Customer, active context, category, severity, SLA policy + timestamps, related Deals/Tasks/Shipments/certificates | `support_tickets` has partner, creator, subject, description, status, priority, `assignee_name` (TEXT), plus single `product_sku`/`serial_number` columns added by `ticket-commands`. No customer, category, severity, SLA, or relations. | S2 |
| 13c | §13.2/§13.3: **one or more product rows**, zero-or-more serials per product, quantity affected, warranty status, symptom, **multiple images and documents** with preview, size/type validation, malware scan | One product + one serial, no attachments at all. This is the source note *"multiple products and serial numbers and option to add images"*. | S2 |
| 13d | §13.4/§23.4: canonical states `open` / `in_progress` / `waiting_on_partner` / `reopen_requested` / `closed` | `taxonomy.ts:113` has 8 states including non-canonical `triaged`, `waiting_on_livey`, `resolved`, `reopened`, `canceled`. `ticket-commands.server.ts:35` defines a *third*, different list. §13.4 explicitly says `Reopened` is an Activity event, not a state. | S3 |
| 13e | §13.5: partner requester submits a **reopen request**; Support/Super Admin approves or rejects with reason | `reopen_requested` appears in the command module's status list but there is no request submission, decision, or reason capture in the UI. Explicit source-note item. | S2 |
| 13f | §13.6: partner-visible vs. internal note classification; edit window with retained original | `support_ticket_comments` (`db/schema.sql:1262`) has no visibility flag. **Internal notes cannot be kept internal** — §13.10 requires "Internal notes never leak to Partner users." | **S1** |
| 13g | §13.7: SLA policy by severity/tier/product/country/entitlement/business hours; 9 tracked timestamps; time-remaining, pause, breach-risk, breach, escalation owner; effective-dated and snapshotted | Entirely absent. §13.10 requires SLA to be measurable and auditable. | S2 |
| 13h | §13.8: two-pane list/detail on large screens, product/serial panel, Activity + SLA timeline, close and reopen-review dialogs, no search bar | `support.tsx` is a single list with a search box (`:392`). | S3 |
| 13i | §13.9: notify requester + assigned/tagged Support + watchers + escalation participants on 8 event types | No ticket notifications. | S2 |

Correct today: `ticket-commands.server.ts` enforces a transition allowlist, writes
`domain_activity_events`, and correctly returns `waiting_on_partner → in_progress` when the
partner replies (`:483`).

---

## 13. Chapter 14 — Insight Hub

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 14a | §14.2: three tracks (Sales / Technical / Solution); Technical uses `Track → Subject → Lesson` where **series are Subjects and products are Lessons**; Sales/Solution use `Track → Course → optional Module → Lesson` | `learning_tracks` / `learning_subjects` / `learning_courses` / `learning_lessons` exist (`db/schema.sql:1371-1414`) but there is no track-type distinction, no Module level, and no product↔lesson mapping. `insight-hub.tsx` renders tracks and subject titles only — lessons are never opened. | S2 |
| 14b | §14.3: Lesson needs objective, content type, **video + transcript**, text content, downloadable resources, duration, prerequisites, required/optional, completion rule, product/series mapping, audience, version + effective dates | None of these columns exist. There is no video hosting, no resource storage, and no content versioning. | S2 |
| 14c | §14.4: audience targeting and learning **assignments** with due date, required flag, assigned version, prerequisite and reminder policy | Absent. `learning_enrollments` has `status` + `progress_percent` only. | S2 |
| 14d | §14.5: 10 progress states with a guarded transition table; progress stored **per content version**; video completion cannot rely on opening a page | Absent. | S2 |
| 14e | §14.6 **Assessment**: question bank, randomisation, inclusive 80% pass boundary, 3 attempts (2 immediate, 3rd after 24h cooldown), policy snapshot on enrolment, per-attempt storage of version/questions/score/timestamp, accessibility alternatives | **Entirely absent** — no assessment, question, or attempt tables. §14.10 makes the 80%/79% boundary an acceptance criterion. | S2 |
| 14f | §14.7 **Certificate**: number, learner + affiliation snapshot, course/version, issue + expiry, issuer, QR/verification URL, verification hash, PDF; 4-state status machine; public verification that never exposes profile data | **Entirely absent.** `insight-hub.tsx:303` shows a "View certificate" button that does nothing. | S2 |
| 14g | §14.9 administration: preview, version, publish, retire, transcript/caption validation, question authoring, bulk assignment, certificate templates, completion/score/attempt/overdue analytics | `admin.learning.tsx` does CRUD on tracks/subjects/courses/lessons only. | S2 |
| 14h | §14.8: filters by Track/Subject/Product/Role/Required/Progress/Certificate status/duration; no search bar | No filters. | S3 |

---

## 14. Chapter 15 — Rewards

Covered as S1 in §2.3. Remaining items:

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 15a | §15.5: partner tier policy with qualification measures, evaluation period, effective date, review/exception process, catalogue PTP adjustment, benefits; tier changes create Activity and never retroactively reprice | No tier policy or tier history. | S2 |
| 15b | §15.6 Reward Store: available **and reserved** points, categories, brands, delivery type, eligibility, Terms, My Redemptions, points history; structured filters, no search | `rewards.tsx` shows a catalogue with a search box (`:376`). No reserved-points concept, no delivery type, no eligibility rules, no Terms. | S3 |
| 15c | §15.7: 8-state redemption machine with atomic reservation and revalidation at approval/fulfilment | `reward_redemptions.status` defaults to `'requested'` and is updated directly. `REWARD_STATUSES` (`taxonomy.ts:139`) has 5 non-canonical values. | S2 |
| 15d | §15.8 / §17.8 GyFTR / QuickSilver: catalogue sync, denominations, voucher order, provider transaction ID, reconciliation, refund handling; codes encrypted separately, masked, excluded from logs/exports/analytics/assistant, reveal-audited | Entirely absent. | S2 |
| 15e | §15.9: physical gadget catalogue with inventory, country eligibility, shipping requirement, active dates, fulfilment task assignee | `reward_catalog_items` has category/points/stock/availability only. | S3 |
| 15f | §15.10: Super Admin Rewards Manager — clickable statistics, catalogue import with preview, redemption queue, **points-rate policy**, manual adjustment with reason + approval policy, provider health, inventory, exports | `admin.rewards.tsx` has catalogue CRUD and a redemption list. No points-rate policy (the core "how to assign redemption points" question from the source notes), no import preview, no provider health. | S2 |

---

## 15. Chapter 16 — Analytics, imports, exports, settings

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 16a | §16.1: 15 required report groups | `analytics.tsx` loads deals, customers, and catalogue items only — roughly pipeline, stage mix, and product mix. Missing: partner funnel, stage conversion + time in stage, win/loss reasons, pricing waterfall + discount, regional performance, partner/user contribution, task productivity, News reach, support SLA, learning completion, points liability, Auto CRM funnel, integration/shipment performance. | S2 |
| 16b | §16.1: *"All statistics cards and chart segments that represent records are clickable"* | Dashboard KPI cards are (`dashboard.tsx:466`). Analytics cards are not. | S3 |
| 16c | §16.2: exports include generated timestamp, actor, scope, filters, and data freshness; are audited; expire when delivered by link; run async for large data; PDF for governed reports | CSV/XLSX are generated client-side with no header metadata, no audit event, no async path, no PDF. | S3 |
| 16d | §16.3: every import provides template download → schema validation → parsing → governed-value + permission validation → duplicate resolution → **dry-run preview** → confirm → row-level result → audit and rollback | Import helpers exist for deals, customers, users, and teams with row validation and feedback (`src/lib/*-import.ts`, `import-feedback.tsx`). Missing across all of them: template download, dry-run preview, permission validation, rollback strategy. No import at all for product/combo catalogue, price books, reward catalogue, or learning content. | S3 |
| 16e | §16.4: *"Partner-facing Settings do not include: Partner Documents export; Governance exports; Configuration exports"* — and *"Module exports remain on their relevant module pages"* | `settings.tsx` **is** the export hub, and `export-registry.ts:276` marks the `partner-documents` dataset `visibleTo: ALL_ROLES`. This is a direct violation, and an explicit source-note item ("remove Partner documents, Governance exports, Configuration exports"). | **S1** |
| 16f | §16.4 Super Admin settings: hierarchy and governed values, approval thresholds, stages and task templates, price books, point rate, support SLA, News governance, security/retention, export governance | None of these settings surfaces exist. | S2 |
| 16g | §16.5: effective-dated versioned policy changes, impact preview, dual approval for security/points/price policy, durable bulk-action reports, *"configuration cannot delete a value referenced by history; it is retired"* | `lookup_values` has `retired_at` and versioning columns — partial. No impact preview, no dual approval, no bulk reports. | S2 |

---

## 16. Chapter 17 — External integrations

Covered as S1 in §2.7. Provider-by-provider:

| Provider | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| Zoho Sign (§17.4) | Agreement record with source + signed checksum, 9-state machine, one active request per revision, resend/replace semantics, provider-status resync, duplicate-completion safety, short-lived authorised download links | `zoho-api.server.ts` + `zoho_sign_tokens` + `partners.agreement_*` columns implement a send-and-poll flow. No Agreement entity, no state machine, no checksums, no resync, no duplicate-webhook guard, and the webhook handler bypasses table policy (§2.6 item 1). | S2 |
| Zoho Books (§17.5) | Field-by-field source-of-truth contract across 10 object families, outbound prerequisites, contact sync with duplicate matching, sales-order/invoice mapping from the frozen pricing revision, inbound financial timeline on the deal, conflict + reconciliation rules | **Nothing.** No adapter, no external links, no financial panel. `portal_customers.provider_customer_id` is an unused column. | S2 |
| WhatsApp (§17.6) | Cloud API adapter, signature verification, consent, templates, digests, handoff | **Nothing.** | S2 |
| Email (§17.7) | Versioned templates, locale, subject/field allowlist, delivery ID, reauthorising deep links, bounce/complaint/suppression tracking, inbound reply routing | **Nothing** — see §2.5. | **S1** |
| GyFTR (§17.8) | Catalogue mapping by provider ID, voucher order idempotency, encrypted codes, reveal audit | **Nothing.** | S2 |
| DHL India (§17.9) | Shipment entity, creation prerequisites, 11-state normalised lifecycle, immutable tracking events, labels/manifests as protected attachments, pickup idempotency, exception → alert + task | **Nothing.** `SHIPMENT_STATUSES` in `taxonomy.ts:157` has 6 non-canonical values and no consumer. | S2 |

---

## 17. Chapter 18 — Canonical data model

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 18a | §18.1: one canonical data model and one set of domain commands across UI, assistant, imports, APIs, jobs, and integrations | Two parallel models coexist. The governed model (`governed_tenants`, `geography_nodes`, `assignments`, `active_contexts`, `products`/`price_books`/`price_rows`, `deal_line_items`, `pricing_revisions`) is largely unread by the UI. The UI runs on the legacy portal model (`portal_deals`, `portal_customers`, `portal_catalog_items`) with free-text names and TEXT prices. | S2 |
| 18b | Schema hygiene | **`products`, `product_variants`, `product_skus`, `combos`, `combo_components`, `price_books`, `price_rows`, and `fx_snapshots` are each defined twice** in `db/schema.sql` — first at lines 444–575, then again with different columns at lines 599–739. Because both use `CREATE TABLE IF NOT EXISTS`, the second definition is silently discarded on a fresh database and never applied to an existing one. Whichever set the code eventually reads, half of it will be wrong. No source file references any of these tables today, which is why the bug has not surfaced. | **S1** |
| 18c | §18.5 domain command contract; §18.6 read models; §18.7 file/attachment model; §18.8 Audit vs. Activity separation | Command envelope and outbox/inbox contracts exist in `src/domain/contracts/commands.ts` and are used by the deal/task/ticket/user-role modules — genuinely good. But `portal_audit_events` (`db/schema.sql:757`) stores free-text `actor_name`/`details` with no structured before/after, so §18.8's "security audit retains structured before/after data" is unmet. | S2 |
| 18d | §18.4 common data invariants; §18.9 time, versioning, history | Optimistic concurrency (`version` + `expectedVersion`) is implemented on deals, tasks, tickets, and outcome reviews — good. No temporal/as-of query support for §9.5's "historical metrics use the revision effective at the event time". | S3 |

---

## 18. Chapter 19 — Security, privacy, reliability, performance

| # | Spec | Shipped | Sev |
| --- | --- | --- | --- |
| 19a | §19.2 session security: MFA, rate limits, device signals, security events | None — see §2.9. | **S1** |
| 19b | §19.3 authorisation and tenant isolation | Partially enforced; see §2.6. | **S1** |
| 19c | §19.4 Assistant/AI security | Assistant retrieval is server-side and capability-checked (`assistant.server.ts:306`) — good within its narrow scope. | S3 |
| 19d | §19.5 data protection and encryption | No field-level encryption; no separate key management for secrets (voucher codes, provider tokens). `zoho_sign_tokens` stores tokens in plaintext columns. | S2 |
| 19e | §19.6/§19.7 privacy, consent, data rights, retention and deletion | No consent model, no retention policy, no deletion workflow, no data-subject request path. | S2 |
| 19f | §19.8 auditability and non-repudiation | `portal_audit_events` is free-text and written from the browser via `recordAuditEvent` — client-supplied actor/role/details, so it is not non-repudiable. | **S1** |
| 19g | §19.9 abuse prevention and rate limits | None. | S2 |
| 19h | §19.10–§19.12 reliability, backup/recovery, observability | No worker/retry infrastructure (outbox is never drained), no documented backup/restore, no metrics/tracing beyond correlation IDs in the command contract. | S2 |
| 19i | §19.13 performance and scale | No pagination or virtualisation on any list; `analytics.tsx:52` does `select("*")` over all deals and customers, then filters client-side. | S2 |
| 19j | §19.14/§19.15 accessibility and responsive/offline states | See gap 4b/4h. `route-placeholder.tsx` provides Access Denied; no offline, stale, or permission-denied states elsewhere. | S3 |

---

## 19. Chapter 23 — Canonical dictionary divergence

`product.md` §23.4 is the *sole* machine-key registry. `src/domain/contracts/taxonomy.ts`
disagrees with it in 10 of 16 dictionaries. Because §23.9 makes these keys the blueprint
authority, every one of these is a rename or migration, not a preference.

| Dictionary | §23.4 canonical keys | `taxonomy.ts` | Verdict |
| --- | --- | --- | --- |
| Assignment status | scheduled, active, suspended, ended, revoked | identical (`:37`) | ✅ |
| Deal pipeline | sourced…won, lost (8) | identical (`:60`) | ✅ |
| Partner lifecycle | 13 keys | 9, different spellings (`:47`) | ❌ |
| Deal registration | draft, submitted_for_review, auto_approved, approved, changes_requested, rejected, cancelled | draft, submitted, under_review, approved, rejected, need_more_info (`:71`) | ❌ |
| Deal outcome review | not_applicable, po_pending, under_livey_review, changes_requested, approved_won, rejected_outcome | `PO_REVIEW_STATUSES` = not_required, requested, received, verified, rejected, closed (`:91`) | ❌ |
| Task | todo, in_progress, blocked, completed, cancelled | 8 keys incl. draft/queued/open/waiting (`:101`) | ❌ |
| Ticket | open, in_progress, waiting_on_partner, closed, reopen_requested | 8 keys incl. triaged/waiting_on_livey/resolved/reopened/canceled (`:113`) | ❌ |
| Lead / Auto CRM | 10 keys | 5 keys (`:127`) | ❌ |
| Learning progress | 10 keys | absent (`LEARNING_STATUSES` = draft/published/archived, a *content* status) | ❌ |
| Certificate status | active, expired, revoked, superseded | absent | ❌ |
| News | draft, scheduled, published, expired, archived | absent | ❌ |
| External delivery | 9 keys | absent | ❌ |
| Agreement status | draft, queued, sent, delivered, viewed, signed, declined, expired, cancelled | draft, sent, signed, pending_review, active, expired, canceled (`:161`) | ❌ |
| Redemption | requested, points_reserved, pending_review, processing, fulfilled, failed, cancelled, refunded | `REWARD_STATUSES` = requested, approved, fulfilled, rejected, canceled (`:139`) | ❌ |
| Shipment | 11 keys | 6 keys (`:157`) | ❌ |
| Coverage Exception | open, in_remediation, resolved, cancelled | absent | ❌ |

Also divergent: §3.1 defines participant types as creator/requester, assignee, RM, ISR, PAM,
KAM, Support, Distributor, Partner contributor, approval assignee, escalation owner, and
watcher. `PARTICIPANT_TYPES` (`taxonomy.ts:189`) is `primary_owner`, `collaborator`,
`approver`, `observer`, `support_contact` — which cannot express the role tags that §5.7's
auto-tagging and §5.8's notification routing depend on.

---

## 20. Suggested sequencing

The dependency order below follows the blueprint's own priorities (Hierarchy/RBAC → Deals →
Assistant/UX → Ticketing → Insight Hub/integrations) and puts the items that unblock the most
downstream work first.

1. **Unblock the internal team.** Widen `AppRole` to the nine canonical roles; replace
   `getPartnerAccessFlags`'s partner-status-driven gating with capability + assignment
   evaluation; make navigation capability-generated. Without this, nothing in §5, §7, §9's
   approval paths, or §13's queues can be tested at all. *(§2.1, 5e, 7a, 7c)*
2. **Close the policy layer.** Route document, export, import, assistant, webhook, and worker
   surfaces through `applyTablePolicy`; make it call `governance.ts`. Wire
   `revokeUserSessionsAndContexts`. Add Assignment lifecycle commands and the Active Context
   chooser. *(§2.6)*
3. **Fix the two live breakages.** Restore `negotiation → won` and de-duplicate the
   `products`/`price_books` table definitions before anything is built on them.
   *(§2.2, 18b)*
4. **Correct the reward invariant.** Gate awards on `outcome_review_status = approved_won`,
   compute the basis from the final Pricing Revision, and add reservation to redemption.
   *(§2.3)*
5. **Make the deal model canonical.** Split `stage`/`status` into the three dimensions, make
   line items real, implement Working Draft → immutable Pricing Revision, registration
   decisions, and the discount workflow. *(9a–9e, 9j)*
6. **Participants and notifications.** Implement auto-tagging, the `Testing → Qualified`
   handoff, Coverage Exceptions, then rewrite notification recipient resolution to run off
   active typed participants. *(5c, 5d, 9i, §2.4)*
7. **Delivery.** Add an email transport, the delivery state machine, and digest preferences;
   drain `command_outbox` with a real worker. *(§2.5, §2.7)*
8. **Then** the absent modules, in blueprint-priority order: Auto CRM (§12), ticketing
   completeness (§13), Insight Hub assessments and certificates (§14), Zoho Books, WhatsApp,
   GyFTR, and DHL (§17).

Independent of the above and cheap to land: remove the 14 search inputs (4a), un-hide the
pipeline card content (4b), delete or wire the dead controls (4c), replace the fabricated
activity timeline with a `domain_activity_events` query (§2.8), and move partner-document
export off the Settings page (16e).
