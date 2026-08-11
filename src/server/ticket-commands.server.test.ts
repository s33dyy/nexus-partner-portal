import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import type { TicketCommandActor } from "@/server/ticket-commands.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

const ISSUED_AT = "2026-07-30T00:00:00.000Z";
const REQUESTER_USER_ID = "22222222-2222-2222-2222-222222222222";

function buildAssignment(overrides: Partial<AssignmentRecord> = {}): AssignmentRecord {
  return {
    assignmentId: "assignment-1",
    userId: "11111111-1111-1111-1111-111111111111",
    tenantId: "tenant-livey-org",
    organizationTenantId: "tenant-livey-org",
    roleKey: "super_admin",
    teamDomain: "identity",
    geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    partnerId: null,
    accountId: null,
    portfolioId: null,
    queueId: null,
    status: "active",
    validFrom: ISSUED_AT,
    validTo: null,
    managerAssignmentId: null,
    source: "test",
    approverUserId: null,
    predecessorAssignmentId: null,
    successorAssignmentId: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: ISSUED_AT,
    updatedAt: ISSUED_AT,
    version: 1,
    isSeed: true,
    ...overrides,
  };
}

function buildActiveContext(
  assignment: AssignmentRecord,
  overrides: Partial<ActiveContextRecord> = {},
): ActiveContextRecord {
  return {
    contextId: "context-1",
    userId: assignment.userId,
    assignmentId: assignment.assignmentId,
    assignmentStatus: assignment.status,
    tenantId: assignment.tenantId,
    organizationTenantId: assignment.organizationTenantId,
    workingScope: null,
    issuedAt: ISSUED_AT,
    expiresAt: "2026-07-30T08:00:00.000Z",
    version: 1,
    revocationLink: null,
    correlationId: "corr-1",
    assignmentVersion: assignment.version,
    workingScopeNodeId: null,
    revokedAt: null,
    revocationReason: null,
    isSeed: true,
    createdAt: ISSUED_AT,
    updatedAt: ISSUED_AT,
    ...overrides,
  };
}

function buildActor(overrides: Partial<AssignmentRecord> = {}): TicketCommandActor {
  const assignment = buildAssignment(overrides);
  return {
    userId: assignment.userId,
    assignment,
    activeContext: buildActiveContext(assignment),
  };
}

type TicketRow = {
  id: string;
  status: string;
  partner_id: string | null;
  created_by: string | null;
  subject: string;
};

function baseTicketRow(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: "ticket-1",
    status: "open",
    partner_id: "partner-1",
    created_by: REQUESTER_USER_ID,
    subject: "Shipment delayed",
    ...overrides,
  };
}

function installFakePool(ticketRow: TicketRow | null) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const calls: string[] = [];
    const updateCalls: Array<{ sql: string; params: unknown[] }> = [];
    let currentRow = ticketRow;

    const fakeClient = {
      query: async (sql: string, params?: unknown[]) => {
        const verb = sql.trim().split(/\s+/)[0]?.toUpperCase();
        calls.push(verb);

        if (verb === "SELECT") {
          return { rows: currentRow ? [currentRow] : [], rowCount: currentRow ? 1 : 0 };
        }
        if (verb === "UPDATE" && sql.includes("support_tickets")) {
          updateCalls.push({ sql, params: params ?? [] });
          if (currentRow) {
            currentRow = { ...currentRow, status: String(params?.[1]) };
          }
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => undefined,
    };

    const originalConnect = pool.connect.bind(pool);
    pool.connect = (async () => fakeClient) as typeof pool.connect;

    return {
      calls,
      updateCalls,
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

test("acceptTicket denies a non-support role", async () => {
  const harness = await installFakePool(baseTicketRow())();
  try {
    const { acceptTicket } = await import("@/server/ticket-commands.server");
    const actor = buildActor({
      roleKey: "partner_admin",
      teamDomain: "partner_success",
      partnerId: "partner-1",
    });
    const result = await acceptTicket({ actor, ticketId: "ticket-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});

test("acceptTicket succeeds for super_admin and moves open to in_progress", async () => {
  const harness = await installFakePool(baseTicketRow({ status: "open" }))();
  try {
    const { acceptTicket } = await import("@/server/ticket-commands.server");
    const actor = buildActor();
    const result = await acceptTicket({ actor, ticketId: "ticket-1" });
    expect(result.ok).toBe(true);
    expect(harness.updateCalls[0]?.params[1]).toBe("in_progress");
  } finally {
    harness.restore();
  }
});

test("closeTicket denies a partner user", async () => {
  const harness = await installFakePool(baseTicketRow({ status: "in_progress" }))();
  try {
    const { closeTicket } = await import("@/server/ticket-commands.server");
    const actor = buildActor({
      roleKey: "partner_user",
      teamDomain: "partner_success",
      partnerId: "partner-1",
    });
    const result = await closeTicket({ actor, ticketId: "ticket-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});

test("closeTicket succeeds for livey_support from in_progress", async () => {
  const harness = await installFakePool(baseTicketRow({ status: "in_progress" }))();
  try {
    const { closeTicket } = await import("@/server/ticket-commands.server");
    const actor = buildActor({ roleKey: "livey_support", teamDomain: "support" });
    const result = await closeTicket({ actor, ticketId: "ticket-1" });
    expect(result.ok).toBe(true);
    expect(harness.updateCalls[0]?.params[1]).toBe("closed");
  } finally {
    harness.restore();
  }
});

test("requestReopen denies a user who did not create the ticket", async () => {
  const harness = await installFakePool(
    baseTicketRow({ status: "closed", created_by: REQUESTER_USER_ID }),
  )();
  try {
    const { requestReopen } = await import("@/server/ticket-commands.server");
    const actor = buildActor({
      roleKey: "partner_user",
      teamDomain: "partner_success",
      partnerId: "partner-1",
    });
    const result = await requestReopen({ actor, ticketId: "ticket-1", reason: "Still broken" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});

test("requestReopen requires a non-empty reason", async () => {
  const harness = await installFakePool(baseTicketRow({ status: "closed" }))();
  try {
    const { requestReopen } = await import("@/server/ticket-commands.server");
    const actor = buildActor({ userId: REQUESTER_USER_ID });
    const result = await requestReopen({ actor, ticketId: "ticket-1", reason: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("VALIDATION_FAILED");
  } finally {
    harness.restore();
  }
});

test("requestReopen succeeds for the requester from closed", async () => {
  const harness = await installFakePool(
    baseTicketRow({ status: "closed", created_by: REQUESTER_USER_ID }),
  )();
  try {
    const { requestReopen } = await import("@/server/ticket-commands.server");
    const actor = buildActor({
      userId: REQUESTER_USER_ID,
      roleKey: "partner_user",
      teamDomain: "partner_success",
      partnerId: "partner-1",
    });
    const result = await requestReopen({ actor, ticketId: "ticket-1", reason: "Still broken" });
    expect(result.ok).toBe(true);
    expect(harness.updateCalls[0]?.params[1]).toBe("reopen_requested");
  } finally {
    harness.restore();
  }
});

test("decideReopen approve moves reopen_requested back to open and requires a support role", async () => {
  const harness = await installFakePool(baseTicketRow({ status: "reopen_requested" }))();
  try {
    const { decideReopen } = await import("@/server/ticket-commands.server");
    const partnerActor = buildActor({
      roleKey: "partner_admin",
      teamDomain: "partner_success",
      partnerId: "partner-1",
    });
    const denied = await decideReopen({ actor: partnerActor, ticketId: "ticket-1", approve: true });
    expect(denied.ok).toBe(false);

    const supportActor = buildActor({ roleKey: "livey_support", teamDomain: "support" });
    const approved = await decideReopen({
      actor: supportActor,
      ticketId: "ticket-1",
      approve: true,
    });
    expect(approved.ok).toBe(true);
    expect(harness.updateCalls.at(-1)?.params[1]).toBe("open");
  } finally {
    harness.restore();
  }
});

test("§2.4: addTicketReply denies a restricted_distributor who did not create the ticket", async () => {
  const harness = await installFakePool(
    baseTicketRow({ status: "open", partner_id: "partner-1", created_by: "someone-else" }),
  )();
  try {
    const { addTicketReply } = await import("@/server/ticket-commands.server");
    const actor = buildActor({ roleKey: "restricted_distributor", partnerId: "partner-1" });
    const result = await addTicketReply({
      actor,
      data: { ticketId: "ticket-1", body: "Any update?" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});

test("§2.4: addTicketReply allows a restricted_distributor who created the ticket themselves", async () => {
  const harness = await installFakePool(
    baseTicketRow({ status: "open", partner_id: "partner-1", created_by: REQUESTER_USER_ID }),
  )();
  try {
    const { addTicketReply } = await import("@/server/ticket-commands.server");
    const actor = buildActor({
      userId: REQUESTER_USER_ID,
      roleKey: "restricted_distributor",
      partnerId: "partner-1",
    });
    const result = await addTicketReply({
      actor,
      data: { ticketId: "ticket-1", body: "Any update?" },
    });
    expect(result.ok).toBe(true);
  } finally {
    harness.restore();
  }
});

test("addTicketReply rejects replying to a closed ticket", async () => {
  const harness = await installFakePool(baseTicketRow({ status: "closed" }))();
  try {
    const { addTicketReply } = await import("@/server/ticket-commands.server");
    const actor = buildActor({ userId: REQUESTER_USER_ID });
    const result = await addTicketReply({
      actor,
      data: { ticketId: "ticket-1", body: "Any update?" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("VALIDATION_FAILED");
  } finally {
    harness.restore();
  }
});

test("addTicketReply denies a partner posting an internal note", async () => {
  const harness = await installFakePool(baseTicketRow({ status: "open" }))();
  try {
    const { addTicketReply } = await import("@/server/ticket-commands.server");
    const actor = buildActor({
      userId: REQUESTER_USER_ID,
      roleKey: "partner_user",
      teamDomain: "partner_success",
      partnerId: "partner-1",
    });
    const result = await addTicketReply({
      actor,
      data: { ticketId: "ticket-1", body: "Marking this internal", isInternal: true },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
  } finally {
    harness.restore();
  }
});

test("addTicketReply allows livey_support to post an internal note", async () => {
  const harness = await installFakePool(baseTicketRow({ status: "open" }))();
  try {
    const { addTicketReply } = await import("@/server/ticket-commands.server");
    const actor = buildActor({ roleKey: "livey_support" });
    const result = await addTicketReply({
      actor,
      data: { ticketId: "ticket-1", body: "Internal triage note", isInternal: true },
    });
    expect(result.ok).toBe(true);
  } finally {
    harness.restore();
  }
});

test("addTicketReply from the partner returns a waiting ticket to in_progress", async () => {
  const harness = await installFakePool(baseTicketRow({ status: "waiting_on_partner" }))();
  try {
    const { addTicketReply } = await import("@/server/ticket-commands.server");
    const actor = buildActor({
      userId: REQUESTER_USER_ID,
      roleKey: "partner_user",
      teamDomain: "partner_success",
      partnerId: "partner-1",
    });
    const result = await addTicketReply({
      actor,
      data: { ticketId: "ticket-1", body: "Here is the info you asked for" },
    });
    expect(result.ok).toBe(true);
    expect(harness.updateCalls[0]?.params[1]).toBe("in_progress");
  } finally {
    harness.restore();
  }
});

test("addTicketReply on an open ticket leaves status unchanged", async () => {
  const harness = await installFakePool(baseTicketRow({ status: "open" }))();
  try {
    const { addTicketReply } = await import("@/server/ticket-commands.server");
    const actor = buildActor();
    const result = await addTicketReply({
      actor,
      data: { ticketId: "ticket-1", body: "Looking into this" },
    });
    expect(result.ok).toBe(true);
    expect(harness.updateCalls[0]?.params[1]).toBe("open");
  } finally {
    harness.restore();
  }
});
