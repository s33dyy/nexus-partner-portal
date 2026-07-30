import { expect, test } from "bun:test";

import { createCommandEnvelope, createOutboxEnvelope } from "@/domain/contracts/commands";

test("command mutation and outbox persistence are wrapped in one transaction", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";

  const { pool } = await import("@/server/postgres.server");
  const { persistCommandMutationAndOutbox } = await import("@/server/command-runtime.server");

  const originalConnect = pool.connect.bind(pool);
  const calls: string[] = [];
  const fakeClient = {
    query: async (sql: string) => {
      calls.push(sql.trim().split(/\s+/)[0]);
      return { rows: [], rowCount: 1 };
    },
    release: () => undefined,
  };

  pool.connect = (async () => fakeClient) as typeof pool.connect;

  try {
    const command = createCommandEnvelope({
      commandName: "deal.win",
      subjectId: "deal-1",
      expectedVersion: 1,
      actorUserId: "11111111-1111-1111-1111-111111111111",
      assignmentId: "assignment-1",
      activeContextId: "context-1",
      tenantId: "tenant-1",
      organizationTenantId: "tenant-1",
      workingScope: null,
      channel: "ui",
      source: "server",
      idempotencyKey: "idem-1",
      reason: "test",
      payload: {},
    });

    const outbox = [
      createOutboxEnvelope({
        eventName: "deal.won",
        schemaVersion: 1,
        aggregateType: "deal",
        aggregateId: "deal-1",
        tenantId: "tenant-1",
        organizationTenantId: "tenant-1",
        actorUserId: "11111111-1111-1111-1111-111111111111",
        assignmentId: "assignment-1",
        idempotencyKey: "idem-1",
        payload: { stage: "won" },
        publishAfter: null,
      }),
    ];

    const result = await persistCommandMutationAndOutbox(
      command,
      async (tx) => {
        await tx.query("UPDATE portal_deals SET stage = 'won' WHERE id = 'deal-1'");
        return { saved: true };
      },
      outbox,
    );

    expect(result.commandName).toBe("deal.win");
    expect(calls).toEqual(["BEGIN", "UPDATE", "INSERT", "COMMIT"]);
  } finally {
    pool.connect = originalConnect as typeof pool.connect;
  }
});
