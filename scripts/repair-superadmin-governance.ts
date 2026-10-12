import "dotenv/config";

import { ensureSuperAdminGovernance } from "../src/server/livey-service.server";
import { pool } from "../src/server/postgres.server";

export async function repairSuperAdminGovernance() {
  const { rows } = await pool.query(
    `SELECT DISTINCT p.id, p.email
     FROM profiles p
     JOIN user_roles ur ON ur.user_id = p.id
     WHERE ur.role = 'super_admin'
     ORDER BY p.email`,
  );

  let repaired = 0;
  for (const row of rows as Array<{ id: string; email: string }>) {
    await ensureSuperAdminGovernance(String(row.id));
    repaired += 1;
    console.log(`[repair-superadmin-governance] ensured ${row.email}`);
  }

  console.log(
    `[repair-superadmin-governance] complete: ${repaired} super-admin account(s) checked`,
  );
  return repaired;
}

if (import.meta.main) {
  repairSuperAdminGovernance()
    .then(async () => {
      await pool.end();
    })
    .catch(async (error) => {
      console.error("[repair-superadmin-governance] failed", error);
      await pool.end();
      process.exitCode = 1;
    });
}
