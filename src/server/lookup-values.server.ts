import { pool } from "@/server/postgres.server";
import { getAuthContext } from "@/server/livey-service.server";

function normalizeFieldName(fieldName: string) {
  return fieldName.trim().toLowerCase();
}

function normalizeValue(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeValueKey(value: string) {
  return normalizeValue(value).toLowerCase();
}

export type LookupValueRow = {
  id: string;
  field_name: string;
  value: string;
  value_key: string;
  created_by: string | null;
  is_seed: boolean;
  created_at: string;
};

export async function listLookupValues(fieldName: string) {
  const result = await pool.query(
    `SELECT id, field_name, value, value_key, created_by, is_seed, created_at
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

  const { session } = await getAuthContext();
  const createdBy = session?.user.id ?? null;

  const result = await pool.query(
    `INSERT INTO lookup_values (field_name, value, value_key, created_by, is_seed)
     VALUES ($1, $2, $3, $4, false)
     ON CONFLICT (field_name, value_key) DO UPDATE SET
       value = EXCLUDED.value,
       created_by = COALESCE(lookup_values.created_by, EXCLUDED.created_by)
     RETURNING id, field_name, value, value_key, created_by, is_seed, created_at`,
    [normalizedFieldName, normalizedValue, normalizeValueKey(normalizedValue), createdBy],
  );

  return result.rows[0] as LookupValueRow;
}
