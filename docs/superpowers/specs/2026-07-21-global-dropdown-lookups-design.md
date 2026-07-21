# Global Dropdown Lookups Design

**Goal:** Replace hardcoded dropdown options with searchable, selectable, and addable lookup values stored in Postgres so choices persist globally across the app.

**Architecture:** Introduce a `lookup_values` table keyed by a stable field name and normalized value. Build a reusable combobox component that loads options from Postgres on demand, filters them client-side while typing, and upserts a new option when the user enters a value that does not already exist. Use this component across portal edit forms and admin filters that currently hardcode option lists. Keep new registration/onboarding flows as free-form inputs where users are introducing brand-new records.

**Tech Stack:** TanStack Start, React, TypeScript, Radix UI, cmdk, PostgreSQL, existing local server bridge, Railway production Postgres.

---

## Requirements

- Dropdown options must no longer be defined as static arrays in route files.
- Users must be able to search the option list.
- Users must be able to choose an existing option.
- Users must be able to add a new option from the control itself.
- Any newly added option must be saved in Postgres and available on the next load everywhere that field is used.
- Registration and onboarding forms that collect brand-new company details should remain free-form text inputs, not dropdowns.
- Fields backed by hard backend enums or permission logic may stay constrained if accepting arbitrary values would break the app; all regular data-entry dropdowns should use the new lookup system.

## Data Model

- Add a `lookup_values` table with:
  - `id`
  - `field_name`
  - `value`
  - `value_key`
  - `is_seed`
  - `created_by`
  - `created_at`
- Enforce uniqueness on `(field_name, value_key)` so repeated additions are idempotent.
- Store `value_key` as the normalized comparison key used to deduplicate case and whitespace variants.

## Runtime Flow

1. A dropdown opens.
2. The component requests lookup values for its field name from the server.
3. The user types to filter the list.
4. Selecting an existing option updates the form value.
5. If the typed text does not exist, the component offers a create action.
6. Creating the option upserts it in Postgres and immediately selects it.
7. Later screens and sessions read the same stored values.

## File Boundaries

- `db/schema.sql` owns the table definition.
- `scripts/bootstrap-db.ts` owns reset coverage for the new table.
- `src/server/livey-service.server.ts` owns generic Postgres query support for the new table.
- `src/server/lookup-values.server.ts` owns lookup-specific read/write helpers.
- `src/integrations/local/lookups.ts` exposes client-safe server functions for the UI.
- `src/components/lookup-combobox.tsx` owns the reusable searchable dropdown UI.
- Route files own field-by-field replacement of hardcoded dropdowns.

## Testing

- Verify the schema compiles and the bootstrap reset still runs.
- Verify a new lookup value can be created once and read back on refresh.
- Verify representative routes render with searchable, addable dropdowns.
- Verify registration/onboarding forms continue to use free-form inputs where intended.

