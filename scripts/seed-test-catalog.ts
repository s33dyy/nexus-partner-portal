import { pool } from "../src/server/postgres.server";

const TEST_PREFIX = "0000000c-0000-4000-8000-";

const TEST_PRODUCTS = [
  ["TEST-PART-001", "TEST USB-C Dock", "Hardware", "product", "$120", 12],
  ["TEST-PART-002", "TEST 4K Webcam", "Hardware", "product", "$180", 8],
  ["TEST-PART-003", "TEST Wireless Headset", "Hardware", "product", "$95", 20],
  ["TEST-PART-004", "TEST Meeting Room Kit", "Hardware", "combo", "$450", 5],
  ["TEST-PART-005", "TEST Laptop Stand Bundle", "Hardware", "combo", "$160", 15],
  ["TEST-PART-006", "TEST Partner CRM License", "Software", "product", "$240", 50],
  ["TEST-PART-007", "TEST Analytics Add-on", "Software", "product", "$90", 35],
  ["TEST-PART-008", "TEST Onboarding Pack", "Software", "combo", "$300", 10],
  ["TEST-PART-009", "TEST Support Essentials", "Software", "combo", "$175", 18],
  ["TEST-PART-010", "TEST Collaboration Suite", "Software", "product", "$520", 7],
] as const;

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [
      index,
      [sku, productName, category, catalogKind, listPrice, stock],
    ] of TEST_PRODUCTS.entries()) {
      await client.query(
        `INSERT INTO portal_catalog_items (
           id, sku, product_name, category, partner_tier, list_price, margin, stock,
           availability, benefits, catalog_kind, product_status, currency_code, is_seed
         ) VALUES ($1,$2,$3,$4,'Registered',$5,'20%',$6,'In stock',$7,$8,'active','USD',TRUE)
         ON CONFLICT (id) DO UPDATE SET
           sku = EXCLUDED.sku,
           product_name = EXCLUDED.product_name,
           category = EXCLUDED.category,
           partner_tier = EXCLUDED.partner_tier,
           list_price = EXCLUDED.list_price,
           margin = EXCLUDED.margin,
           stock = EXCLUDED.stock,
           availability = EXCLUDED.availability,
           benefits = EXCLUDED.benefits,
           catalog_kind = EXCLUDED.catalog_kind,
           product_status = EXCLUDED.product_status,
           currency_code = EXCLUDED.currency_code,
           is_seed = TRUE,
           updated_at = now()`,
        [
          `${TEST_PREFIX}${String(index + 1).padStart(12, "0")}`,
          sku,
          productName,
          category,
          listPrice,
          stock,
          `Test catalogue fixture: ${productName}`,
          catalogKind,
        ],
      );
    }
    await client.query("COMMIT");
    const result = await client.query(
      `SELECT count(*)::int AS count
       FROM portal_catalog_items
       WHERE sku LIKE 'TEST-PART-%'`,
    );
    console.log(`[seed-test-catalog] ensured ${result.rows[0]?.count ?? 0} test products`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[seed-test-catalog] failed", error);
  process.exitCode = 1;
});
