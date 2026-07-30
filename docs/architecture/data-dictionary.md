# Canonical Data Dictionary

## Source Modules

- Roles, geography types, lifecycle states, document classes, ID namespaces, and event versions: `src/domain/contracts/taxonomy.ts`
- Fixed-point money DTOs and parsing: `src/domain/contracts/money.ts`
- State-machine registry: `src/domain/contracts/state-machine.ts`
- Governed reference-data registry and seeds: `src/domain/contracts/reference-data.ts`
- Command, outbox, inbox, and denial contracts: `src/domain/contracts/commands.ts`
- Feature-flag registry: `src/domain/contracts/feature-flags.ts`
- Correlation and log redaction helpers: `src/domain/contracts/telemetry.ts`
- Fixed-point pricing helpers and canonical pricing builders: `src/lib/money.ts`, `src/lib/pricing-domain.ts`

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
- Pricing values use fixed-point decimal strings in the application layer and `numeric`/`decimal` storage in PostgreSQL.
- Currency-bearing records always carry explicit ISO currency codes and are normalized against the shared currency contract.
- Rounding is deterministic and half-away-from-zero when a value must be reduced to a lower scale.

## Canonical Pricing Nouns

- `products`: canonical product families with versioning and archive metadata.
- `product_variants`: product-level variants tied back to a canonical product.
- `product_skus`: sellable SKU records with MSRP, transfer price, discount, and reward-eligible monetary fields.
- `combos`: canonical bundle records with their own pricing context.
- `combo_components`: bundle composition rows that link a combo to component SKUs.
- `price_books`: effective-dated pricing containers that scope price rows to a currency and version.
- `price_rows`: product, variant, SKU, or combo price projections for a given price book.
- `fx_snapshots`: timestamped FX quotes that preserve source currency, target currency, rate, and captured amounts.
