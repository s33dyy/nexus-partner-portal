import { createPool } from "./db";

export async function clearSeedData() {
  const pool = createPool();
  try {
    await pool.query("BEGIN");
    await pool.query("DELETE FROM password_reset_tokens");
    await pool.query("DELETE FROM document_blobs WHERE is_seed = true");
    await pool.query("DELETE FROM partner_review_notes WHERE is_seed = true");
    await pool.query("DELETE FROM partners WHERE is_seed = true");
    await pool.query("DELETE FROM user_roles WHERE is_seed = true");
    await pool.query("DELETE FROM profiles WHERE is_seed = true");
    await pool.query("DELETE FROM portal_demo_metrics WHERE is_seed = true");
    await pool.query("DELETE FROM portal_demo_feed_items WHERE is_seed = true");
    await pool.query("DELETE FROM portal_demo_partner_spotlights WHERE is_seed = true");
    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  clearSeedData()
    .then(() => {
      console.log("Seed data cleared");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
