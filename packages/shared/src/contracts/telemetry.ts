export const CORRELATION_ID_HEADER = "x-correlation-id";

const SENSITIVE_KEYS = new Set([
  "password",
  "password_hash",
  "access_token",
  "refresh_token",
  "token",
  "bearer",
  "secret",
  "api_key",
  "client_secret",
  "webhook_secret",
  "raw_access_token",
  "voucher_code",
  "otp",
]);

export function createCorrelationId() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `corr_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

export function normalizeCorrelationId(value: string | null | undefined) {
  const candidate = value?.trim();
  if (
    candidate &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
  ) {
    return candidate.toLowerCase();
  }
  return createCorrelationId();
}

export function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactLogValue(entry));
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.length > 32 && /[A-Za-z0-9_-]{24,}/.test(value)) {
      return "[REDACTED]";
    }
    return value;
  }

  const clone: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.trim().toLowerCase();
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      clone[key] = "[REDACTED]";
      continue;
    }

    clone[key] = redactLogValue(entry);
  }

  return clone;
}
