# Feature Flags

## Registry

The typed registry lives in `src/domain/contracts/feature-flags.ts`.

## Phase 0 Flags

| Key | Owner | Cohort | Dependencies | Metrics | Expiry | Rollback | Audit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `governed-reference-data-write` | Platform Data Foundations | internal-only | none | seed-idempotency, lookup-write-denials | 2026-12-31 | Disable governed writes and keep lookup_values read-only. | yes |
| `command-framework-write` | Platform Delivery | internal-only | baseline-telemetry | command-success-rate, command-denial-rate | 2026-12-31 | Bypass command runtime and revert to read-only command envelopes. | yes |
| `active-context-switch` | Identity and Policy | internal-only | command-framework-write | context-switch-denials, context-switch-latency | 2026-12-31 | Disable context switching and force a single authorized assignment. | yes |
| `baseline-telemetry` | Platform Observability | all-environments | none | correlation-id-coverage, structured-log-redaction | none | Keep telemetry helpers but stop emitting nonessential events. | yes |
| `inventory-read-models` | Platform Data Foundations | internal-only | baseline-telemetry | inventory-run-success, inventory-checkpoint-resume | 2026-12-31 | Keep inventory read-only and disable live database execution. | yes |

## Rules

- Server-side policy must enforce every flag.
- UI hiding is not a substitute for server denial.
- Disabled flags should fail closed, not broaden access.
- Feature-flag changes should be audited whenever they affect workflow execution.

