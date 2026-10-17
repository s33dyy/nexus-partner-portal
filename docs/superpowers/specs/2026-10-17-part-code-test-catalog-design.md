# Part Code Labels and Test Catalogue Design

## Scope

- Replace user-facing `SKU` labels with `Part Code` in the product catalogue UI and related catalogue workflows.
- Preserve the existing database/API field name where needed for compatibility with imports, exports, and existing records.
- Add ten clearly marked test catalogue items using the existing catalogue creation/bootstrap path.

## Test catalogue data

Each item will use a unique `TEST-PART-###` code and a `TEST-` product name. The set will cover Hardware and Software categories, Product and Combo classes, varied prices, and non-zero stock values. These records are test data and must not be presented as production catalogue items.

## Implementation

- Update labels, placeholders, validation messages, import/export headings, and lookup text that are shown to users.
- Keep persistence keys and server contracts unchanged unless an existing display string is incorrectly exposed.
- Add an idempotent seed helper or extend the existing seed path so rerunning bootstrap does not duplicate the ten records.

## Validation

- Run focused catalogue tests and lint the touched files.
- Verify the test records exist exactly once and retain their Part Codes.
- Build and deploy through the existing Docker workflow, then verify the live catalogue route and the visible Part Code label.
