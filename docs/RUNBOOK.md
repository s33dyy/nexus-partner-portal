# LIVEY PAM CRM — Operational Runbook

This document provides standardized procedures for Support and DevOps teams to maintain, troubleshoot, and safely recover the LIVEY PAM CRM platform during General Availability.

## 1. Incident Response: Provider Queue Failures

If an external integration (e.g., Zoho Books, Postmark) begins to pile up dead-letter events or queue depths rapidly increase, follow these steps:

### 1.1 Triage and Pause
1. **Log in** as a `super_admin`.
2. Navigate to `/admin/integrations` (Integration Operations Centre).
3. Identify the failing provider (State will likely show **Attention Needed** or **Connected** with high dead letters).
4. Click **Pause**. This halts outbound commands to the provider while keeping incoming requests queued safely in our database.

### 1.2 Diagnose
- **Network Check**: Verify the provider's API status page.
- **Payload Validation**: Check the dead-letter payload in the audit logs (`/admin/audit`) for schema validation errors (e.g., `400 Bad Request` from the provider).
- **Rate Limits**: If the error is a `429 Too Many Requests`, ensure our local rate limiting adapter is configured correctly for the provider.

### 1.3 Recover and Resume
1. Once the provider is healthy, return to `/admin/integrations`.
2. Click **Resume**. The system will automatically attempt to drain the queued messages chronologically.
3. Monitor the queue depth. If dead letters persist, escalate to Level 3 Engineering.

---

## 2. Support Operations: Data Remediation

When data arrives from legacy migration or inbound webhooks in an ambiguous state, it enters an exception queue.

### 2.1 Orphaned Records
- **Issue**: A `Deal` has an unknown `assigned_partner_id`.
- **Resolution**:
  1. Do not manually edit the `deals` table.
  2. Use the **Re-assign Deal** command payload via the admin interface to properly enforce RBAC and re-run state validation.

### 2.2 Re-opening Closed Tickets
- **Issue**: A partner needs to reopen a ticket, but the UI restricts this based on SLA timeouts.
- **Resolution**:
  1. A `livey_support` user must manually override the state.
  2. Add an **Internal Note** explaining the SLA override before clicking **Reopen**.

---

## 3. Rollback Drills (Migration Exceptions)

Rollback disables new entry points and returns reads to the compatible path. **It does not delete newly written canonical records or rewrite published history.**

### 3.1 Initiating a Rollback
1. Execute the rollback CLI script:
   ```bash
   bun scripts/rollback-migration.ts --batch-id <BATCH_ID>
   ```
2. Verify that `active_read_path` is flipped back to `legacy` in the feature flag configuration.
3. Validate that write traffic is no longer flowing through the canonical domain handlers by checking the telemetry dashboard.

### 3.2 Post-Rollback Reconciliation
1. Generate an exception report for the failed batch.
2. Resolve the failing mapping logic.
3. Resume the migration batch starting from the last successful cursor.

---

## 4. Disaster Recovery (DR)

### 4.1 RTO and RPO
- **Recovery Time Objective (RTO)**: 4 Hours
- **Recovery Point Objective (RPO)**: 15 Minutes (Based on Supabase Point-in-Time Recovery).

### 4.2 Database Restore
1. Log into the Supabase project dashboard.
2. Navigate to **Database > Backups**.
3. Select the nearest Point-in-Time recovery point.
4. Execute the restore.
5. Once restored, reconcile external providers using `/admin/integrations` (click **Reconcile All**) to align external states with our rolled-back database.
