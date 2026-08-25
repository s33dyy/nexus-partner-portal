import { createServerFn } from "@tanstack/react-start";

import type { CommandExecutionResult } from "@/domain/contracts/commands";
import type {
  AllocateStockRequestInput,
  CancelStockRequestInput,
  CreateStockLocationInput,
  DispatchStockRequestInput,
  PostManualStockMovementInput,
  ReceiveStockRequestInput,
  ReviewStockRequestInput,
  StockRequestExceptionInput,
  SubmitStockRequestInput,
} from "@/domain/contracts/distribution";
import type {
  DistributionExceptionFilters,
  InventoryBalanceFilters,
  InventoryMovementFilters,
  StockLocationFilters,
  StockRequestFilters,
} from "@/server/distribution-queries.server";

/**
 * The Distribution workspace's entire server surface.
 *
 * Every wrapper resolves the authenticated governed actor server-side.
 * Client input never carries an actor role, Assignment id, manager id,
 * tenant, or organisation — those are read from the session, so a crafted
 * request cannot promote itself by naming a different Assignment.
 */

type ActorResult = Awaited<ReturnType<typeof resolveActor>>;

async function resolveActor() {
  const { getAuthContext } = await import("@/server/livey-service.server");
  const { resolveDistributionActor } = await import("@/server/distribution-policy.server");
  const authContext = await getAuthContext();
  return resolveDistributionActor({
    userId: authContext.session?.user.id ?? null,
    assignment: authContext.assignment,
    activeContext: authContext.activeContext,
  });
}

async function denialResult(
  failure: Extract<ActorResult, { ok: false }>["failure"],
): Promise<CommandExecutionResult> {
  const { createCorrelationId } = await import("@/domain/contracts/telemetry");
  return { ok: false, failure, correlationId: createCorrelationId() };
}

function readDenial<TRow>(failure: Extract<ActorResult, { ok: false }>["failure"]) {
  return { ok: false as const, failure, rows: [] as TRow[], total: 0 };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const listStockRequestsFn = createServerFn({ method: "POST" })
  .validator((input: StockRequestFilters) => input)
  .handler(async ({ data }) => {
    const actor = await resolveActor();
    if (!actor.ok) return readDenial(actor.failure);
    const { listStockRequests } = await import("@/server/distribution-queries.server");
    return listStockRequests(actor.actor, data);
  });

const getStockRequestFn = createServerFn({ method: "POST" })
  .validator((input: { requestId: string }) => input)
  .handler(async ({ data }) => {
    const actor = await resolveActor();
    if (!actor.ok) return { ok: false as const, failure: actor.failure };
    const { getStockRequest } = await import("@/server/distribution-queries.server");
    return getStockRequest(actor.actor, data.requestId);
  });

const listInventoryBalancesFn = createServerFn({ method: "POST" })
  .validator((input: InventoryBalanceFilters) => input)
  .handler(async ({ data }) => {
    const actor = await resolveActor();
    if (!actor.ok) return readDenial(actor.failure);
    const { listInventoryBalances } = await import("@/server/distribution-queries.server");
    return listInventoryBalances(actor.actor, data);
  });

const listInventoryMovementsFn = createServerFn({ method: "POST" })
  .validator((input: InventoryMovementFilters) => input)
  .handler(async ({ data }) => {
    const actor = await resolveActor();
    if (!actor.ok) return readDenial(actor.failure);
    const { listInventoryMovements } = await import("@/server/distribution-queries.server");
    return listInventoryMovements(actor.actor, data);
  });

const listDistributionExceptionsFn = createServerFn({ method: "POST" })
  .validator((input: DistributionExceptionFilters) => input)
  .handler(async ({ data }) => {
    const actor = await resolveActor();
    if (!actor.ok) return readDenial(actor.failure);
    const { listDistributionExceptions } = await import("@/server/distribution-queries.server");
    return listDistributionExceptions(actor.actor, data);
  });

const listRequestableProductSkusFn = createServerFn({ method: "POST" })
  .validator((input: { query?: string | null }) => input)
  .handler(async ({ data }) => {
    const actor = await resolveActor();
    if (!actor.ok) return readDenial(actor.failure);
    const { listRequestableProductSkus } = await import("@/server/distribution-queries.server");
    return listRequestableProductSkus(actor.actor, data.query ?? null);
  });

const listStockLocationsFn = createServerFn({ method: "POST" })
  .validator((input: StockLocationFilters) => input)
  .handler(async ({ data }) => {
    const actor = await resolveActor();
    if (!actor.ok) return readDenial(actor.failure);
    const { listStockLocations } = await import("@/server/distribution-queries.server");
    return listStockLocations(actor.actor, data);
  });

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const submitStockRequestFn = createServerFn({ method: "POST" })
  .validator((input: SubmitStockRequestInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actor = await resolveActor();
    if (!actor.ok) return denialResult(actor.failure);
    const { submitStockRequest } = await import("@/server/distribution-commands.server");
    return submitStockRequest({ actor: actor.actor, data });
  });

const reviewStockRequestFn = createServerFn({ method: "POST" })
  .validator((input: ReviewStockRequestInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actor = await resolveActor();
    if (!actor.ok) return denialResult(actor.failure);
    const { reviewStockRequest } = await import("@/server/distribution-commands.server");
    return reviewStockRequest({ actor: actor.actor, data });
  });

const allocateStockRequestFn = createServerFn({ method: "POST" })
  .validator((input: AllocateStockRequestInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actor = await resolveActor();
    if (!actor.ok) return denialResult(actor.failure);
    const { allocateStockRequest } = await import("@/server/distribution-commands.server");
    return allocateStockRequest({ actor: actor.actor, data });
  });

const dispatchStockRequestFn = createServerFn({ method: "POST" })
  .validator((input: DispatchStockRequestInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actor = await resolveActor();
    if (!actor.ok) return denialResult(actor.failure);
    const { dispatchStockRequest } = await import("@/server/distribution-commands.server");
    return dispatchStockRequest({ actor: actor.actor, data });
  });

const receiveStockRequestFn = createServerFn({ method: "POST" })
  .validator((input: ReceiveStockRequestInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actor = await resolveActor();
    if (!actor.ok) return denialResult(actor.failure);
    const { receiveStockRequest } = await import("@/server/distribution-commands.server");
    return receiveStockRequest({ actor: actor.actor, data });
  });

const cancelStockRequestFn = createServerFn({ method: "POST" })
  .validator((input: CancelStockRequestInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actor = await resolveActor();
    if (!actor.ok) return denialResult(actor.failure);
    const { cancelStockRequest } = await import("@/server/distribution-commands.server");
    return cancelStockRequest({ actor: actor.actor, data });
  });

const reportStockRequestExceptionFn = createServerFn({ method: "POST" })
  .validator((input: StockRequestExceptionInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actor = await resolveActor();
    if (!actor.ok) return denialResult(actor.failure);
    const { reportStockRequestException } = await import("@/server/distribution-commands.server");
    return reportStockRequestException({ actor: actor.actor, data });
  });

const resolveStockRequestExceptionFn = createServerFn({ method: "POST" })
  .validator((input: StockRequestExceptionInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actor = await resolveActor();
    if (!actor.ok) return denialResult(actor.failure);
    const { resolveStockRequestException } = await import("@/server/distribution-commands.server");
    return resolveStockRequestException({ actor: actor.actor, data });
  });

const createStockLocationFn = createServerFn({ method: "POST" })
  .validator((input: CreateStockLocationInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actor = await resolveActor();
    if (!actor.ok) return denialResult(actor.failure);
    const { createStockLocation } = await import("@/server/distribution-commands.server");
    return createStockLocation({ actor: actor.actor, data });
  });

const retireStockLocationFn = createServerFn({ method: "POST" })
  .validator((input: { locationId: string; expectedVersion: number; reason: string }) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actor = await resolveActor();
    if (!actor.ok) return denialResult(actor.failure);
    const { retireStockLocation } = await import("@/server/distribution-commands.server");
    return retireStockLocation({ actor: actor.actor, ...data });
  });

const postManualStockMovementFn = createServerFn({ method: "POST" })
  .validator((input: PostManualStockMovementInput) => input)
  .handler(async ({ data }): Promise<CommandExecutionResult> => {
    const actor = await resolveActor();
    if (!actor.ok) return denialResult(actor.failure);
    const { postManualStockMovement } = await import("@/server/distribution-commands.server");
    return postManualStockMovement({ actor: actor.actor, data });
  });

// ---------------------------------------------------------------------------
// Named wrappers
// ---------------------------------------------------------------------------

export async function listStockRequests(filters: StockRequestFilters = {}) {
  return listStockRequestsFn({ data: filters });
}
export async function getStockRequest(requestId: string) {
  return getStockRequestFn({ data: { requestId } });
}
export async function listInventoryBalances(filters: InventoryBalanceFilters = {}) {
  return listInventoryBalancesFn({ data: filters });
}
export async function listInventoryMovements(filters: InventoryMovementFilters = {}) {
  return listInventoryMovementsFn({ data: filters });
}
export async function listDistributionExceptions(filters: DistributionExceptionFilters = {}) {
  return listDistributionExceptionsFn({ data: filters });
}
export async function listRequestableProductSkus(query: string | null = null) {
  return listRequestableProductSkusFn({ data: { query } });
}
export async function listStockLocations(filters: StockLocationFilters = {}) {
  return listStockLocationsFn({ data: filters });
}

export async function submitStockRequest(input: SubmitStockRequestInput) {
  return submitStockRequestFn({ data: input });
}
export async function reviewStockRequest(input: ReviewStockRequestInput) {
  return reviewStockRequestFn({ data: input });
}
export async function allocateStockRequest(input: AllocateStockRequestInput) {
  return allocateStockRequestFn({ data: input });
}
export async function dispatchStockRequest(input: DispatchStockRequestInput) {
  return dispatchStockRequestFn({ data: input });
}
export async function receiveStockRequest(input: ReceiveStockRequestInput) {
  return receiveStockRequestFn({ data: input });
}
export async function cancelStockRequest(input: CancelStockRequestInput) {
  return cancelStockRequestFn({ data: input });
}
export async function reportStockRequestException(input: StockRequestExceptionInput) {
  return reportStockRequestExceptionFn({ data: input });
}
export async function resolveStockRequestException(input: StockRequestExceptionInput) {
  return resolveStockRequestExceptionFn({ data: input });
}
export async function createStockLocation(input: CreateStockLocationInput) {
  return createStockLocationFn({ data: input });
}
export async function retireStockLocation(input: {
  locationId: string;
  expectedVersion: number;
  reason: string;
}) {
  return retireStockLocationFn({ data: input });
}
export async function postManualStockMovement(input: PostManualStockMovementInput) {
  return postManualStockMovementFn({ data: input });
}
