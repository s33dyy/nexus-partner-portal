# Part Code and Test Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename catalogue-facing SKU text to Part Code and add ten idempotent TEST catalogue items through existing catalogue data paths.

**Architecture:** Keep the database/API `sku` field unchanged for compatibility. Update only user-facing catalogue labels, placeholders, import/export headings, and validation copy. Add a deterministic seed helper invoked by the existing bootstrap path, using `sku` values `TEST-PART-001` through `TEST-PART-010` and upsert-style duplicate protection.

**Tech Stack:** React, TanStack Start, TypeScript, Bun tests, PostgreSQL, Docker Compose.

---

### Task 1: Inventory and test the label surface

**Files:**
- Modify: catalogue UI and catalogue helper files identified by `rg -n "SKU|sku" src`
- Test: existing catalogue tests plus a focused label/data test if a helper owns the display text

- [ ] Run `rg -n "SKU|sku" src` and classify each match as persistence/API, user-facing text, or test fixture.
- [ ] Add a focused failing assertion for the user-facing Part Code label or display mapping where the current code exposes SKU text.
- [ ] Run the focused test and confirm it fails against the current label.

### Task 2: Rename user-facing catalogue labels

**Files:**
- Modify: existing catalogue route/components and import/export definitions from Task 1

- [ ] Replace visible labels, placeholders, headings, validation messages, and import/export headers with `Part Code`.
- [ ] Leave database columns, request keys, and existing record properties as `sku` unless they are directly rendered to users.
- [ ] Run the focused catalogue test, touched-file ESLint, and `git diff --check`.

### Task 3: Add idempotent dummy catalogue data

**Files:**
- Modify: existing bootstrap/seed module discovered from `rg -n "bootstrap|seed.*catalog|catalog.*seed" scripts src db`
- Test: the existing seed/catalogue test location

- [ ] Add ten deterministic records named `TEST-Product-001` through `TEST-Product-010`, with codes `TEST-PART-001` through `TEST-PART-010`, mixed Hardware/Software categories, Product/Combo classes, varied prices, and positive stock.
- [ ] Guard inserts with the existing unique code lookup or an equivalent `ON CONFLICT`/pre-check so rerunning the seed creates no duplicates.
- [ ] Add a test proving the seed input contains ten unique test codes and is safe to rerun.
- [ ] Run the focused seed/catalogue tests.

### Task 4: Build and deploy

**Files:**
- No additional source files

- [ ] Run the focused tests, touched-file ESLint, and production build.
- [ ] Commit the implementation and push `HEAD:main`.
- [ ] On Hostinger, pull `main`, run `docker compose build app` to completion in the background, verify the image ID changes, then run `docker compose up -d --force-recreate app` and migrations.
- [ ] Verify the live catalogue route returns HTTP 200, the app container is healthy, and the test records exist exactly once.
