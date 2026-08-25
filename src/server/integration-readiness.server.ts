import { pool } from "@/server/postgres.server";

/**
 * The Integration Operations Centre's read model (product.md §17.2/§17.3).
 *
 * This replaced a hardcoded provider array whose queue depths, dead-letter
 * counts, conflict counts and "2 mins ago" timestamps were all invented in
 * the component, and whose Pause/Resume/Disconnect buttons were a
 * setTimeout that mutated React state and contacted nothing. That page
 * asserted the existence of live adapters this product does not have.
 *
 * What is real today is the durable delivery spine: command_outbox and
 * command_inbox. So that is what this reports — actual rows, actual
 * statuses, actual timestamps. No provider is claimed to be "connected",
 * because no adapter worker exists to connect one, and no control action is
 * offered, because there is nothing to control yet.
 */
export type DeliveryStatusCount = {
  status: string;
  count: number;
};

export type IntegrationDeliverySnapshot = {
  outbox: {
    byStatus: DeliveryStatusCount[];
    total: number;
    oldestPendingAt: string | null;
    maxAttemptCount: number;
  };
  inbox: {
    byStatus: DeliveryStatusCount[];
    total: number;
    oldestUnprocessedAt: string | null;
  };
  /** Distinct event names seen in the outbox, so an operator can tell which
   * domains are actually emitting. Event names are LIVEY-owned identifiers,
   * never provider payloads. */
  recentEventNames: string[];
};

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readCounts(rows: unknown[]): DeliveryStatusCount[] {
  return rows
    .filter(
      (row): row is { status: unknown; count: unknown } => typeof row === "object" && row !== null,
    )
    .map((row) => ({ status: String(row.status ?? "unknown"), count: Number(row.count ?? 0) }))
    .sort((left, right) => left.status.localeCompare(right.status));
}

export async function loadIntegrationDeliverySnapshot(): Promise<IntegrationDeliverySnapshot> {
  const [outboxCounts, outboxMeta, inboxCounts, inboxMeta, eventNames] = await Promise.all([
    pool.query(`SELECT status, COUNT(*)::int AS count FROM command_outbox GROUP BY status`),
    pool.query(
      `SELECT MIN(occurred_at) FILTER (WHERE status = 'pending') AS oldest_pending_at,
              COALESCE(MAX(attempt_count), 0)::int AS max_attempt_count
       FROM command_outbox`,
    ),
    pool.query(`SELECT status, COUNT(*)::int AS count FROM command_inbox GROUP BY status`),
    pool.query(
      `SELECT MIN(received_at) FILTER (WHERE processed_at IS NULL) AS oldest_unprocessed_at
       FROM command_inbox`,
    ),
    pool.query(
      `SELECT event_name FROM command_outbox
       GROUP BY event_name
       ORDER BY MAX(occurred_at) DESC
       LIMIT 12`,
    ),
  ]);

  const outboxByStatus = readCounts(outboxCounts.rows);
  const inboxByStatus = readCounts(inboxCounts.rows);
  const outboxMetaRow = (outboxMeta.rows[0] ?? {}) as {
    oldest_pending_at?: unknown;
    max_attempt_count?: unknown;
  };
  const inboxMetaRow = (inboxMeta.rows[0] ?? {}) as { oldest_unprocessed_at?: unknown };

  return {
    outbox: {
      byStatus: outboxByStatus,
      total: outboxByStatus.reduce((sum, entry) => sum + entry.count, 0),
      oldestPendingAt: toIso(outboxMetaRow.oldest_pending_at),
      maxAttemptCount: Number(outboxMetaRow.max_attempt_count ?? 0),
    },
    inbox: {
      byStatus: inboxByStatus,
      total: inboxByStatus.reduce((sum, entry) => sum + entry.count, 0),
      oldestUnprocessedAt: toIso(inboxMetaRow.oldest_unprocessed_at),
    },
    recentEventNames: (eventNames.rows as Array<{ event_name?: unknown }>).map((row) =>
      String(row.event_name ?? ""),
    ),
  };
}
