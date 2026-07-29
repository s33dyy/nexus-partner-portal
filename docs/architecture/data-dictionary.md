# Canonical Data Dictionary

## Source Modules

- Roles, geography types, lifecycle states, document classes, ID namespaces, and event versions: `src/domain/contracts/taxonomy.ts`
- Fixed-point money DTOs and parsing: `src/domain/contracts/money.ts`
- State-machine registry: `src/domain/contracts/state-machine.ts`
- Governed reference-data registry and seeds: `src/domain/contracts/reference-data.ts`
- Command, outbox, inbox, and denial contracts: `src/domain/contracts/commands.ts`
- Feature-flag registry: `src/domain/contracts/feature-flags.ts`
- Correlation and log redaction helpers: `src/domain/contracts/telemetry.ts`

## Canonical Keys

- Role keys: `super_admin`, `rm`, `pam`, `kam`, `isr`, `livey_support`, `restricted_distributor`, `partner_admin`, `partner_user`
- Geography node types: `global`, `sales_region`, `country`, `province_state`
- Assignment statuses: `scheduled`, `active`, `suspended`, `ended`, `revoked`
- Partner lifecycle statuses: `pending_partner_registration`, `submitted`, `under_review`, `need_more_info`, `partial_approval`, `pending_agreement`, `signed_pending_review`, `approved`, `rejected`
- Deal stages: `sourced`, `demo`, `testing`, `qualified`, `proposal`, `negotiation`, `won`, `lost`
- Money currencies: `USD`, `INR`
- Document visibility: `public`, `internal`, `partner`, `account`, `private`

## Contract Expectations

- Canonical keys are imported from shared modules rather than duplicated in routes.
- Mutable commands must arrive as explicit envelopes with expected version, correlation ID, and trusted server time.
- Governed lookup values must remain idempotent and versioned.
- Money values are represented as fixed-point decimal strings and never as authoritative floating-point numbers.

