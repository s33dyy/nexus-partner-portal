# LIVEY Partner Portal System Flowchart

This document maps the primary production workflow in the portal so future feature work can stay aligned with the actual business process.

```mermaid
flowchart TD
  A["Create account"] --> B["Sign in"]
  B --> C["Register as partner"]
  C --> D["Submit business details"]
  D --> E["Upload documents separately"]
  E --> F["LIVEY reviews partner profile"]
  F --> G{"Approved?"}
  G -->|No| H["Request more info or reject"]
  G -->|Yes| I["Partner workspace opens"]
  I --> J["Register deal"]
  J --> K{"Deal value < $5,000?"}
  K -->|Yes| L["Auto-approve"]
  K -->|No| M["Super admin review"]
  L --> N["Deal moves through sourced, qualified, demo, testing"]
  M --> N
  N --> O{"Won?"}
  O -->|No| P["Continue pipeline"]
  O -->|Yes| Q["Upload purchase order"]
  Q --> R["Super admin verifies PO"]
  R --> S["Award points and update tier"]
  S --> T["Redeem rewards from storefront"]
```

## Coverage Notes

- Notifications are surfaced when partner, deal, and reward events happen.
- Audit logs capture approval and reward actions for later review.
- Empty states are intentional when no records exist yet.
- The portal uses PostgreSQL as the shared source of truth.
