# Advanced Filters and Notification Dots Design

## Goal

Add consistent client-side advanced filtering to Deals, Pipeline, Tasks, Deal Approvals, Customers, and Users & Roles, plus red notification dots for pending or unread work across the portal.

## Scope

Filters operate on records already loaded by each page. Existing filters remain available. No URL or server-query changes are required.

Filter coverage:

- Deals and Pipeline: search, stage, status, owner role, country, region, product, currency, amount range, probability range, and close-date range.
- Tasks: title/description search, status, priority, assignee, creator, due-date range, and overdue-only.
- Deal Approvals: search, approval state, stage, owner, partner, region, country, amount range, and submission-date range.
- Customers: company/owner search, status, country, region, segment, renewal type, credibility range, and employee-count range.
- Users & Roles: name/email/company search, role, partner, region, country, account status, and verification status.

Each page exposes an Advanced filters panel with an active-filter count and Clear all action. Filtering remains local and preserves existing access scoping.

## Notification dots

The shared sidebar navigation displays a small red dot with an accessible label when actionable or unread records exist:

- Deal Approvals: pending approvals.
- Tasks: newly assigned or incomplete tasks relevant to the current user.
- Notifications: unread notifications.
- Other modules: only where an existing unread, pending, or actionable count is available; no fabricated indicators.

Indicators refresh after relevant actions and on normal page/data refresh. Opening a module does not silently mark records read unless that module already has an established read-state command. The dot is therefore a truthful indicator, not merely a visual animation.

## Architecture

Use reusable client-side filter helpers and shared UI primitives where existing page patterns allow it. Keep each module's domain-specific field definitions local to its route, while centralizing range/date/text predicate behavior in a small library with unit tests. Compute notification counts from the same scoped data or existing notification queries used by the relevant page, preserving RBAC and partner/geography restrictions.

## Verification

- Unit-test each filter predicate category and active-filter count behavior.
- Verify each route loads with no server or relation errors.
- Verify each advanced filter changes the visible record set and Clear all restores it.
- Verify notification dots appear only for actionable/unread data and have accessible text.
- Run ESLint, focused tests, production build, deployment health check, and live-browser smoke tests.
