import "dotenv/config";

import { applyMigrations } from "./apply-migrations";
import { createPool } from "./db";
import {
  TRAINING_ACCOUNTS,
  TRAINING_VIDEO_ASSERTIONS,
} from "./training-video-fixtures";

async function verifyTrainingVideoData() {
  await applyMigrations();

  const pool = createPool();
  const failures: string[] = [];
  const summary: Array<{ key: string; count: number; min: number }> = [];

  try {
    for (const assertion of TRAINING_VIDEO_ASSERTIONS) {
      const { rows } = await pool.query(assertion.sql, assertion.params ?? []);
      const count = Number(rows[0]?.count ?? 0);
      summary.push({ key: assertion.key, count, min: assertion.min });
      if (count < assertion.min) {
        failures.push(`${assertion.label}: expected at least ${assertion.min}, found ${count}`);
      }
    }

    const { rows: profileRows } = await pool.query(
      `SELECT email, partner_status, is_seed
       FROM profiles
       WHERE lower(email) = ANY($1::text[])`,
      [[
        TRAINING_ACCOUNTS.superAdmin.email,
        TRAINING_ACCOUNTS.partnerAdmin.email,
        TRAINING_ACCOUNTS.partnerUser.email,
      ]],
    );
    if (profileRows.length !== 3) {
      failures.push(`training accounts: expected 3 seeded logins, found ${profileRows.length}`);
    }

    if (failures.length > 0) {
      console.error("Training video data verification failed:");
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      console.error("\nCounts:");
      for (const row of summary) {
        console.error(`- ${row.key}: ${row.count} (min ${row.min})`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("Training video data verification passed");
    for (const row of summary) {
      console.log(`- ${row.key}: ${row.count}`);
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  verifyTrainingVideoData()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
