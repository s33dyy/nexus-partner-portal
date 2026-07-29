# LIVEY PAM CRM Blueprint

This repository treats the following as the canonical delivery sequence:

0. Product and data contracts
1. Hierarchy and RBAC foundation
2. Deals, pricing, pipeline, tasks, and rewards
3. Assistant, Auto CRM, feeds, dashboards, and UX refinement
4. Ticketing
5. Insight Hub
6. Provider expansion
7. Controlled general availability

## Non-Negotiable Platform Invariants

- User identity alone grants no business access.
- Access is granted by effective-dated Assignments.
- Active Context is server issued and contains exactly one Assignment plus zero or one narrowing Working Scope.
- Scope-sensitive rows carry a non-null tenant_id.
- Server-side policy is the authorisation boundary for reads, writes, exports, files, assistant retrieval, jobs, and webhooks.
- Named domain commands perform lifecycle changes.
- Money uses fixed-point decimal values with explicit ISO currency codes.
- Audit, activity, outbox, inbox, and other business facts are append-only.
- Files are quarantined and validated before they become available.
- Feature flags may deny or route server-side work; UI hiding is not a boundary.

## Phase 0 Foundation Scope

Phase 0 establishes:

- canonical terminology and stable keys;
- state-machine registries;
- governed reference data and seed rules;
- command, event, outbox, and inbox envelopes;
- feature-flag registry;
- traceability and observability scaffolding;
- read-only inventory tooling.

