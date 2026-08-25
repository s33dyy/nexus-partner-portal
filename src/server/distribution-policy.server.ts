import { makePolicyDenial, type PolicyDenialErrorContract } from "@/domain/contracts/commands";
import {
  canCancelStockRequest,
  isTerminalStockRequestStatus,
  type StockLineQuantities,
  type StockRequestAction,
  type StockRequestStatus,
} from "@/domain/contracts/distribution";
import { evaluateActiveContextPolicy, type PolicyDecision } from "@/domain/contracts/governance";
import type { CrudOperation } from "@/domain/contracts/features";
import type { QueryRunner } from "@/server/command-runtime.server";
import { resolveProductSurface } from "@/server/feature-gates.server";
import {
  resolveGovernedActor,
  type GovernedActor,
  type ResolveGovernedActorInput,
} from "@/server/governed-actor.server";
import { hasCapability, loadRoleCapabilities } from "@/server/rbac-policy.server";

/**
 * Who may do what in the Distribution domain (product.md §24.4).
 *
 * Three things must all be true before any DMS read or write happens, and
 * they are deliberately independent:
 *
 *   1. the `distribution-core` product surface is enabled (fails closed for
 *      every role, Super Admin included);
 *   2. the actor has a live governed Assignment and matching Active Context;
 *   3. the role permission matrix grants the operation on the `distribution`
 *      feature.
 *
 * Beyond that, record-level authority is never inferred from a role string.
 * Submission authority comes from the requester's own active Distributor
 * Assignment, approval authority from the snapshot the request carries, and
 * fulfilment authority from the custodian named on the location. A role that
 * merely looks powerful earns nothing.
 */

export type DistributionActor = GovernedActor;
export type ResolveDistributionActorInput = ResolveGovernedActorInput;
export const resolveDistributionActor = resolveGovernedActor;

export type DistributionDenial = { ok: false; failure: PolicyDenialErrorContract };
export type DistributionAllowed = { ok: true };

function denial(reason: string, subjectId: string | null = null): DistributionDenial {
  return { ok: false, failure: makePolicyDenial(subjectId, reason) };
}

export function isDistributionSuperAdmin(actor: DistributionActor): boolean {
  return actor.assignment.roleKey === "super_admin";
}

export function isDistributorActor(actor: DistributionActor): boolean {
  return actor.assignment.roleKey === "restricted_distributor";
}

/** Roles that can hold a manager or custodian position in this domain.
 * §24.4.1 grants read/update to rm and pam only; Super Admin is handled by
 * its own branch everywhere. */
const DISTRIBUTION_MANAGER_ROLES = new Set(["rm", "pam"]);

export function isDistributionManagerRole(actor: DistributionActor): boolean {
  return DISTRIBUTION_MANAGER_ROLES.has(actor.assignment.roleKey);
}

export function checkDistributionBasePolicy(actor: DistributionActor): PolicyDecision {
  return evaluateActiveContextPolicy({
    roles: [actor.assignment.roleKey],
    assignment: actor.assignment,
    activeContext: actor.activeContext,
  });
}

export type AuthorizeDistributionDeps = {
  /** Injected in tests; production reads the real flag row and the real
   * role permission matrix. */
  resolveSurface?: (key: "distribution-core") => Promise<boolean>;
  loadCapabilities?: typeof loadRoleCapabilities;
};

/**
 * The gate every DMS read and command passes through first.
 *
 * The surface check runs before the capability check on purpose: a disabled
 * surface must deny identically for every role, so an operator watching
 * denial telemetry cannot infer who *would* have had access.
 */
export async function authorizeDistribution(
  actor: DistributionActor,
  operation: CrudOperation,
  deps: AuthorizeDistributionDeps = {},
): Promise<DistributionAllowed | DistributionDenial> {
  const resolveSurface = deps.resolveSurface ?? resolveProductSurface;
  const loadCapabilitiesFn = deps.loadCapabilities ?? loadRoleCapabilities;

  if (!(await resolveSurface("distribution-core"))) {
    return denial("Distribution is not enabled in this workspace");
  }

  const base = checkDistributionBasePolicy(actor);
  if (!base.allowed) {
    return { ok: false, failure: base.denial as PolicyDenialErrorContract };
  }

  // Super Admin bypasses the editable matrix (the same bypass table-policy
  // uses) so the matrix can be edited without locking out the admin who
  // manages it. It does NOT bypass the surface check above, nor any
  // transition, quantity, idempotency, or terminal-state rule.
  if (isDistributionSuperAdmin(actor)) {
    if (operation === "delete") {
      return denial("Distribution records are never deleted");
    }
    return { ok: true };
  }

  const capabilities = await loadCapabilitiesFn(actor.assignment.roleKey);
  if (!hasCapability(capabilities, "distribution", operation)) {
    return denial("Distribution access is not granted to this role");
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Submission authority
// ---------------------------------------------------------------------------

export type SubmissionAuthority = {
  distributorAssignmentId: string;
  managerAssignmentId: string;
  partnerId: string | null;
};

type AssignmentAuthorityRow = {
  assignment_id: string;
  role_key: string;
  status: string;
  partner_id: string | null;
  manager_assignment_id: string | null;
  manager_status: string | null;
};

/**
 * Resolves and snapshots the authority chain for a submission (§24.3).
 *
 * Locks the Distributor's own Assignment `FOR SHARE` so it cannot be ended
 * or re-parented between this read and the insert that stores the snapshot,
 * and requires the manager Assignment to exist *and* be active. If it is
 * not, submission is refused — the alternative, picking some other manager,
 * would route a real approval decision to somebody nobody chose.
 */
export async function resolveSubmissionAuthority(
  tx: QueryRunner,
  actor: DistributionActor,
): Promise<{ ok: true; authority: SubmissionAuthority } | DistributionDenial> {
  if (isDistributionSuperAdmin(actor)) {
    // Super Admin administers locations and posts corrections; it does not
    // stand in for a Distributor, because a request with no Distributor
    // Assignment has no destination scope and nobody to notify.
    return denial("Only a Distributor can submit a stock request");
  }
  if (!isDistributorActor(actor)) {
    return denial("Only a Distributor can submit a stock request");
  }

  const { rows } = await tx.query(
    `SELECT a.assignment_id, a.role_key, a.status::text AS status, a.partner_id,
            a.manager_assignment_id, m.status::text AS manager_status
     FROM assignments a
     LEFT JOIN assignments m ON m.assignment_id = a.manager_assignment_id
     WHERE a.assignment_id = $1 AND a.user_id = $2
     FOR SHARE OF a`,
    [actor.assignment.assignmentId, actor.userId],
  );

  const row = rows[0] as AssignmentAuthorityRow | undefined;
  if (!row) {
    return denial("The acting assignment is not accessible");
  }
  if (row.role_key !== "restricted_distributor" || row.status !== "active") {
    return denial("An active Distributor assignment is required");
  }
  if (!row.manager_assignment_id || row.manager_status !== "active") {
    return denial("This Distributor assignment has no active manager to approve the request");
  }

  return {
    ok: true,
    authority: {
      distributorAssignmentId: row.assignment_id,
      managerAssignmentId: row.manager_assignment_id,
      partnerId: row.partner_id,
    },
  };
}

// ---------------------------------------------------------------------------
// Record-level authority
// ---------------------------------------------------------------------------

export type StockRequestAuthorityFacts = {
  requesterUserId: string;
  distributorAssignmentId: string;
  managerAssignmentId: string;
  destinationLocationId: string;
  /** Custodian Assignment ids of the destination and of every line's source
   * location, resolved by the query that loaded the request. */
  custodianAssignmentIds: readonly string[];
};

export function isRequestRequester(
  actor: DistributionActor,
  request: StockRequestAuthorityFacts,
): boolean {
  return (
    actor.userId === request.requesterUserId &&
    actor.assignment.assignmentId === request.distributorAssignmentId
  );
}

/** The SNAPPED manager, not "a manager". §24.3: a later reorganisation does
 * not move an in-flight request to a different approver. */
export function isRequestManager(
  actor: DistributionActor,
  request: StockRequestAuthorityFacts,
): boolean {
  return actor.assignment.assignmentId === request.managerAssignmentId;
}

export function isRequestCustodian(
  actor: DistributionActor,
  request: StockRequestAuthorityFacts,
): boolean {
  return request.custodianAssignmentIds.includes(actor.assignment.assignmentId);
}

/** Can this actor see the request at all? Everything else is layered on top
 * of this, so a "no" here means the record does not exist as far as the
 * caller is concerned — no counts, no detail, no deep link. */
export function canReadStockRequest(
  actor: DistributionActor,
  request: StockRequestAuthorityFacts,
): boolean {
  if (isDistributionSuperAdmin(actor)) return true;
  if (isDistributorActor(actor)) return isRequestRequester(actor, request);
  if (isDistributionManagerRole(actor)) {
    return isRequestManager(actor, request) || isRequestCustodian(actor, request);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Read scope
// ---------------------------------------------------------------------------

export type ScopePredicate = { clause: string; params: unknown[] };

/**
 * The SQL predicate that narrows a stock-request list to what this actor may
 * see. Computed entirely server-side from the governed Assignment — never
 * from a client-supplied filter — and returns a literal `FALSE` rather than
 * an empty string for a role with no access, so a mistake in a caller
 * produces no rows instead of every row.
 *
 * `alias` is the stock_requests alias in the caller's query.
 */
export function stockRequestScopePredicate(
  actor: DistributionActor,
  alias: string,
  nextParamIndex: number,
): ScopePredicate {
  if (isDistributionSuperAdmin(actor)) {
    return { clause: "TRUE", params: [] };
  }

  if (isDistributorActor(actor)) {
    return {
      clause: `${alias}.distributor_assignment_id = $${nextParamIndex}`,
      params: [actor.assignment.assignmentId],
    };
  }

  if (isDistributionManagerRole(actor)) {
    // A manager sees what they were asked to decide, plus anything moving
    // through a location they are custodian of. Not "every request in the
    // region": §24.4 says read is scoped, not blanket.
    const index = nextParamIndex;
    return {
      clause: `(
        ${alias}.manager_assignment_id = $${index}
        OR EXISTS (
          SELECT 1 FROM stock_locations dloc
          WHERE dloc.id = ${alias}.destination_location_id
            AND dloc.custodian_assignment_id = $${index}
        )
        OR EXISTS (
          SELECT 1 FROM stock_request_lines sline
          JOIN stock_locations sloc ON sloc.id = sline.source_location_id
          WHERE sline.request_id = ${alias}.id
            AND sloc.custodian_assignment_id = $${index}
        )
      )`,
      params: [actor.assignment.assignmentId],
    };
  }

  return { clause: "FALSE", params: [] };
}

/**
 * The predicate that narrows locations — and therefore balances and
 * movements — to what this actor may see.
 *
 * A Distributor sees only locations it owns; two Distributors under the same
 * Partner never see each other's stock. A manager sees only locations it is
 * custodian of, never another Distributor's balances (§24.4).
 */
export function stockLocationScopePredicate(
  actor: DistributionActor,
  alias: string,
  nextParamIndex: number,
): ScopePredicate {
  if (isDistributionSuperAdmin(actor)) {
    return { clause: "TRUE", params: [] };
  }
  if (isDistributorActor(actor)) {
    return {
      clause: `${alias}.distributor_assignment_id = $${nextParamIndex}`,
      params: [actor.assignment.assignmentId],
    };
  }
  if (isDistributionManagerRole(actor)) {
    return {
      clause: `${alias}.custodian_assignment_id = $${nextParamIndex}`,
      params: [actor.assignment.assignmentId],
    };
  }
  return { clause: "FALSE", params: [] };
}

/** Locations this actor may send stock TO. A Distributor may only receive
 * into its own active locations; Super Admin may target any active one. */
export function destinationLocationScopePredicate(
  actor: DistributionActor,
  alias: string,
  nextParamIndex: number,
): ScopePredicate {
  if (isDistributionSuperAdmin(actor)) {
    return { clause: `${alias}.active = TRUE`, params: [] };
  }
  if (isDistributorActor(actor)) {
    return {
      clause: `${alias}.active = TRUE AND ${alias}.distributor_assignment_id = $${nextParamIndex}`,
      params: [actor.assignment.assignmentId],
    };
  }
  return { clause: "FALSE", params: [] };
}

// ---------------------------------------------------------------------------
// Allowed actions
// ---------------------------------------------------------------------------

/**
 * What this actor may do to this request right now.
 *
 * The workspace renders its buttons from this array and never from a role
 * name — but this is a convenience for the UI, not the enforcement point.
 * Every command re-derives the same authority server-side, so a client that
 * fabricates an action gets a policy denial rather than an effect.
 */
export function resolveAllowedStockRequestActions(
  actor: DistributionActor,
  request: StockRequestAuthorityFacts & {
    status: StockRequestStatus;
    lines: readonly StockLineQuantities[];
  },
): StockRequestAction[] {
  if (!canReadStockRequest(actor, request)) return [];

  const superAdmin = isDistributionSuperAdmin(actor);
  const requester = superAdmin || isRequestRequester(actor, request);
  const manager = superAdmin || isRequestManager(actor, request);
  const custodian = superAdmin || isRequestCustodian(actor, request);
  const actions: StockRequestAction[] = [];

  if (manager && request.status === "submitted") actions.push("review");

  if (
    custodian &&
    (request.status === "approved" ||
      request.status === "awaiting_stock" ||
      request.status === "partially_allocated")
  ) {
    actions.push("allocate");
  }

  if (custodian && (request.status === "partially_allocated" || request.status === "allocated")) {
    actions.push("dispatch");
  }

  if (requester && (request.status === "dispatched" || request.status === "partially_received")) {
    actions.push("receive");
  }

  if (requester && canCancelStockRequest(request.status, request.lines)) {
    actions.push("cancel");
  }

  if (
    request.status !== "exception" &&
    !isTerminalStockRequestStatus(request.status) &&
    (requester || manager || custodian)
  ) {
    actions.push("report_exception");
  }

  // Recovery is a decision about the workflow, so it belongs to the people
  // accountable for it — not to the requester who reported the problem.
  if (request.status === "exception" && (manager || custodian)) {
    actions.push("resolve_exception");
  }

  return actions;
}
