import type { PoolClient } from "pg";

import type { CommandEnvelope, OutboxEnvelope } from "@/domain/contracts/commands";
import { pool } from "@/server/postgres.server";

export type TransactionCallback<T> = (tx: PoolClient) => Promise<T>;

/**
 * Anything that can run one parameterised statement — a PoolClient, the pool
 * itself, or a test double. Deliberately structural rather than
 * `Pick<PoolClient, "query">`: PoolClient.query is a five-way overload, so
 * the Pick form cannot be satisfied by a plain object and forces every
 * caller and every test fake into a cast.
 */
export type QueryRunner = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>;
};

export async function withTransaction<T>(callback: TransactionCallback<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function appendOutboxEnvelope(tx: QueryRunner, envelope: OutboxEnvelope) {
  await tx.query(
    `INSERT INTO command_outbox (
       outbox_id,
       event_name,
       schema_version,
       aggregate_type,
       aggregate_id,
       tenant_id,
       organization_tenant_id,
       actor_user_id,
       assignment_id,
       correlation_id,
       idempotency_key,
       payload,
       occurred_at,
       publish_after,
       attempt_count,
       status
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (outbox_id) DO NOTHING`,
    [
      envelope.outboxId,
      envelope.eventName,
      envelope.schemaVersion,
      envelope.aggregateType,
      envelope.aggregateId,
      envelope.tenantId,
      envelope.organizationTenantId,
      envelope.actorUserId,
      envelope.assignmentId,
      envelope.correlationId,
      envelope.idempotencyKey,
      envelope.payload,
      envelope.occurredAt,
      envelope.publishAfter,
      envelope.attemptCount,
      envelope.status,
    ],
  );
}

export async function persistCommandMutationAndOutbox<T>(
  command: CommandEnvelope,
  mutate: (tx: QueryRunner) => Promise<T>,
  outbox: OutboxEnvelope[],
) {
  return withTransaction(async (tx) => {
    const result = await mutate(tx);
    for (const envelope of outbox) {
      await appendOutboxEnvelope(tx, envelope);
    }
    return {
      result,
      commandName: command.commandName,
      correlationId: command.correlationId,
    };
  });
}
