import { makePolicyDenial } from "@/domain/contracts/commands";
import type { CrudOperation } from "@/domain/contracts/features";
import { evaluateActiveContextPolicy, type PolicyDecision } from "@/domain/contracts/governance";
import {
  resolveGovernedActor,
  type GovernedActor,
  type ResolveGovernedActorInput,
} from "@/server/governed-actor.server";
import { hasCapability, loadRoleCapabilities } from "@/server/rbac-policy.server";

/**
 * Authorisation for outreach sequences.
 *
 * Two gates, both required, and deliberately in this order:
 *
 *  1. The role permission matrix (/admin/roles) says whether the role may do
 *     this at all. Seeded closed for every partner-side role — a sequence
 *     mails LIVEY's own customers from LIVEY's own domain, so authoring one
 *     is not a partner capability — but the matrix is editable, so the check
 *     is made at runtime rather than assumed from the seed.
 *  2. Row scope says whether THIS sequence is theirs. super_admin sees
 *     everything; anyone else sees sequences they own, plus (for a
 *     partner-scoped actor) sequences belonging to their own partner.
 *
 * Enforced here rather than in table-policy.server.ts because the outreach
 * tables are deliberately absent from the generic supabase.from() path — see
 * the module comment in outreach-queries.server.ts.
 */

export type OutreachActor = GovernedActor;
export type ResolveOutreachActorInput = ResolveGovernedActorInput;
export const resolveOutreachActor = resolveGovernedActor;

export type SequenceScopeFacts = {
  ownerId: string | null;
  partnerId: string | null;
};

export function isOutreachSuperAdmin(actor: OutreachActor): boolean {
  return actor.assignment.roleKey === "super_admin";
}

/** Row-level scope, independent of the capability matrix. Split out so the
 * read path can build a SQL predicate from the same rule the write path
 * asserts. */
export function isSequenceInScope(actor: OutreachActor, sequence: SequenceScopeFacts): boolean {
  if (isOutreachSuperAdmin(actor)) return true;
  if (sequence.ownerId && sequence.ownerId === actor.userId) return true;
  const actorPartnerId = actor.assignment.partnerId ?? null;
  return !!actorPartnerId && actorPartnerId === sequence.partnerId;
}

/**
 * A `WHERE` fragment expressing the same rule, with its bound parameters.
 *
 * `$1`/`$2` are placeholders the caller renumbers — every query here builds
 * its parameter list in a different order, and renumbering at the call site
 * is far less error-prone than threading an index through this function.
 */
export function sequenceScopePredicate(
  actor: OutreachActor,
  columns: { ownerColumn: string; partnerColumn: string },
): { clause: string; params: unknown[] } {
  if (isOutreachSuperAdmin(actor)) return { clause: "TRUE", params: [] };
  const actorPartnerId = actor.assignment.partnerId ?? null;
  if (actorPartnerId) {
    return {
      clause: `(${columns.ownerColumn} = ? OR ${columns.partnerColumn} = ?)`,
      params: [actor.userId, actorPartnerId],
    };
  }
  return { clause: `${columns.ownerColumn} = ?`, params: [actor.userId] };
}

/** Replaces the `?` placeholders above with `$n`, starting at `startIndex`. */
export function bindPredicate(clause: string, startIndex: number): string {
  let next = startIndex;
  return clause.replace(/\?/g, () => `$${next++}`);
}

export async function authorizeOutreach(input: {
  actor: OutreachActor;
  operation: CrudOperation;
  sequence?: SequenceScopeFacts;
}): Promise<PolicyDecision> {
  const basePolicy = evaluateActiveContextPolicy({
    roles: [input.actor.assignment.roleKey],
    assignment: input.actor.assignment,
    activeContext: input.actor.activeContext,
  });
  if (!basePolicy.allowed) return basePolicy;

  // super_admin bypasses the matrix for the same reason table-policy does:
  // the matrix is edited from a page only super_admin can reach, and a
  // mis-set row must never be able to lock out the person who has to fix it.
  if (!isOutreachSuperAdmin(input.actor)) {
    const capabilities = await loadRoleCapabilities(input.actor.assignment.roleKey);
    if (!hasCapability(capabilities, "outreach", input.operation)) {
      return {
        allowed: false,
        reason: "This role cannot use outreach sequences",
        denial: makePolicyDenial(null, "This role cannot use outreach sequences"),
      };
    }
  }

  if (input.sequence && !isSequenceInScope(input.actor, input.sequence)) {
    return {
      allowed: false,
      reason: "Sequence is outside this assignment's scope",
      denial: makePolicyDenial(null, "Sequence is outside this assignment's scope"),
    };
  }

  return { allowed: true, reason: null };
}
