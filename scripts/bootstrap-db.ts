import "dotenv/config";

import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";

import { applyMigrations } from "./apply-migrations";
import { createPool } from "./db";
import { buildGovernanceSeedRows } from "../src/domain/contracts/governance";
import { seedGovernedReferenceData } from "../src/domain/contracts/reference-data";
import { buildFeatureFlagSeedRows } from "../src/domain/contracts/feature-flags";

const ADMIN_EMAIL = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? "admin@livey.tech";
const ADMIN_PASSWORD = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
const ADMIN_NAME = process.env.BOOTSTRAP_SUPER_ADMIN_NAME ?? "LIVEY Super Admin";
const ADMIN_COMPANY = process.env.BOOTSTRAP_SUPER_ADMIN_COMPANY ?? "LIVEY Technologies";

const RESET_TABLES = [
  "lookup_values",
  "password_reset_tokens",
  "sessions",
  "active_contexts",
  "assignment_events",
  "assignments",
  "geography_node_aliases",
  "geography_nodes",
  "governed_tenants",
  "document_blobs",
  "partner_review_notes",
  "partner_documents",
  "partners",
  "user_roles",
  "profiles",
  "portal_deals",
  "portal_customers",
  "portal_catalog_items",
  "portal_team_members",
  "portal_audit_events",
  "portal_news_posts",
  "reward_catalog_items",
  "reward_point_events",
  "reward_redemptions",
] as const;

async function resetDatabase() {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `TRUNCATE TABLE ${RESET_TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );

    if (!ADMIN_PASSWORD) {
      throw new Error("Missing BOOTSTRAP_SUPER_ADMIN_PASSWORD");
    }

    const adminId = randomUUID();
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    await client.query(
      `INSERT INTO profiles (id, email, password_hash, full_name, phone, company_name, partner_status, is_seed)
       VALUES ($1, $2, $3, $4, $5, $6, 'approved', false)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         full_name = EXCLUDED.full_name,
         phone = EXCLUDED.phone,
         company_name = EXCLUDED.company_name,
         partner_status = 'approved',
         is_seed = false`,
      [adminId, ADMIN_EMAIL, passwordHash, ADMIN_NAME, null, ADMIN_COMPANY],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role, is_seed)
       VALUES ($1, 'super_admin', false)
       ON CONFLICT (user_id, role) DO UPDATE SET
         is_seed = false`,
      [adminId],
    );

    const governanceSeed = buildGovernanceSeedRows({ superAdminUserId: adminId });
    for (const row of governanceSeed.tenants) {
      await client.query(
        `INSERT INTO governed_tenants (
           tenant_id,
           tenant_kind,
           display_name,
           parent_tenant_id,
           is_seed,
           created_at,
           updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id) DO UPDATE SET
           tenant_kind = EXCLUDED.tenant_kind,
           display_name = EXCLUDED.display_name,
           parent_tenant_id = EXCLUDED.parent_tenant_id,
           is_seed = EXCLUDED.is_seed,
           updated_at = EXCLUDED.updated_at`,
        [
          row.tenantId,
          row.tenantKind,
          row.displayName,
          row.parentTenantId,
          row.isSeed,
          row.createdAt,
          row.updatedAt,
        ],
      );
    }

    for (const row of governanceSeed.geographyNodes) {
      await client.query(
        `INSERT INTO geography_nodes (
           node_id,
           tenant_id,
           organization_tenant_id,
           node_code,
           node_type,
           display_name,
           parent_node_id,
           valid_from,
           valid_to,
           version,
           is_seed,
           created_at,
           updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (node_id) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           organization_tenant_id = EXCLUDED.organization_tenant_id,
           node_code = EXCLUDED.node_code,
           node_type = EXCLUDED.node_type,
           display_name = EXCLUDED.display_name,
           parent_node_id = EXCLUDED.parent_node_id,
           valid_from = EXCLUDED.valid_from,
           valid_to = EXCLUDED.valid_to,
           version = EXCLUDED.version,
           is_seed = EXCLUDED.is_seed,
           updated_at = EXCLUDED.updated_at`,
        [
          row.nodeId,
          row.tenantId,
          row.organizationTenantId,
          row.nodeCode,
          row.nodeType,
          row.displayName,
          row.parentNodeId,
          row.validFrom,
          row.validTo,
          row.version,
          row.isSeed,
          row.createdAt,
          row.updatedAt,
        ],
      );
    }

    for (const row of governanceSeed.geographyAliases) {
      await client.query(
        `INSERT INTO geography_node_aliases (
           alias_id,
           node_id,
           legacy_value,
           valid_from,
           valid_to,
           source,
           is_seed,
           created_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (alias_id) DO UPDATE SET
           node_id = EXCLUDED.node_id,
           legacy_value = EXCLUDED.legacy_value,
           valid_from = EXCLUDED.valid_from,
           valid_to = EXCLUDED.valid_to,
           source = EXCLUDED.source,
           is_seed = EXCLUDED.is_seed`,
        [
          row.aliasId,
          row.nodeId,
          row.legacyValue,
          row.validFrom,
          row.validTo,
          row.source,
          row.isSeed,
          row.createdAt,
        ],
      );
    }

    for (const row of governanceSeed.assignments) {
      await client.query(
        `INSERT INTO assignments (
           assignment_id,
           user_id,
           tenant_id,
           organization_tenant_id,
           role_key,
           team_domain,
           geography_ceiling_node_id,
           source,
           approver_user_id,
           status,
           predecessor_assignment_id,
           successor_assignment_id,
           valid_from,
           valid_to,
           revoked_at,
           revocation_reason,
           version,
           is_seed,
           created_at,
           updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (assignment_id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           tenant_id = EXCLUDED.tenant_id,
           organization_tenant_id = EXCLUDED.organization_tenant_id,
           role_key = EXCLUDED.role_key,
           team_domain = EXCLUDED.team_domain,
           geography_ceiling_node_id = EXCLUDED.geography_ceiling_node_id,
           source = EXCLUDED.source,
           approver_user_id = EXCLUDED.approver_user_id,
           status = EXCLUDED.status,
           predecessor_assignment_id = EXCLUDED.predecessor_assignment_id,
           successor_assignment_id = EXCLUDED.successor_assignment_id,
           valid_from = EXCLUDED.valid_from,
           valid_to = EXCLUDED.valid_to,
           revoked_at = EXCLUDED.revoked_at,
           revocation_reason = EXCLUDED.revocation_reason,
           version = EXCLUDED.version,
           is_seed = EXCLUDED.is_seed,
           updated_at = EXCLUDED.updated_at`,
        [
          row.assignmentId,
          row.userId,
          row.tenantId,
          row.organizationTenantId,
          row.roleKey,
          row.teamDomain,
          row.geographyCeilingNodeId,
          row.source,
          row.approverUserId,
          row.status,
          row.predecessorAssignmentId,
          row.successorAssignmentId,
          row.validFrom,
          row.validTo,
          row.revokedAt,
          row.revocationReason,
          row.version,
          row.isSeed,
          row.createdAt,
          row.updatedAt,
        ],
      );
    }

    for (const row of governanceSeed.assignmentEvents) {
      await client.query(
        `INSERT INTO assignment_events (
           event_id,
           assignment_id,
           actor_user_id,
           actor_assignment_id,
           action,
           reason,
           before_state,
           after_state,
           effective_at,
           predecessor_assignment_id,
           successor_assignment_id,
           session_revocation_result,
           correlation_id,
           is_seed,
           created_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (event_id) DO UPDATE SET
           assignment_id = EXCLUDED.assignment_id,
           actor_user_id = EXCLUDED.actor_user_id,
           actor_assignment_id = EXCLUDED.actor_assignment_id,
           action = EXCLUDED.action,
           reason = EXCLUDED.reason,
           before_state = EXCLUDED.before_state,
           after_state = EXCLUDED.after_state,
           effective_at = EXCLUDED.effective_at,
           predecessor_assignment_id = EXCLUDED.predecessor_assignment_id,
           successor_assignment_id = EXCLUDED.successor_assignment_id,
           session_revocation_result = EXCLUDED.session_revocation_result,
           correlation_id = EXCLUDED.correlation_id,
           is_seed = EXCLUDED.is_seed`,
        [
          row.eventId,
          row.assignmentId,
          row.actorUserId,
          row.actorAssignmentId,
          row.action,
          row.reason,
          row.beforeState,
          row.afterState,
          row.effectiveAt,
          row.predecessorAssignmentId,
          row.successorAssignmentId,
          row.sessionRevocationResult,
          row.correlationId,
          row.isSeed,
          row.createdAt,
        ],
      );
    }

    for (const row of governanceSeed.activeContexts) {
      await client.query(
        `INSERT INTO active_contexts (
           context_id,
           user_id,
           assignment_id,
           tenant_id,
           organization_tenant_id,
           working_scope,
           issued_at,
           expires_at,
           version,
           revocation_link,
           revoked_at,
           revocation_reason,
           correlation_id,
           is_seed,
           created_at,
           updated_at
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (context_id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           assignment_id = EXCLUDED.assignment_id,
           tenant_id = EXCLUDED.tenant_id,
           organization_tenant_id = EXCLUDED.organization_tenant_id,
           working_scope = EXCLUDED.working_scope,
           issued_at = EXCLUDED.issued_at,
           expires_at = EXCLUDED.expires_at,
           version = EXCLUDED.version,
           revocation_link = EXCLUDED.revocation_link,
           revoked_at = EXCLUDED.revoked_at,
           revocation_reason = EXCLUDED.revocation_reason,
           correlation_id = EXCLUDED.correlation_id,
           is_seed = EXCLUDED.is_seed,
           updated_at = EXCLUDED.updated_at`,
        [
          row.contextId,
          row.userId,
          row.assignmentId,
          row.tenantId,
          row.organizationTenantId,
          row.workingScope,
          row.issuedAt,
          row.expiresAt,
          row.version,
          row.revocationLink,
          row.revokedAt,
          row.revocationReason,
          row.correlationId,
          row.isSeed,
          row.createdAt,
          row.updatedAt,
        ],
      );
    }

    await seedGovernedReferenceData(client);

    const featureFlagRows = buildFeatureFlagSeedRows();
    for (const row of featureFlagRows) {
      await client.query(
        `INSERT INTO feature_flags (
           flag_key,
           label,
           enabled,
           owner,
           cohort,
           dependencies,
           metrics,
           expires_at,
           rollback,
           audit_required,
           is_seed
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (flag_key) DO UPDATE SET
           label = EXCLUDED.label,
           enabled = EXCLUDED.enabled,
           owner = EXCLUDED.owner,
           cohort = EXCLUDED.cohort,
           dependencies = EXCLUDED.dependencies,
           metrics = EXCLUDED.metrics,
           expires_at = EXCLUDED.expires_at,
           rollback = EXCLUDED.rollback,
           audit_required = EXCLUDED.audit_required,
           is_seed = EXCLUDED.is_seed`,
        [
          row.flag_key,
          row.label,
          row.enabled,
          row.owner,
          row.cohort,
          row.dependencies,
          row.metrics,
          row.expires_at,
          row.rollback,
          row.audit_required,
          row.is_seed,
        ],
      );
    }

    await client.query("COMMIT");
    console.log(`Database reset. Super admin created: ${ADMIN_EMAIL}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function bootstrapDb() {
  await applyMigrations();
  await resetDatabase();
}

if (import.meta.main) {
  bootstrapDb()
    .then(() => {
      console.log("Database bootstrapped");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
