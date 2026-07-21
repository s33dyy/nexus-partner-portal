import "dotenv/config";

import { randomUUID } from "node:crypto";

import bcrypt from "bcryptjs";

import { applyMigrations } from "./apply-migrations";
import { createPool } from "./db";

const ADMIN_EMAIL = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? "admin@livey.tech";
const ADMIN_PASSWORD = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
const ADMIN_NAME = process.env.BOOTSTRAP_SUPER_ADMIN_NAME ?? "LIVEY Super Admin";
const ADMIN_COMPANY = process.env.BOOTSTRAP_SUPER_ADMIN_COMPANY ?? "LIVEY Technologies";

const RESET_TABLES = [
  "password_reset_tokens",
  "sessions",
  "document_blobs",
  "partner_review_notes",
  "partner_documents",
  "partners",
  "user_roles",
  "profiles",
  "portal_deals",
  "portal_customers",
  "portal_catalog_items",
  "portal_team_members",
  "portal_audit_events",
  "portal_news_posts",
] as const;

async function resetDatabase() {
  const pool = createPool();
  try {
    await pool.query("BEGIN");
    await pool.query(`TRUNCATE TABLE ${RESET_TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`);

    if (!ADMIN_PASSWORD) {
      throw new Error("Missing BOOTSTRAP_SUPER_ADMIN_PASSWORD");
    }

    const adminId = randomUUID();
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    await pool.query(
      `INSERT INTO profiles (id, email, password_hash, full_name, phone, company_name, partner_status, is_seed)
       VALUES ($1, $2, $3, $4, $5, $6, 'approved', false)`,
      [adminId, ADMIN_EMAIL, passwordHash, ADMIN_NAME, null, ADMIN_COMPANY],
    );
    await pool.query(
      `INSERT INTO user_roles (user_id, role, is_seed)
       VALUES ($1, 'super_admin', false)`,
      [adminId],
    );

    await pool.query("COMMIT");
    console.log(`Database reset. Super admin created: ${ADMIN_EMAIL}`);
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  } finally {
    await pool.end();
  }
}

export async function bootstrapDb() {
  await applyMigrations();
  await resetDatabase();
}

if (import.meta.main) {
  bootstrapDb()
    .then(() => {
      console.log("Database bootstrapped");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
