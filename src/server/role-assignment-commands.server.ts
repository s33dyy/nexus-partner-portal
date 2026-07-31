import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import {
  createOutboxEnvelope,
  makePolicyDenial,
  type CommandExecutionResult,
} from "@/domain/contracts/commands";
import {
  GOVERNANCE_GEOGRAPHY_NODE_IDS,
  GOVERNANCE_TENANT_IDS,
  evaluateActiveContextPolicy,
  issueActiveContextFromAssignment,
  type AssignmentRecord,
} from "@/domain/contracts/governance";
import { ROLE_KEYS, type RoleKey } from "@/domain/contracts/taxonomy";
import {
  FEATURE_KEYS,
  ROLE_KEY_TEAM_DOMAIN,
  isLegacyAppRoleKey,
  type CrudOperation,
  type FeatureKey,
} from "@/domain/contracts/features";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { appendOutboxEnvelope, withTransaction } from "@/server/command-runtime.server";
import type { GovernedActor } from "@/server/governed-actor.server";

const ASSIGNMENT_EVENT_SCHEMA_VERSION = 1;

function isGovernedRoleKey(value: string): value is RoleKey {
  return (ROLE_KEYS as readonly string[]).includes(value);
}

function authorizeAssignRole(actor: GovernedActor) {
  const basePolicy = evaluateActiveContextPolicy({
    roles: [actor.assignment.roleKey],
    assignment: actor.assignment,
    activeContext: actor.activeContext,
  });
  if (!basePolicy.allowed) return basePolicy;

  if (actor.assignment.roleKey !== "super_admin") {
    return {
      allowed: false as const,
      reason: "Only Super Admin can assign governed roles",
      denial: makePolicyDenial(null, "Only Super Admin can assign governed roles"),
    };
  }

  return { allowed: true as const, reason: null };
}

/** Derives a single geography ceiling node for an assignment from a role's
 * (possibly multi-selected, disjoint) region access rows. assignments.
 * geography_ceiling_node_id is a single subtree root, so a role with zero
 * rows, a Global row, or more than one disjoint selection all widen to
 * Global — the admin.roles.tsx panel is where the precise multi-select
 * lives; this is a display/compat ceiling used for logging and any code
 * that still reads assignment.geographyCeilingNodeId directly. */
function deriveGeographyCeiling(nodeIds: string[]): string {
  const unique = Array.from(new Set(nodeIds));
  if (unique.length === 0) return GOVERNANCE_GEOGRAPHY_NODE_IDS.global;
  if (unique.length === 1) return unique[0];
  return GOVERNANCE_GEOGRAPHY_NODE_IDS.global;
}

export async function loadRoleGeographyCeiling(
  tx: Pick<PoolClient, "query">,
  roleKey: RoleKey,
): Promise<string> {
  const { rows } = await tx.query(
    `SELECT geography_node_id FROM role_geography_access WHERE role_key = $1`,
    [roleKey],
  );
  const nodeIds = (rows as Array<{ geography_node_id: string }>).map(
    (row) => row.geography_node_id,
  );
  return deriveGeographyCeiling(nodeIds);
}

export async function assignGovernedRole(input: {
  actor: GovernedActor;
  targetUserId: string;
  roleKey: string;
  // Region access is set per-user, not per-role (admin.users.tsx) — the
  // role-level "Region access" panel that used to live on admin.roles.tsx
  // was removed since every user on a role sharing one geography ceiling
  // doesn't match how coverage actually varies person-to-person (e.g. two
  // RMs each covering a different region). When omitted, falls back to the
  // role's role_geography_access default (unchanged behaviour, e.g. for
  // createUser/createUsersBulk callers that don't collect a per-user
  // region yet).
  geographyCeilingNodeId?: string | null;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();

  if (!isGovernedRoleKey(input.roleKey)) {
    return {
      ok: false,
      failure: {
        code: "VALIDATION_FAILED",
        message: `"${input.roleKey}" is not a governed role`,
        fieldErrors: [{ field: "roleKey", message: "Unknown role" }],
        retryable: false,
      },
      correlationId,
    };
  }
  const roleKey = input.roleKey;

  const policy = authorizeAssignRole(input.actor);
  if (!policy.allowed) {
    return { ok: false, failure: policy.denial, correlationId };
  }

  return withTransaction(async (tx) => {
    const { rows: targetRows } = await tx.query(`SELECT id FROM profiles WHERE id = $1 LIMIT 1`, [
      input.targetUserId,
    ]);
    if (targetRows.length === 0) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "User is not accessible"),
        correlationId,
      };
    }

    let geographyCeilingNodeId: string;
    if (input.geographyCeilingNodeId) {
      const { rows: nodeRows } = await tx.query(
        `SELECT node_id FROM geography_nodes WHERE node_id = $1 LIMIT 1`,
        [input.geographyCeilingNodeId],
      );
      if (nodeRows.length === 0) {
        return {
          ok: false,
          failure: {
            code: "VALIDATION_FAILED",
            message: `"${input.geographyCeilingNodeId}" is not a known geography node`,
            fieldErrors: [{ field: "geographyCeilingNodeId", message: "Unknown geography node" }],
            retryable: false,
          },
          correlationId,
        };
      }
      geographyCeilingNodeId = input.geographyCeilingNodeId;
    } else {
      geographyCeilingNodeId = await loadRoleGeographyCeiling(tx, roleKey);
    }
    const teamDomain = ROLE_KEY_TEAM_DOMAIN[roleKey];
    const issuedAt = new Date().toISOString();

    await tx.query(
      `UPDATE assignments
       SET status = 'ended', valid_to = now(), updated_at = now()
       WHERE user_id = $1 AND status = 'active'`,
      [input.targetUserId],
    );

    const assignmentId = randomUUID();
    await tx.query(
      `INSERT INTO assignments (
         assignment_id, user_id, tenant_id, organization_tenant_id, role_key, team_domain,
         geography_ceiling_node_id, status, valid_from, source, approver_user_id, is_seed
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,'admin_console',$9,false)`,
      [
        assignmentId,
        input.targetUserId,
        GOVERNANCE_TENANT_IDS.liveyOrganization,
        GOVERNANCE_TENANT_IDS.liveyOrganization,
        roleKey,
        teamDomain,
        geographyCeilingNodeId,
        issuedAt,
        input.actor.userId,
      ],
    );

    const assignmentRecord: AssignmentRecord = {
      assignmentId,
      userId: input.targetUserId,
      tenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
      organizationTenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
      roleKey,
      teamDomain,
      geographyCeilingNodeId,
      partnerId: null,
      accountId: null,
      portfolioId: null,
      queueId: null,
      status: "active",
      validFrom: issuedAt,
      validTo: null,
      managerAssignmentId: null,
      source: "admin_console",
      approverUserId: input.actor.userId,
      predecessorAssignmentId: null,
      successorAssignmentId: null,
      revokedAt: null,
      revocationReason: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
      version: 1,
      isSeed: false,
    };

    const activeContext = issueActiveContextFromAssignment({
      assignment: assignmentRecord,
      issuedAt,
      correlationId,
    });

    await tx.query(
      `UPDATE active_contexts SET revoked_at = now(), revocation_reason = 'role_reassigned'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [input.targetUserId],
    );

    await tx.query(
      `INSERT INTO active_contexts (
         context_id, user_id, assignment_id, tenant_id, organization_tenant_id,
         working_scope, issued_at, expires_at, version, correlation_id, is_seed
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)`,
      [
        activeContext.contextId,
        activeContext.userId,
        activeContext.assignmentId,
        activeContext.tenantId,
        activeContext.organizationTenantId,
        activeContext.workingScope,
        activeContext.issuedAt,
        activeContext.expiresAt,
        activeContext.version,
        activeContext.correlationId,
      ],
    );

    await tx.query(
      `INSERT INTO assignment_events (
         event_id, assignment_id, actor_user_id, actor_assignment_id, action, reason,
         after_state, effective_at, correlation_id, is_seed
       ) VALUES ($1,$2,$3,$4,'assignment.granted',$5,$6,$7,$8,false)`,
      [
        randomUUID(),
        assignmentId,
        input.actor.userId,
        input.actor.assignment.assignmentId,
        input.reason ?? null,
        JSON.stringify({ assignmentId, roleKey, geographyCeilingNodeId }),
        issuedAt,
        correlationId,
      ],
    );

    // Keep the legacy app_role in sync for the three roles that still gate
    // hasRole("super_admin")-style checks across the app; always clear any
    // prior legacy row first so switching a user from e.g. partner_admin to
    // an internal-only role (rm/pam/kam/isr/livey_support/
    // restricted_distributor, which have no legacy equivalent) doesn't
    // leave them with a stale, now-incorrect legacy role.
    await tx.query(`DELETE FROM user_roles WHERE user_id = $1`, [input.targetUserId]);
    if (isLegacyAppRoleKey(roleKey)) {
      await tx.query(
        `INSERT INTO user_roles (user_id, role, is_seed)
         VALUES ($1,$2,false)
         ON CONFLICT (user_id, role) DO UPDATE SET is_seed = EXCLUDED.is_seed`,
        [input.targetUserId, roleKey],
      );
    }

    // Internal roles bypass the partner onboarding flow entirely — they
    // aren't partners, so mark them approved immediately.
    if (!isLegacyAppRoleKey(roleKey)) {
      await tx.query(
        `UPDATE profiles SET partner_status = 'approved', updated_at = now() WHERE id = $1`,
        [input.targetUserId],
      );
    }

    const payload = { roleKey, geographyCeilingNodeId, teamDomain, reason: input.reason ?? null };
    await appendOutboxEnvelope(
      tx,
      createOutboxEnvelope({
        eventName: "identity.governed_role_assigned",
        schemaVersion: ASSIGNMENT_EVENT_SCHEMA_VERSION,
        aggregateType: "assignment",
        aggregateId: assignmentId,
        tenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
        organizationTenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
        actorUserId: input.actor.userId,
        assignmentId: input.actor.assignment.assignmentId,
        correlationId,
        idempotencyKey: null,
        publishAfter: null,
        payload,
      }),
    );

    return {
      ok: true,
      commandName: "identity.assign_governed_role",
      subjectId: input.targetUserId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}

export type SaveRolePermissionsInput = {
  actor: GovernedActor;
  roleKey: string;
  capabilities: Record<FeatureKey, Record<CrudOperation, boolean>>;
  reason?: string | null;
};

export type SaveRolePermissionsResult =
  | { ok: true; correlationId: string }
  | { ok: false; failure: ReturnType<typeof makePolicyDenial>; correlationId: string };

/** Replaces a role's feature-permission matrix (Create/Read/Update/Delete
 * per feature). Region access is deliberately NOT configured here — it
 * moved to a per-user setting (admin.users.tsx, assignGovernedRole's
 * geographyCeilingNodeId) since one geography ceiling per role can't
 * express two users on the same role covering different territories.
 * role_geography_access / loadRoleGeographyCeiling still exist as the
 * DEFAULT ceiling a role falls back to when a user's assignment doesn't
 * specify an explicit override, but there is no UI to edit that default
 * anymore — it's fixed at whatever the bootstrap seed set. */
export async function saveRolePermissions(
  input: SaveRolePermissionsInput,
): Promise<SaveRolePermissionsResult> {
  const correlationId = createCorrelationId();

  if (!isGovernedRoleKey(input.roleKey)) {
    return {
      ok: false,
      failure: makePolicyDenial(null, `"${input.roleKey}" is not a governed role`),
      correlationId,
    };
  }
  const roleKey = input.roleKey;

  const policy = authorizeAssignRole(input.actor);
  if (!policy.allowed) {
    return { ok: false, failure: policy.denial, correlationId };
  }

  return withTransaction(async (tx) => {
    await tx.query(`DELETE FROM role_permissions WHERE role_key = $1`, [roleKey]);
    for (const featureKey of FEATURE_KEYS) {
      const flags = input.capabilities[featureKey] ?? {
        create: false,
        read: false,
        update: false,
        delete: false,
      };
      await tx.query(
        `INSERT INTO role_permissions (role_key, feature_key, can_create, can_read, can_update, can_delete)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [roleKey, featureKey, flags.create, flags.read, flags.update, flags.delete],
      );
    }

    await appendOutboxEnvelope(
      tx,
      createOutboxEnvelope({
        eventName: "identity.role_permissions_updated",
        schemaVersion: ASSIGNMENT_EVENT_SCHEMA_VERSION,
        aggregateType: "role",
        aggregateId: roleKey,
        tenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
        organizationTenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
        actorUserId: input.actor.userId,
        assignmentId: input.actor.assignment.assignmentId,
        correlationId,
        idempotencyKey: null,
        publishAfter: null,
        payload: { roleKey },
      }),
    );

    return { ok: true, correlationId };
  });
}
