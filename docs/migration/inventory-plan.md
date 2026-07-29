# Migration Inventory Plan

## Goal

Establish a repeatable read-only snapshot of legacy data quality before later phases begin schema changes and command migrations.

## What the Inventory Reports

- row counts
- null and invalid rates
- duplicate candidates
- unknown enum and status values
- unresolved geography strings
- orphaned relationships and files
- string-form money fields
- unsafe public links
- demo and test rows
- known data owner or source fields

## How It Runs

- Default mode is fixture-only and read-only.
- Live database mode requires `INVENTORY_ALLOW_LIVE=1`.
- A checkpoint file can be written after each table so interrupted runs can resume.
- Structured JSON output is available with `--json`.

## Report Usage

- Use the report to define remediation tickets before later schema migrations.
- Do not use the inventory as a write path.
- Do not use the inventory to infer business access or authorization.

