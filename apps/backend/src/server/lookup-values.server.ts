import { isGovernedLookupField } from "@/domain/contracts/reference-data";
import { pool } from "@/server/postgres.server";
import { getAuthContext } from "@/server/livey-service.server";
import type { LookupValueRow } from "@livey/shared/types/lookup-values";

function normalizeFieldName(fieldName: string) {
  return fieldName.trim().toLowerCase();
}

function normalizeValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeValueKey(value: string) {
  return normalizeValue(value).toLowerCase();
}

export type { LookupValueRow };

export async function listLookupValues(fieldName: string) {
  const result = await pool.query(
    `SELECT id, field_name, value, value_key, domain_key, label_snapshot, value_version,
            effective_from, effective_to, retired_at, source, metadata,
            created_by, is_seed, created_at
     FROM lookup_values
     WHERE field_name = $1
     ORDER BY value ASC`,
    [normalizeFieldName(fieldName)],
  );
  return result.rows as LookupValueRow[];
}

export async function upsertLookupValue(fieldName: string, value: string) {
  const normalizedFieldName = normalizeFieldName(fieldName);
  const normalizedValue = normalizeValue(value);
  if (!normalizedValue) {
    throw new Error("Lookup value is required");
  }

  if (isGovernedLookupField(normalizedFieldName)) {
    throw new Error(`Lookup field is governed and cannot be edited here: ${normalizedFieldName}`);
  }

  const { session } = await getAuthContext();
  const createdBy = session?.user.id ?? null;

  const result = await pool.query(
    `INSERT INTO lookup_values (
       field_name,
       value,
       value_key,
       domain_key,
       label_snapshot,
       value_version,
       effective_from,
       source,
       metadata,
       created_by,
       is_seed
     )
     VALUES ($1, $2, $3, $4, $5, 1, CURRENT_DATE, 'manual', '{}'::jsonb, $6, false)
     ON CONFLICT (field_name, value_key) DO UPDATE SET
       value = EXCLUDED.value,
       domain_key = EXCLUDED.domain_key,
       label_snapshot = EXCLUDED.label_snapshot,
       value_version = EXCLUDED.value_version,
       effective_from = EXCLUDED.effective_from,
       source = EXCLUDED.source,
       created_by = COALESCE(lookup_values.created_by, EXCLUDED.created_by)
     RETURNING id, field_name, value, value_key, domain_key, label_snapshot, value_version,
               effective_from, effective_to, retired_at, source, metadata,
               created_by, is_seed, created_at`,
    [
      normalizedFieldName,
      normalizedValue,
      normalizeValueKey(normalizedValue),
      normalizedFieldName,
      normalizedValue,
      createdBy,
    ],
  );

  return result.rows[0] as LookupValueRow;
}
