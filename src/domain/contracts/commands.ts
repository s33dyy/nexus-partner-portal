import type { AssignmentStatus, CurrencyCode } from "./taxonomy";
import { createCorrelationId, normalizeCorrelationId } from "./telemetry";

export type CommandChannel = "ui" | "api" | "worker" | "integration" | "import" | "assistant";

export type CommandSource = "server" | "browser" | "scheduled-job" | "provider-webhook";

export type ActiveContextDTO = {
  contextId: string;
  userId: string;
  assignmentId: string;
  assignmentStatus: AssignmentStatus;
  tenantId: string;
  organizationTenantId: string;
  workingScope: string | null;
  issuedAt: string;
  expiresAt: string;
  version: number;
  revocationLink: string | null;
  correlationId: string;
};

export type CommandEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  commandName: string;
  subjectId: string;
  expectedVersion: number;
  actorUserId: string;
  assignmentId: string;
  activeContextId: string;
  tenantId: string;
  organizationTenantId: string;
  workingScope: string | null;
  channel: CommandChannel;
  source: CommandSource;
  correlationId: string;
  idempotencyKey: string | null;
  reason: string | null;
  trustedAt: string;
  payload: TPayload;
};

export type OutboxEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  outboxId: string;
  eventName: string;
  schemaVersion: number;
  aggregateType: string;
  aggregateId: string;
  tenantId: string;
  organizationTenantId: string;
  actorUserId: string;
  assignmentId: string;
  correlationId: string;
  idempotencyKey: string | null;
  payload: TPayload;
  occurredAt: string;
  publishAfter: string | null;
  attemptCount: number;
  status: "pending" | "published" | "failed" | "dead_letter";
};

export type InboxEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  inboxId: string;
  source: string;
  sourceMessageId: string;
  eventName: string;
  schemaVersion: number;
  tenantId: string;
  organizationTenantId: string;
  correlationId: string;
  payload: TPayload;
  receivedAt: string;
  processedAt: string | null;
  status: "pending" | "processed" | "failed" | "ignored";
};

export type OptimisticConcurrencyErrorContract = {
  code: "OPTIMISTIC_CONFLICT";
  message: string;
  subjectId: string;
  expectedVersion: number;
  actualVersion: number;
  retryable: false;
};

export type PolicyDenialErrorContract = {
  code: "POLICY_DENIED";
  message: string;
  subjectId: string | null;
  reason: string;
  retryable: false;
  mayRevealRecordExistence: false;
};

export type CommandFailureContract =
  | {
      code: "VALIDATION_FAILED";
      message: string;
      fieldErrors: Array<{ field: string; message: string }>;
      retryable: false;
    }
  | OptimisticConcurrencyErrorContract
  | PolicyDenialErrorContract
  | {
      code: "TRANSIENT_FAILURE";
      message: string;
      retryable: true;
      retryAfterMs: number;
    };

export type CommandSuccessResult = {
  ok: true;
  commandName: string;
  subjectId: string;
  newVersion: number;
  nextAuthorisedActions: readonly string[];
  correlationId: string;
};

export type CommandExecutionResult =
  | CommandSuccessResult
  | {
      ok: false;
      failure: CommandFailureContract;
      correlationId: string;
    };

export function createCommandEnvelope<TPayload extends Record<string, unknown>>(
  input: Omit<CommandEnvelope<TPayload>, "correlationId" | "trustedAt"> & {
    correlationId?: string | null;
    trustedAt?: string | null;
  },
): CommandEnvelope<TPayload> {
  if (!input.commandName || !input.subjectId) {
    throw new Error("Command envelope requires commandName and subjectId");
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new Error("Command envelope requires a non-negative expectedVersion");
  }
  if (!input.actorUserId || !input.assignmentId || !input.activeContextId) {
    throw new Error("Command envelope requires user, assignment, and context");
  }
  if (!input.tenantId || !input.organizationTenantId) {
    throw new Error("Command envelope requires tenant identifiers");
  }

  return {
    ...input,
    workingScope: input.workingScope ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    reason: input.reason ?? null,
    correlationId: normalizeCorrelationId(input.correlationId ?? undefined),
    trustedAt: input.trustedAt ?? new Date().toISOString(),
    payload: input.payload,
  };
}

export function createOutboxEnvelope<TPayload extends Record<string, unknown>>(
  input: Omit<
    OutboxEnvelope<TPayload>,
    "outboxId" | "correlationId" | "occurredAt" | "attemptCount" | "status"
  > & {
    correlationId?: string | null;
    occurredAt?: string | null;
  },
): OutboxEnvelope<TPayload> {
  if (!input.eventName || !input.aggregateType || !input.aggregateId) {
    throw new Error("Outbox envelope requires eventName, aggregateType, and aggregateId");
  }

  return {
    ...input,
    outboxId: createCorrelationId(),
    correlationId: normalizeCorrelationId(input.correlationId ?? undefined),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    attemptCount: 0,
    status: "pending",
  };
}

export function makePolicyDenial(
  subjectId: string | null,
  reason: string,
): PolicyDenialErrorContract {
  return {
    code: "POLICY_DENIED",
    message: "Access denied",
    subjectId,
    reason,
    retryable: false,
    mayRevealRecordExistence: false,
  };
}

export function makeConcurrencyError(
  subjectId: string,
  expectedVersion: number,
  actualVersion: number,
): OptimisticConcurrencyErrorContract {
  return {
    code: "OPTIMISTIC_CONFLICT",
    message: "Record has changed since it was loaded",
    subjectId,
    expectedVersion,
    actualVersion,
    retryable: false,
  };
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return value === "USD" || value === "INR";
}
