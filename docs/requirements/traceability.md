# Requirements Traceability

## Phase 0 Requirement Coverage

| Requirement Area | Primary Modules | Primary Scripts | Primary Tests |
| --- | --- | --- | --- |
| Canonical taxonomy | `src/domain/contracts/taxonomy.ts` | `scripts/bootstrap-db.ts` | `src/domain/contracts/contracts.test.ts` |
| Money DTOs | `src/domain/contracts/money.ts` | n/a | `src/domain/contracts/contracts.test.ts` |
| State machines | `src/domain/contracts/state-machine.ts` | n/a | `src/domain/contracts/contracts.test.ts` |
| Governed reference data | `src/domain/contracts/reference-data.ts` | `scripts/bootstrap-db.ts` | `src/domain/contracts/contracts.test.ts` |
| Command and outbox envelopes | `src/domain/contracts/commands.ts` | `src/server/command-runtime.server.ts` | `src/domain/contracts/contracts.test.ts`, `src/server/command-runtime.server.test.ts` |
| Feature flags | `src/domain/contracts/feature-flags.ts` | `scripts/bootstrap-db.ts` | `src/domain/contracts/contracts.test.ts` |
| Telemetry and redaction | `src/domain/contracts/telemetry.ts`, `src/server.ts` | n/a | `src/domain/contracts/telemetry.test.ts` |
| Inventory tooling | `src/server/inventory-report.ts` | `scripts/inventory.ts` | `src/server/inventory-report.test.ts` |

## Notes

- This document is the phase 0 traceability skeleton.
- Later phases should extend it instead of creating parallel requirement maps.

