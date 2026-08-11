import "dotenv/config";

import { applyMigrations } from "./apply-migrations";
import { createPool } from "./db";
import { TRAINING_PROFILES, TRAINING_VIDEO_ASSERTIONS } from "./training-video-fixtures";

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
      [TRAINING_PROFILES.map((profile) => profile.email)],
    );
    if (profileRows.length !== TRAINING_PROFILES.length) {
      failures.push(
        `training accounts: expected ${TRAINING_PROFILES.length} seeded logins, found ${profileRows.length}`,
      );
    }

    const { rows: partnerAdminRows } = await pool.query(
      `SELECT count(*)::int AS count FROM user_roles WHERE is_seed = true AND role = 'partner_admin'`,
    );
    if (Number(partnerAdminRows[0]?.count ?? 0) !== 2) {
      failures.push(`partner admin roles: expected 2 seeded partner admins`);
    }

    const { rows: partnerUserRows } = await pool.query(
      `SELECT count(*)::int AS count FROM user_roles WHERE is_seed = true AND role = 'partner_user'`,
    );
    if (Number(partnerUserRows[0]?.count ?? 0) !== 6) {
      failures.push(`partner user roles: expected 6 seeded partner users`);
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
  verifyTrainingVideoData().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
