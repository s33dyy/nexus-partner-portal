type WorkflowDbClient = {
  from(table: string): {
    insert(values: Record<string, unknown> | Array<Record<string, unknown>>): any;
  };
};

function makeId() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

export async function recordNotification(
  db: WorkflowDbClient,
  input: {
    userId?: string | null;
    partnerId?: string | null;
    title: string;
    message: string;
    type: string;
    read?: boolean;
  },
) {
  return db.from("notifications").insert({
    id: makeId(),
    user_id: input.userId ?? null,
    partner_id: input.partnerId ?? null,
    title: input.title,
    message: input.message,
    type: input.type,
    read: input.read ?? false,
    created_at: new Date().toISOString(),
  });
}

export async function recordAuditEvent(
  db: WorkflowDbClient,
  input: {
    actorName: string;
    actorRole: string;
    action: string;
    targetType: string;
    targetName: string;
    outcome: string;
    details: string;
    severity?: string;
  },
) {
  return db.from("portal_audit_events").insert({
    id: makeId(),
    actor_name: input.actorName,
    actor_role: input.actorRole,
    action: input.action,
    target_type: input.targetType,
    target_name: input.targetName,
    outcome: input.outcome,
    details: input.details,
    severity: input.severity ?? "low",
    is_seed: false,
    created_at: new Date().toISOString(),
  });
}
