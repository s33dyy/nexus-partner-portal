import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";

import {
  buildProdDemoGovernanceSeedRows,
  PROD_DEMO_CUSTOMERS,
  PROD_DEMO_DEALS,
  PROD_DEMO_PARTNERS,
  PROD_DEMO_PROFILES,
  PROD_DEMO_TEAM_MEMBERS,
  PROD_DEMO_USER_ROLES,
} from "./prod-demo-fixtures";

type SeedRow = Record<string, unknown>;

function quoteIdent(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function upsertById(client: PoolClient, table: string, row: SeedRow) {
  const columns = Object.keys(row);
  const values = columns.map((column) => row[column]);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const assignments = columns
    .filter((column) => column !== "id" && column !== "created_at")
    .map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`)
    .join(", ");

  await client.query(
    `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${assignments}`,
    values,
  );
}

async function upsertProfile(
  client: PoolClient,
  profile: (typeof PROD_DEMO_PROFILES)[number],
  passwordOverride?: string,
) {
  const password = passwordOverride ?? profile.password;
  const passwordHash = await bcrypt.hash(password, 10);
  await client.query(
    `INSERT INTO profiles (
       id,
       email,
       password_hash,
       full_name,
       phone,
       company_name,
       partner_id,
       partner_status,
       is_seed
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
     ON CONFLICT (email) DO UPDATE SET
       id = EXCLUDED.id,
       password_hash = EXCLUDED.password_hash,
       full_name = EXCLUDED.full_name,
       phone = EXCLUDED.phone,
       company_name = EXCLUDED.company_name,
       partner_id = EXCLUDED.partner_id,
       partner_status = EXCLUDED.partner_status,
       is_seed = true`,
    [
      profile.id,
      profile.email,
      passwordHash,
      profile.full_name,
      profile.phone,
      profile.company_name,
      profile.partner_id,
      profile.partner_status,
    ],
  );
}

async function upsertUserRole(client: PoolClient, role: (typeof PROD_DEMO_USER_ROLES)[number]) {
  await client.query(
    `INSERT INTO user_roles (user_id, role, is_seed)
     VALUES ($1,$2,true)
     ON CONFLICT (user_id, role) DO UPDATE SET
       is_seed = true`,
    [role.user_id, role.role],
  );
}

function toInsertRow<T extends Record<string, unknown>>(row: T) {
  return row as SeedRow;
}

export async function seedProdDemoData(client: PoolClient, input: { superAdminPassword: string }) {
  const superAdminProfiles = PROD_DEMO_PROFILES.filter((profile) =>
    profile.roles.includes("super_admin"),
  );

  for (const [index, profile] of PROD_DEMO_PROFILES.entries()) {
    const passwordOverride = index === 0 ? input.superAdminPassword : undefined;
    await upsertProfile(client, profile, passwordOverride);
  }

  for (const role of PROD_DEMO_USER_ROLES) {
    await upsertUserRole(client, role);
  }

  for (const partner of PROD_DEMO_PARTNERS) {
    await upsertById(client, "partners", toInsertRow(partner));
  }

  for (const customer of PROD_DEMO_CUSTOMERS) {
    await upsertById(client, "portal_customers", toInsertRow(customer));
  }

  for (const deal of PROD_DEMO_DEALS) {
    await upsertById(client, "portal_deals", toInsertRow(deal));
  }

  for (const member of PROD_DEMO_TEAM_MEMBERS) {
    await upsertById(client, "portal_team_members", toInsertRow(member));
  }

  const governanceSeed = buildProdDemoGovernanceSeedRows({
    superAdminUserIds: superAdminProfiles.map((profile) => profile.id),
  });

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
         partner_id,
         account_id,
         portfolio_id,
         queue_id,
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
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       ON CONFLICT (assignment_id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         tenant_id = EXCLUDED.tenant_id,
         organization_tenant_id = EXCLUDED.organization_tenant_id,
         role_key = EXCLUDED.role_key,
         team_domain = EXCLUDED.team_domain,
         geography_ceiling_node_id = EXCLUDED.geography_ceiling_node_id,
         partner_id = EXCLUDED.partner_id,
         account_id = EXCLUDED.account_id,
         portfolio_id = EXCLUDED.portfolio_id,
         queue_id = EXCLUDED.queue_id,
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
        row.partnerId,
        row.accountId,
        row.portfolioId,
        row.queueId,
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
        true,
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
}
