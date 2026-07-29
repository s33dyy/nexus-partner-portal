import {
  AGREEMENT_STATUSES,
  ASSIGNMENT_STATUSES,
  DEAL_STAGES,
  DISCOUNT_REVIEW_STATUSES,
  FULFILLMENT_STATUSES,
  LEAD_STATUSES,
  LEARNING_STATUSES,
  PARTNER_LIFECYCLE_STATUSES,
  PO_REVIEW_STATUSES,
  PROVIDER_CONNECTION_STATUSES,
  REGISTRATION_STATUSES,
  REWARD_STATUSES,
  SHIPMENT_STATUSES,
  TASK_STATUSES,
  TICKET_STATUSES,
  type AgreementStatus,
  type AssignmentStatus,
  type DealStage,
  type DiscountReviewStatus,
  type FulfillmentStatus,
  type LeadStatus,
  type LearningStatus,
  type PartnerLifecycleStatus,
  type PoReviewStatus,
  type ProviderConnectionStatus,
  type RegistrationStatus,
  type RewardStatus,
  type ShipmentStatus,
  type TaskStatus,
  type TicketStatus,
} from "./taxonomy";

type TransitionMetadata = {
  requiredActor: readonly string[];
  guard: string;
  reason: string;
  sideEffects: readonly string[];
  allowSelfTransition?: boolean;
};

export type StateMachineDefinition<State extends string> = {
  name: string;
  states: readonly State[];
  transitions: Record<State, readonly State[]>;
  metadata: Partial<Record<`${State}->${State}`, TransitionMetadata>>;
};

export type StateTransitionCheck<State extends string> = {
  machine: string;
  from: State;
  to: State;
  allowed: boolean;
  reason: string | null;
  guard: string | null;
  requiredActor: readonly string[];
  sideEffects: readonly string[];
};

export function createStateMachine<State extends string>(
  definition: StateMachineDefinition<State>,
) {
  const stateSet = new Set(definition.states);

  function listAllowedTransitions(from: State) {
    return definition.transitions[from] ?? [];
  }

  function checkTransition(from: State, to: State): StateTransitionCheck<State> {
    if (!stateSet.has(from) || !stateSet.has(to)) {
      return {
        machine: definition.name,
        from,
        to,
        allowed: false,
        reason: "Unknown state",
        guard: null,
        requiredActor: [],
        sideEffects: [],
      };
    }

    const metadata = definition.metadata[`${from}->${to}` as `${State}->${State}`];
    const listed = listAllowedTransitions(from).includes(to);
    const allowed = listed && (from !== to || metadata?.allowSelfTransition === true);

    return {
      machine: definition.name,
      from,
      to,
      allowed,
      reason: allowed ? null : `Transition ${from} -> ${to} is not permitted`,
      guard: metadata?.guard ?? null,
      requiredActor: metadata?.requiredActor ?? [],
      sideEffects: metadata?.sideEffects ?? [],
    };
  }

  function assertTransition(from: State, to: State) {
    const check = checkTransition(from, to);
    if (!check.allowed) {
      throw new Error(check.reason ?? `Transition ${from} -> ${to} is not permitted`);
    }
    return check;
  }

  return {
    ...definition,
    listAllowedTransitions,
    checkTransition,
    assertTransition,
  } as const;
}

export const ASSIGNMENT_STATE_MACHINE = createStateMachine<AssignmentStatus>({
  name: "assignment",
  states: ASSIGNMENT_STATUSES,
  transitions: {
    scheduled: ["active", "revoked"],
    active: ["suspended", "ended", "revoked"],
    suspended: ["active", "ended", "revoked"],
    ended: [],
    revoked: [],
  },
  metadata: {
    "scheduled->active": {
      requiredActor: ["super_admin", "rm", "pam", "partner_admin"],
      guard: "effective date reached",
      reason: "Scheduled assignments may become active at their effective time.",
      sideEffects: ["issue-active-context", "record-session-refresh"],
    },
    "active->suspended": {
      requiredActor: ["super_admin", "rm", "pam", "partner_admin"],
      guard: "policy check and revocation",
      reason: "Suspensions must revoke access immediately.",
      sideEffects: ["revoke-sessions", "invalidate-context"],
    },
    "active->ended": {
      requiredActor: ["super_admin", "rm", "pam", "partner_admin"],
      guard: "effective end date or offboarding command",
      reason: "Ended assignments must close access cleanly.",
      sideEffects: ["revoke-sessions", "invalidate-context"],
    },
    "active->revoked": {
      requiredActor: ["super_admin", "rm", "pam", "partner_admin"],
      guard: "security or policy violation",
      reason: "Revocations are security-sensitive and immediate.",
      sideEffects: ["revoke-sessions", "invalidate-context"],
    },
    "suspended->active": {
      requiredActor: ["super_admin", "rm", "pam"],
      guard: "security review complete",
      reason: "Suspended assignments may be restored after review.",
      sideEffects: ["issue-active-context"],
    },
  },
});

export const PARTNER_STATE_MACHINE = createStateMachine<PartnerLifecycleStatus>({
  name: "partner",
  states: PARTNER_LIFECYCLE_STATUSES,
  transitions: {
    pending_partner_registration: ["submitted", "rejected"],
    submitted: ["under_review", "need_more_info", "partial_approval", "rejected"],
    under_review: ["need_more_info", "partial_approval", "pending_agreement", "rejected"],
    need_more_info: ["submitted", "under_review", "rejected"],
    partial_approval: ["pending_agreement", "rejected"],
    pending_agreement: ["signed_pending_review", "approved", "rejected"],
    signed_pending_review: ["approved", "need_more_info", "rejected"],
    approved: [],
    rejected: [],
  },
  metadata: {
    "pending_partner_registration->submitted": {
      requiredActor: ["partner_admin"],
      guard: "registration form completed",
      reason: "A partner can submit after registration data is complete.",
      sideEffects: ["record-submission", "notify-livey"],
    },
    "pending_agreement->approved": {
      requiredActor: ["super_admin", "rm", "pam"],
      guard: "agreement signed and validated",
      reason: "Agreement completion allows approval.",
      sideEffects: ["activate-portal-access", "issue-context"],
    },
  },
});

export const REGISTRATION_STATE_MACHINE = createStateMachine<RegistrationStatus>({
  name: "registration",
  states: REGISTRATION_STATUSES,
  transitions: {
    draft: ["submitted", "rejected"],
    submitted: ["under_review", "need_more_info", "approved", "rejected"],
    under_review: ["need_more_info", "approved", "rejected"],
    need_more_info: ["submitted", "rejected"],
    approved: [],
    rejected: [],
  },
  metadata: {
    "draft->submitted": {
      requiredActor: ["partner_admin", "partner_user"],
      guard: "required fields present",
      reason: "Registration can be submitted once it is complete.",
      sideEffects: ["lock-registration-version"],
    },
  },
});

export const DEAL_STATE_MACHINE = createStateMachine<DealStage>({
  name: "deal",
  states: DEAL_STAGES,
  transitions: {
    sourced: ["demo", "qualified", "lost"],
    demo: ["testing", "qualified", "lost"],
    testing: ["qualified", "proposal", "lost"],
    qualified: ["proposal", "negotiation", "lost"],
    proposal: ["negotiation", "won", "lost"],
    negotiation: ["won", "lost"],
    won: [],
    lost: [],
  },
  metadata: {
    "demo->testing": {
      requiredActor: ["rm", "pam", "kam", "isr"],
      guard: "demo completed",
      reason: "Demo deals may move into testing once the demo is complete.",
      sideEffects: ["record-stage-audit"],
    },
  },
});

export const DISCOUNT_STATE_MACHINE = createStateMachine<DiscountReviewStatus>({
  name: "discount",
  states: DISCOUNT_REVIEW_STATUSES,
  transitions: {
    not_requested: ["pending_review", "approved"],
    pending_review: ["approved", "rejected", "expired"],
    approved: [],
    rejected: [],
    expired: [],
  },
  metadata: {
    "not_requested->pending_review": {
      requiredActor: ["partner_admin", "rm", "pam"],
      guard: "discount request submitted",
      reason: "Requests move into review before approval.",
      sideEffects: ["create-review-task"],
    },
  },
});

export const PO_REVIEW_STATE_MACHINE = createStateMachine<PoReviewStatus>({
  name: "po_review",
  states: PO_REVIEW_STATUSES,
  transitions: {
    not_required: ["closed"],
    requested: ["received", "rejected", "closed"],
    received: ["verified", "rejected", "closed"],
    verified: ["closed"],
    rejected: ["closed"],
    closed: [],
  },
  metadata: {
    "requested->received": {
      requiredActor: ["partner_admin", "partner_user"],
      guard: "purchase order uploaded",
      reason: "A requested PO can be marked received when the file arrives.",
      sideEffects: ["quarantine-file", "notify-reviewer"],
    },
  },
});

export const TASK_STATE_MACHINE = createStateMachine<TaskStatus>({
  name: "task",
  states: TASK_STATUSES,
  transitions: {
    draft: ["queued", "canceled"],
    queued: ["open", "canceled"],
    open: ["in_progress", "blocked", "waiting", "done", "canceled"],
    in_progress: ["blocked", "waiting", "done", "canceled"],
    blocked: ["in_progress", "waiting", "canceled"],
    waiting: ["in_progress", "done", "canceled"],
    done: [],
    canceled: [],
  },
  metadata: {
    "open->in_progress": {
      requiredActor: ["super_admin", "rm", "pam", "kam", "isr", "partner_admin", "partner_user"],
      guard: "task is assigned and ready",
      reason: "Tasks can start when an assignee picks them up.",
      sideEffects: ["record-start-time"],
    },
  },
});

export const TICKET_STATE_MACHINE = createStateMachine<TicketStatus>({
  name: "ticket",
  states: TICKET_STATUSES,
  transitions: {
    open: ["triaged", "canceled"],
    triaged: ["waiting_on_partner", "waiting_on_livey", "resolved", "canceled"],
    waiting_on_partner: ["triaged", "resolved", "canceled"],
    waiting_on_livey: ["triaged", "resolved", "canceled"],
    resolved: ["closed", "reopened"],
    closed: ["reopened"],
    reopened: ["triaged", "waiting_on_partner", "waiting_on_livey", "resolved", "canceled"],
    canceled: [],
  },
  metadata: {
    "open->triaged": {
      requiredActor: ["livey_support"],
      guard: "ticket has enough detail for assignment",
      reason: "Tickets must be triaged before follow-up.",
      sideEffects: ["assign-support-owner"],
    },
  },
});

export const LEAD_STATE_MACHINE = createStateMachine<LeadStatus>({
  name: "lead",
  states: LEAD_STATUSES,
  transitions: {
    new: ["contacted", "qualified", "disqualified"],
    contacted: ["qualified", "disqualified", "converted"],
    qualified: ["converted", "disqualified"],
    converted: [],
    disqualified: [],
  },
  metadata: {
    "new->contacted": {
      requiredActor: ["rm", "pam", "kam", "isr"],
      guard: "lead contact information present",
      reason: "New leads can be contacted once they are validated.",
      sideEffects: ["record-first-touch"],
    },
  },
});

export const LEARNING_STATE_MACHINE = createStateMachine<LearningStatus>({
  name: "learning",
  states: LEARNING_STATUSES,
  transitions: {
    draft: ["published", "archived"],
    published: ["archived"],
    archived: [],
  },
  metadata: {
    "draft->published": {
      requiredActor: ["super_admin", "livey_support"],
      guard: "content reviewed",
      reason: "Learning content must be approved before publication.",
      sideEffects: ["publish-content"],
    },
  },
});

export const REWARD_STATE_MACHINE = createStateMachine<RewardStatus>({
  name: "reward",
  states: REWARD_STATUSES,
  transitions: {
    requested: ["approved", "rejected", "canceled"],
    approved: ["fulfilled", "canceled"],
    fulfilled: [],
    rejected: [],
    canceled: [],
  },
  metadata: {
    "requested->approved": {
      requiredActor: ["super_admin", "livey_support"],
      guard: "reward eligibility validated",
      reason: "Reward requests must be approved before fulfillment.",
      sideEffects: ["emit-point-ledger-entry"],
    },
  },
});

export const SHIPMENT_STATE_MACHINE = createStateMachine<ShipmentStatus>({
  name: "shipment",
  states: SHIPMENT_STATUSES,
  transitions: {
    pending: ["packed", "canceled"],
    packed: ["shipped", "returned", "canceled"],
    shipped: ["delivered", "returned", "lost"],
    delivered: [],
    returned: [],
    lost: [],
  },
  metadata: {
    "packed->shipped": {
      requiredActor: ["super_admin", "logistics"],
      guard: "carrier pickup confirmed",
      reason: "Packed shipments can move to shipped once handed off.",
      sideEffects: ["record-tracking-number"],
    },
  },
});

export const AGREEMENT_STATE_MACHINE = createStateMachine<AgreementStatus>({
  name: "agreement",
  states: AGREEMENT_STATUSES,
  transitions: {
    draft: ["sent", "canceled"],
    sent: ["signed", "pending_review", "expired", "canceled"],
    pending_review: ["active", "expired", "canceled"],
    signed: ["pending_review", "active", "expired", "canceled"],
    active: ["expired", "canceled"],
    expired: [],
    canceled: [],
  },
  metadata: {
    "sent->signed": {
      requiredActor: ["partner_admin", "partner_user"],
      guard: "agreement signature captured",
      reason: "Sent agreements can be signed by the partner.",
      sideEffects: ["persist-signature-audit"],
    },
  },
});

export const PROVIDER_CONNECTION_STATE_MACHINE = createStateMachine<ProviderConnectionStatus>({
  name: "provider_connection",
  states: PROVIDER_CONNECTION_STATUSES,
  transitions: {
    pending: ["connected", "failed", "revoked"],
    connected: ["failed", "revoked"],
    failed: ["pending", "revoked"],
    revoked: [],
  },
  metadata: {
    "pending->connected": {
      requiredActor: ["super_admin", "livey_support"],
      guard: "provider callback validated",
      reason: "Pending provider connections may activate after validation.",
      sideEffects: ["store-provider-credentials"],
    },
  },
});

export const FULFILLMENT_STATE_MACHINE = createStateMachine<FulfillmentStatus>({
  name: "fulfillment",
  states: FULFILLMENT_STATUSES,
  transitions: {
    queued: ["in_progress", "canceled"],
    in_progress: ["fulfilled", "failed", "canceled"],
    fulfilled: [],
    failed: ["queued", "canceled"],
    canceled: [],
  },
  metadata: {
    "queued->in_progress": {
      requiredActor: ["super_admin", "logistics", "livey_support"],
      guard: "fulfillment job claimed",
      reason: "Queued fulfillment items can begin processing.",
      sideEffects: ["publish-fulfillment-job"],
    },
  },
});

export const CANONICAL_STATE_MACHINES = {
  assignment: ASSIGNMENT_STATE_MACHINE,
  partner: PARTNER_STATE_MACHINE,
  registration: REGISTRATION_STATE_MACHINE,
  deal: DEAL_STATE_MACHINE,
  discount: DISCOUNT_STATE_MACHINE,
  po_review: PO_REVIEW_STATE_MACHINE,
  task: TASK_STATE_MACHINE,
  ticket: TICKET_STATE_MACHINE,
  lead: LEAD_STATE_MACHINE,
  learning: LEARNING_STATE_MACHINE,
  reward: REWARD_STATE_MACHINE,
  shipment: SHIPMENT_STATE_MACHINE,
  agreement: AGREEMENT_STATE_MACHINE,
  provider_connection: PROVIDER_CONNECTION_STATE_MACHINE,
  fulfillment: FULFILLMENT_STATE_MACHINE,
} as const;
