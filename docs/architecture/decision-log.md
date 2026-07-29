# Decision Log

## 2026-07-29 - Keep TanStack Start and the single SQL bootstrap

- Decision: preserve the current TanStack Start app and single `db/schema.sql` bootstrap.
- Why: the repo already uses this shape, and phase 0 only needs a stronger contract layer, not a framework swap.
- Rollback: none required.

## 2026-07-29 - Centralize canonical domain contracts in `src/domain/contracts`

- Decision: move canonical role, lifecycle, money, command, telemetry, feature-flag, and reference-data keys into shared TypeScript modules.
- Why: later phases need one importable source of truth for server and tests.
- Rollback: consumers can keep reading the existing legacy helpers until later phases fully migrate.

## 2026-07-29 - Use `lookup_values` as the governed seed surface

- Decision: keep `lookup_values` and extend it with versioned, effective-dated metadata instead of inventing a parallel manual lookup table.
- Why: existing lookup flows already read from it, so this gives the platform a governed path without breaking current routes.
- Rollback: new fields are additive and can be ignored by older readers.

## 2026-07-29 - Add a read-only inventory CLI with checkpoints

- Decision: provide `scripts/inventory.ts` as the standard inventory entry point and keep live DB access opt-in through `INVENTORY_ALLOW_LIVE=1`.
- Why: phase 0 needs a safe inventory path that can run against fixtures and be resumed if interrupted.
- Rollback: the command is read-only and does not mutate production data.

