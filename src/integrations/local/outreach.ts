import { createServerFn } from "@tanstack/react-start";

import type {
  CommandExecutionResult,
  PolicyDenialErrorContract,
} from "@/domain/contracts/commands";
import type { OutreachSequenceStatus, SequenceStepDraft } from "@/domain/contracts/outreach";
import type {
  CreateSequenceInput,
  EnrollContactsInput,
  EnrollContactsResult,
  SaveSequenceStepsInput,
} from "@/server/outreach-commands.server";
import type {
  EnrollmentView,
  ExecutionView,
  OutreachCustomerOption,
  OutreachReadResult,
  SequenceDetail,
  SequenceListItem,
} from "@/server/outreach-queries.server";

/**
 * The outreach workspace's entire server surface.
 *
 * Every handler below opens with its own dynamic import of
 * `resolveOutreachActorFromSession` rather than calling a shared
 * module-level helper. That is deliberate: the TanStack plugin strips
 * `handler()` bodies out of the client bundle, so a server import inside one
 * is erased — while the same import in a module-level helper survives and
 * drags the session, pool, and policy layer into the browser graph, which
 * Vite's import protection rejects outright. The repetition is what keeps
 * this wrapper module client-safe.
 *
 * Client input never carries an actor id, role, Assignment, or tenant —
 * those are read from the session, so a crafted request cannot enrol
 * somebody else's contacts by naming a different owner.
 */

async function denialResult(failure: PolicyDenialErrorContract): Promise<CommandExecutionResult> {
  const { createCorrelationId } = await import("@/domain/contracts/telemetry");
  return { ok: false, failure, correlationId: createCorrelationId() };
}

function readDenial<T>(failure: PolicyDenialErrorContract): OutreachReadResult<T> {
  return { ok: false, failure };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const listSequencesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<OutreachReadResult<SequenceListItem[]>> => {
    const { resolveOutreachActorFromSession } = await import("@/server/outreach-actor.server");
    const actor = await resolveOutreachActorFromSession();
    if (!actor.ok) return readDenial<SequenceListItem[]>(actor.failure);
    const { listSequences } = await import("@/server/outreach-queries.server");
    return listSequences(actor.actor);
  },
);

const getSequenceDetailFn = createServerFn({ method: "POST" })
  .validator((input: { sequenceId: string }) => input)
  .handler(async ({ data }): Promise<OutreachReadResult<SequenceDetail>> => {
    const { resolveOutreachActorFromSession } = await import("@/server/outreach-actor.server");
    const actor = await resolveOutreachActorFromSession();
    if (!actor.ok) return readDenial<SequenceDetail>(actor.failure);
    const { getSequenceDetail } = await import("@/server/outreach-queries.server");
    return getSequenceDetail(actor.actor, data.sequenceId);
  });

const getEnrollmentTimelineFn = createServerFn({ method: "POST" })
  .validator((input: { enrollmentId: string }) => input)
  .handler(async ({ data }): Promise<OutreachReadResult<ExecutionView[]>> => {
    const { resolveOutreachActorFromSession } = await import("@/server/outreach-actor.server");
    const actor = await resolveOutreachActorFromSession();
    if (!actor.ok) return readDenial<ExecutionView[]>(actor.failure);
    const { getEnrollmentTimeline } = await import("@/server/outreach-queries.server");
    return getEnrollmentTimeline(actor.actor, data.enrollmentId);
  });

const listOutreachCustomersFn = createServerFn({ method: "POST" })
  .validator((input: { search: string }) => input)
  .handler(async ({ data }): Promise<OutreachReadResult<OutreachCustomerOption[]>> => {
    const { resolveOutreachActorFromSession } = await import("@/server/outreach-actor.server");
    const actor = await resolveOutreachActorFromSession();
    if (!actor.ok) return readDenial<OutreachCustomerOption[]>(actor.failure);
    const { listOutreachCustomers } = await import("@/server/outreach-queries.server");
    return listOutreachCustomers(actor.actor, data.search);
  });

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const createSequenceFn = createServerFn({ method: "POST" })
  .validator((input: CreateSequenceInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const { resolveOutreachActorFromSession } = await import("@/server/outreach-actor.server");
    const actor = await resolveOutreachActorFromSession();
    if (!actor.ok) return denialResult(actor.failure);
    const { createSequence } = await import("@/server/outreach-commands.server");
    return createSequence({ actor: actor.actor, data });
  });

const saveSequenceStepsFn = createServerFn({ method: "POST" })
  .validator((input: SaveSequenceStepsInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const { resolveOutreachActorFromSession } = await import("@/server/outreach-actor.server");
    const actor = await resolveOutreachActorFromSession();
    if (!actor.ok) return denialResult(actor.failure);
    const { saveSequenceSteps } = await import("@/server/outreach-commands.server");
    return saveSequenceSteps({ actor: actor.actor, data });
  });

const setSequenceStatusFn = createServerFn({ method: "POST" })
  .validator(
    (input: { sequenceId: string; expectedVersion: number; toStatus: OutreachSequenceStatus }) =>
      input,
  )
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const { resolveOutreachActorFromSession } = await import("@/server/outreach-actor.server");
    const actor = await resolveOutreachActorFromSession();
    if (!actor.ok) return denialResult(actor.failure);
    const { setSequenceStatus } = await import("@/server/outreach-commands.server");
    return setSequenceStatus({
      actor: actor.actor,
      sequenceId: data.sequenceId,
      expectedVersion: data.expectedVersion,
      toStatus: data.toStatus,
    });
  });

const enrollContactsFn = createServerFn({ method: "POST" })
  .validator((input: EnrollContactsInput) => input)
  .handler(async ({ data }): Promise<EnrollContactsResult> => {
    const { resolveOutreachActorFromSession } = await import("@/server/outreach-actor.server");
    const actor = await resolveOutreachActorFromSession();
    if (!actor.ok) {
      const { createCorrelationId } = await import("@/domain/contracts/telemetry");
      return { ok: false, correlationId: createCorrelationId(), failure: actor.failure };
    }
    const { enrollContacts } = await import("@/server/outreach-commands.server");
    return enrollContacts({ actor: actor.actor, data });
  });

const unenrollContactFn = createServerFn({ method: "POST" })
  .validator((input: { enrollmentId: string; expectedVersion: number; reasonKey: string }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const { resolveOutreachActorFromSession } = await import("@/server/outreach-actor.server");
    const actor = await resolveOutreachActorFromSession();
    if (!actor.ok) return denialResult(actor.failure);
    const { unenrollContact } = await import("@/server/outreach-commands.server");
    return unenrollContact({
      actor: actor.actor,
      enrollmentId: data.enrollmentId,
      expectedVersion: data.expectedVersion,
      reasonKey: data.reasonKey,
    });
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listSequences(): Promise<OutreachReadResult<SequenceListItem[]>> {
  return listSequencesFn();
}

export async function getSequenceDetail(
  sequenceId: string,
): Promise<OutreachReadResult<SequenceDetail>> {
  return getSequenceDetailFn({ data: { sequenceId } });
}

export async function getEnrollmentTimeline(
  enrollmentId: string,
): Promise<OutreachReadResult<ExecutionView[]>> {
  return getEnrollmentTimelineFn({ data: { enrollmentId } });
}

export async function listOutreachCustomers(
  search: string,
): Promise<OutreachReadResult<OutreachCustomerOption[]>> {
  return listOutreachCustomersFn({ data: { search } });
}

export async function createSequence(input: CreateSequenceInput): Promise<CommandExecutionResult> {
  return createSequenceFn({ data: input });
}

export async function saveSequenceSteps(
  input: SaveSequenceStepsInput,
): Promise<CommandExecutionResult> {
  return saveSequenceStepsFn({ data: input });
}

export async function setSequenceStatus(input: {
  sequenceId: string;
  expectedVersion: number;
  toStatus: OutreachSequenceStatus;
}): Promise<CommandExecutionResult> {
  return setSequenceStatusFn({ data: input });
}

export async function enrollContacts(input: EnrollContactsInput): Promise<EnrollContactsResult> {
  return enrollContactsFn({ data: input });
}

export async function unenrollContact(input: {
  enrollmentId: string;
  expectedVersion: number;
  reasonKey: string;
}): Promise<CommandExecutionResult> {
  return unenrollContactFn({ data: input });
}

export type {
  EnrollmentView,
  ExecutionView,
  OutreachCustomerOption,
  SequenceDetail,
  SequenceListItem,
  SequenceStepDraft,
};
