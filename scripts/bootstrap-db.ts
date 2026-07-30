import "dotenv/config";

import { applyMigrations } from "./apply-migrations";
import { createPool } from "./db";
import { seedGovernedReferenceData } from "../src/domain/contracts/reference-data";
import { buildFeatureFlagSeedRows } from "../src/domain/contracts/feature-flags";
import { PROD_DEMO_PROFILES } from "./prod-demo-fixtures";
import { seedProdDemoData } from "./prod-demo-seed";

const ADMIN_PASSWORD = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
const ADMIN_EMAIL = PROD_DEMO_PROFILES[0]?.email ?? "maya.admin@livey.tech";

const RESET_TABLES = [
  "lookup_values",
  "password_reset_tokens",
  "sessions",
  "active_contexts",
  "assignment_events",
  "assignments",
  "geography_node_aliases",
  "geography_nodes",
  "governed_tenants",
  "document_blobs",
  "deal_documents",
  "partner_review_notes",
  "partner_documents",
  "partners",
  "portal_customer_activities",
  "portal_deal_collaborators",
  "user_roles",
  "profiles",
  "portal_deals",
  "portal_customers",
  "portal_catalog_items",
  "portal_team_members",
  "portal_audit_events",
  "portal_news_posts",
  "notifications",
  "support_tickets",
  "support_ticket_comments",
  "reward_catalog_items",
  "reward_point_events",
  "reward_redemptions",
] as const;

async function resetDatabase() {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `TRUNCATE TABLE ${RESET_TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );

    if (!ADMIN_PASSWORD) {
      throw new Error("Missing BOOTSTRAP_SUPER_ADMIN_PASSWORD");
    }

    await seedProdDemoData(client, {
      superAdminPassword: ADMIN_PASSWORD,
    });

    await seedGovernedReferenceData(client);

    const featureFlagRows = buildFeatureFlagSeedRows();
    for (const row of featureFlagRows) {
      await client.query(
        `INSERT INTO feature_flags (
           flag_key,
           label,
           enabled,
           owner,
           cohort,
           dependencies,
           metrics,
           expires_at,
           rollback,
           audit_required,
           is_seed
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (flag_key) DO UPDATE SET
           label = EXCLUDED.label,
           enabled = EXCLUDED.enabled,
           owner = EXCLUDED.owner,
           cohort = EXCLUDED.cohort,
           dependencies = EXCLUDED.dependencies,
           metrics = EXCLUDED.metrics,
           expires_at = EXCLUDED.expires_at,
           rollback = EXCLUDED.rollback,
           audit_required = EXCLUDED.audit_required,
           is_seed = EXCLUDED.is_seed`,
        [
          row.flag_key,
          row.label,
          row.enabled,
          row.owner,
          row.cohort,
          row.dependencies,
          row.metrics,
          row.expires_at,
          row.rollback,
          row.audit_required,
          row.is_seed,
        ],
      );
    }

    await client.query("COMMIT");
    console.log(`Database reset. Super admin created: ${ADMIN_EMAIL}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
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
