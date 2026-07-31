import {
  createOutboxEnvelope,
  makePolicyDenial,
  type CommandExecutionResult,
  type CommandFailureContract,
} from "@/domain/contracts/commands";
import { canGrantRole, evaluateActiveContextPolicy } from "@/domain/contracts/governance";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { appendOutboxEnvelope, withTransaction } from "@/server/command-runtime.server";
import type { GovernedActor } from "@/server/governed-actor.server";

const USER_ROLE_EVENT_SCHEMA_VERSION = 1;

// user_roles.role is the Postgres "app_role" enum: exactly super_admin,
// partner_admin, partner_user. The broader RoleKey taxonomy in
// domain/contracts/taxonomy.ts (rm, pam, kam, isr, ...) belongs to the
// governance/Assignment system, which is a separate, largely-unwired model —
// see Phase 1 audit findings in docs/implementation-status.md. This command
// only ever writes app_role values.
const APP_ROLES = ["super_admin", "partner_admin", "partner_user"] as const;
export type AppRoleKey = (typeof APP_ROLES)[number];

function isAppRole(value: string): value is AppRoleKey {
  return (APP_ROLES as readonly string[]).includes(value);
}

function validationFailure(message: string, field: string): CommandFailureContract {
  return {
    code: "VALIDATION_FAILED",
    message,
    fieldErrors: [{ field, message }],
    retryable: false,
  };
}

function authorizeRoleChange(actor: GovernedActor, newRole: AppRoleKey) {
  const basePolicy = evaluateActiveContextPolicy({
    roles: [actor.assignment.roleKey],
    assignment: actor.assignment,
    activeContext: actor.activeContext,
  });
  if (!basePolicy.allowed) return basePolicy;

  if (!canGrantRole(actor.assignment.roleKey, newRole)) {
    return {
      allowed: false as const,
      reason: "Role escalation is not permitted",
      denial: makePolicyDenial(null, "Role escalation is not permitted"),
    };
  }

  return { allowed: true as const, reason: null };
}

export async function changeUserRole(input: {
  actor: GovernedActor;
  targetUserId: string;
  newRole: string;
  reason?: string | null;
}): Promise<CommandExecutionResult> {
  const correlationId = createCorrelationId();

  if (!isAppRole(input.newRole)) {
    return {
      ok: false,
      failure: validationFailure(`"${input.newRole}" is not a governed role`, "newRole"),
      correlationId,
    };
  }
  const newRole = input.newRole;

  const policy = authorizeRoleChange(input.actor, newRole);
  if (!policy.allowed) {
    return { ok: false, failure: policy.denial, correlationId };
  }

  return withTransaction(async (tx) => {
    // authorizeRoleChange only validates what role is being granted — it
    // never checks who the target user actually is. Without this, a
    // partner_admin (who can only ever grant "partner_user" per
    // canGrantRole) could still target ANY user_id system-wide: demoting a
    // super_admin's own account to partner_user (locking them out of the
    // admin panel), or a rival partner's partner_admin, as long as they
    // ever obtained that user_id from any other source. A non-super_admin
    // actor may only ever change roles for a user in their own partner.
    if (input.actor.assignment.roleKey !== "super_admin") {
      const { rows: targetRows } = await tx.query(
        `SELECT partner_id FROM profiles WHERE id = $1 LIMIT 1`,
        [input.targetUserId],
      );
      const targetPartnerId = (targetRows[0] as { partner_id: string | null } | undefined)
        ?.partner_id;
      if (
        !input.actor.assignment.partnerId ||
        targetPartnerId !== input.actor.assignment.partnerId
      ) {
        return {
          ok: false,
          failure: makePolicyDenial(null, "User is not accessible"),
          correlationId,
        };
      }
    }

    const { rows } = await tx.query(`SELECT role FROM user_roles WHERE user_id = $1`, [
      input.targetUserId,
    ]);
    const previousRoles = rows.map((row) => String(row.role));

    if (previousRoles.length === 0) {
      return {
        ok: false,
        failure: makePolicyDenial(null, "User is not accessible"),
        correlationId,
      };
    }

    if (previousRoles.length === 1 && previousRoles[0] === newRole) {
      return {
        ok: true,
        commandName: "identity.change_user_role",
        subjectId: input.targetUserId,
        newVersion: 1,
        nextAuthorisedActions: [],
        correlationId,
      };
    }

    await tx.query(`DELETE FROM user_roles WHERE user_id = $1`, [input.targetUserId]);
    await tx.query(
      `INSERT INTO user_roles (user_id, role, is_seed)
       VALUES ($1,$2,false)
       ON CONFLICT (user_id, role) DO UPDATE SET is_seed = EXCLUDED.is_seed`,
      [input.targetUserId, newRole],
    );

    const payload = { previousRoles, newRole, reason: input.reason ?? null };

    await tx.query(
      `INSERT INTO domain_activity_events (
         tenant_id, organization_tenant_id, subject_type, subject_id,
         actor_user_id, assignment_id, correlation_id, event_name, schema_version, payload
       ) VALUES ($1,$2,'user',$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.actor.assignment.tenantId,
        input.actor.assignment.organizationTenantId,
        input.targetUserId,
        input.actor.userId,
        input.actor.assignment.assignmentId,
        correlationId,
        "identity.role_changed",
        USER_ROLE_EVENT_SCHEMA_VERSION,
        JSON.stringify(payload),
      ],
    );

    await appendOutboxEnvelope(
      tx,
      createOutboxEnvelope({
        eventName: "identity.role_changed",
        schemaVersion: USER_ROLE_EVENT_SCHEMA_VERSION,
        aggregateType: "user",
        aggregateId: input.targetUserId,
        tenantId: input.actor.assignment.tenantId,
        organizationTenantId: input.actor.assignment.organizationTenantId,
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
      commandName: "identity.change_user_role",
      subjectId: input.targetUserId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
    };
  });
}
