import { createPool } from "./db";

async function testCrud() {
  const pool = createPool();
  try {
    console.log("Testing Database Connection...");
    const res = await pool.query('SELECT NOW()');
    console.log("✅ Connection successful, server time:", res.rows[0].now);

    console.log("\nTesting CRUD on lookup_values table...");

    // Create
    const fieldName = "test_crud_field";
    const valueKey = "test_key_" + Date.now();
    const value = "Test Value";
    
    console.log(`[Create] Inserting field_name='${fieldName}', value_key='${valueKey}'`);
    const insertRes = await pool.query(
      `INSERT INTO lookup_values (field_name, value, value_key) VALUES ($1, $2, $3) RETURNING id`,
      [fieldName, value, valueKey]
    );
    const newId = insertRes.rows[0].id;
    console.log("✅ Inserted successfully. ID:", newId);

    // Read
    console.log(`[Read] Fetching record with ID: ${newId}`);
    const readRes = await pool.query(
      `SELECT * FROM lookup_values WHERE id = $1`,
      [newId]
    );
    console.log("✅ Fetched successfully. Value:", readRes.rows[0].value);

    // Update
    console.log(`[Update] Updating value to 'Updated Test Value'`);
    await pool.query(
      `UPDATE lookup_values SET value = $1 WHERE id = $2`,
      ["Updated Test Value", newId]
    );
    const checkUpdateRes = await pool.query(
      `SELECT value FROM lookup_values WHERE id = $1`,
      [newId]
    );
    console.log("✅ Updated successfully. New value:", checkUpdateRes.rows[0].value);

    // Delete
    console.log(`[Delete] Deleting record with ID: ${newId}`);
    await pool.query(
      `DELETE FROM lookup_values WHERE id = $1`,
      [newId]
    );
    const checkDeleteRes = await pool.query(
      `SELECT id FROM lookup_values WHERE id = $1`,
      [newId]
    );
    console.log("✅ Deleted successfully. Records found:", checkDeleteRes.rows.length);

  } catch (error) {
    console.error("❌ CRUD Test Failed:", error);
  } finally {
    await pool.end();
  }
}

testCrud();
