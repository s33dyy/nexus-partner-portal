import type { Pool } from "pg";

import { buildLookupValueSeedRows } from "@livey/shared/contracts/reference-data";

export async function seedGovernedReferenceData(pool: Pick<Pool, "query">) {
  const seedRows = buildLookupValueSeedRows();
  for (const row of seedRows) {
    await pool.query(
      `INSERT INTO lookup_values (
         field_name,
         value,
         value_key,
         domain_key,
         label_snapshot,
         value_version,
         effective_from,
         effective_to,
         retired_at,
         source,
         metadata,
         is_seed
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (field_name, value_key) DO UPDATE SET
         value = EXCLUDED.value,
         domain_key = EXCLUDED.domain_key,
         label_snapshot = EXCLUDED.label_snapshot,
         value_version = EXCLUDED.value_version,
         effective_from = EXCLUDED.effective_from,
         effective_to = EXCLUDED.effective_to,
         retired_at = EXCLUDED.retired_at,
         source = EXCLUDED.source,
         metadata = EXCLUDED.metadata,
         is_seed = EXCLUDED.is_seed`,
      [
        row.field_name,
        row.value,
        row.value_key,
        row.domain_key,
        row.label_snapshot,
        row.value_version,
        row.effective_from,
        row.effective_to,
        row.retired_at,
        row.source,
        JSON.stringify(row.metadata),
        row.is_seed,
      ],
    );
  }
}
