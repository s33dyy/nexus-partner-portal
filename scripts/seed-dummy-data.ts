import { Pool } from "pg";
import * as crypto from "crypto";
import * as bcrypt from "bcryptjs";

// Initialize the local Postgres pool using local development DB
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/livey_crm",
});

const DUMMY_PDF_URL = "https://res.cloudinary.com/dkcrxu8cc/raw/upload/v1784706256/partner-documents/6a1b1a82-2ae9-47f3-8afc-c9a671db06c1/GST_Certificate_1784706256131.pdf";

// The livey backend stores Cloudinary metadata in file_data, not the raw binary
const dummyCloudinaryData = Buffer.from(
  JSON.stringify({
    publicId: "partner-documents/6a1b1a82-2ae9-47f3-8afc-c9a671db06c1",
    secureUrl: "https://res.cloudinary.com/dkcrxu8cc/raw/upload/v1784706256/partner-documents/6a1b1a82-2ae9-47f3-8afc-c9a671db06c1/GST_Certificate_1784706256131.pdf",
    resourceType: "raw",
    version: 1784706256,
    format: "pdf"
  }),
  "utf8"
);

function randomId() {
  return crypto.randomUUID();
}

async function seed() {
  console.log("Starting seeder...");

  // Cloudinary metadata buffer ready

  const numPartners = 5;
  const numUsersPerPartner = 5;
  const numDealsPerPartner = 10;
  
  const superAdminId = "00000000-0000-0000-0000-000000000000"; 
  let actualSuperAdminId = superAdminId;
  const saRes = await pool.query(`SELECT id FROM profiles WHERE partner_status = 'approved' AND id IN (SELECT user_id FROM user_roles WHERE role = 'super_admin') LIMIT 1`);
  if (saRes.rows.length > 0) {
    actualSuperAdminId = saRes.rows[0].id;
  } else {
    actualSuperAdminId = randomId();
    const hash = await bcrypt.hash("password123", 10);
    await pool.query(`
      INSERT INTO profiles (id, email, password_hash, full_name, partner_status, is_seed) 
      VALUES ($1, 'superadmin_dummy@livey.tech', $2, 'Super Admin Dummy', 'approved', true)
      ON CONFLICT DO NOTHING
    `, [actualSuperAdminId, hash]);
    await pool.query(`INSERT INTO user_roles (user_id, role, is_seed) VALUES ($1, 'super_admin', true) ON CONFLICT DO NOTHING`, [actualSuperAdminId]);
  }

  for (let i = 1; i <= numPartners; i++) {
    const partnerId = randomId();
    const companyName = `Dummy Partner ${i} Corp`;
    
    console.log(`Creating Partner: ${companyName}`);
    
    const adminId = randomId();
    const adminPasswordHash = await bcrypt.hash("password123", 10);
    const isApproved = i % 2 === 0;
    const pStatus = isApproved ? "approved" : "rejected";

    // 1. Create the admin user first (so we can use them as owner)
    await pool.query(`
      INSERT INTO profiles (id, email, password_hash, full_name, company_name, partner_status, is_seed)
      VALUES ($1, $2, $3, $4, $5, $6, true)
    `, [
      adminId,
      `admin${i}@dummypartner.com`,
      adminPasswordHash,
      `Admin User ${i}`,
      companyName,
      pStatus
    ]);

    await pool.query(`
      INSERT INTO user_roles (user_id, role, is_seed)
      VALUES ($1, 'partner_admin', true)
    `, [adminId]);

    // 2. Create the partner record
    await pool.query(`
      INSERT INTO partners (id, owner_user_id, company_name, legal_name, gst_number, pan, business_type, status, is_seed)
      VALUES ($1, $2, $3, $4, 'GST-${i}000', 'PAN-${i}000', 'VAR', $5, true)
    `, [partnerId, adminId, companyName, `${companyName} LLC`, pStatus]);

    // 3. Update admin user to set partner_id
    await pool.query(`
      UPDATE profiles SET partner_id = $1 WHERE id = $2
    `, [partnerId, adminId]);

    const filePath = `partner-documents/${partnerId}/GST_Certificate_${Date.now()}.pdf`;
    await pool.query(`
      INSERT INTO document_blobs (file_path, bucket, file_name, mime_type, size_bytes, file_data, is_seed)
      VALUES ($1, 'partner-documents', 'GST_Certificate.pdf', 'application/pdf', $2, $3, true)
    `, [filePath, 250000, dummyCloudinaryData]);
    
    // (The partner documents logic remains unchanged above this)

    await pool.query(`
      INSERT INTO portal_team_members (id, company_name, full_name, email, role_title, portal_role, responsibility, status, last_active, phone, permissions, is_seed)
      VALUES ($1, $2, $3, $4, 'Partner Admin', 'partner_admin', 'All Operations', 'active', 'Just now', '555-010${i}', '{"deals","documents","team"}', true)
    `, [adminId, companyName, `Admin User ${i}`, `admin${i}@dummypartner.com`]);

    await pool.query(`
      INSERT INTO partner_documents (partner_id, uploaded_by, doc_type, file_name, file_path, mime_type, size_bytes, is_seed)
      VALUES ($1, $2, 'Tax Document', 'GST_Certificate.pdf', $3, 'application/pdf', $4, true)
    `, [partnerId, adminId, filePath, 250000]);

    const statusNote = isApproved ? "Approved after reviewing GST cert." : "Rejected: GST cert is invalid or expired.";
    await pool.query(`
      INSERT INTO partner_review_notes (partner_id, author_id, note, status_change, is_seed)
      VALUES ($1, $2, $3, $4, true)
    `, [partnerId, actualSuperAdminId, statusNote, pStatus]);

    await pool.query(`
      INSERT INTO notifications (user_id, partner_id, title, message, type, read)
      VALUES ($1, $2, $3, $4, 'system', false)
    `, [adminId, partnerId, isApproved ? "Partner Approved" : "Partner Rejected", statusNote]);

    for (let j = 1; j <= numUsersPerPartner; j++) {
      const userId = randomId();
      await pool.query(`
        INSERT INTO profiles (id, email, password_hash, full_name, company_name, partner_id, partner_status, is_seed)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true)
      `, [
        userId,
        `user${i}_${j}@dummypartner.com`,
        adminPasswordHash, 
        `Staff User ${i}-${j}`,
        companyName,
        partnerId,
        pStatus
      ]);

      await pool.query(`
        INSERT INTO user_roles (user_id, role, is_seed)
        VALUES ($1, 'partner_user', true)
      `, [userId]);

      await pool.query(`
        INSERT INTO portal_team_members (id, company_name, full_name, email, role_title, portal_role, responsibility, status, last_active, phone, permissions, is_seed)
        VALUES ($1, $2, $3, $4, 'Sales Rep', 'partner_user', 'Sales', 'active', 'Just now', '555-020${j}', '{"deals"}', true)
      `, [userId, companyName, `Staff User ${i}-${j}`, `user${i}_${j}@dummypartner.com`]);
    }

    for (let k = 1; k <= numDealsPerPartner; k++) {
      const dealId = randomId();
      const stage = k % 3 === 0 ? "won" : k % 3 === 1 ? "lost" : "sourced";
      const status = stage === "won" || stage === "lost" ? stage : "active";
      
      await pool.query(`
        INSERT INTO portal_deals (
          id, account_name, contact_name, owner_name, region, product, stage, status, amount, probability, close_date, source, last_touch, notes, user_id, partner_id, is_seed
        ) VALUES (
          $1, $2, $3, $4, 'North America', 'LIVEY Pro', $5, $6, $7, $8, '2027-01-01', 'Partner Sourced', 'Initial call', 'Dummy notes', $9, $10, true
        )
      `, [
        dealId,
        `Customer Account ${k} (via ${companyName})`,
        `Contact ${k}`,
        `Admin User ${i}`,
        stage,
        status,
        `${k * 10},000`, 
        stage === "won" ? 100 : stage === "lost" ? 0 : 50,
        adminId,
        partnerId
      ]);

      await pool.query(`
        INSERT INTO portal_news_posts (id, title, caption, image_path, image_alt, posted_by_name, posted_by_role, is_seed)
        VALUES ($1, $2, $3, '', 'Deal', $4, 'Partner', true)
      `, [
        randomId(),
        `New Deal Sourced by ${companyName}`,
        `A new opportunity for LIVEY Pro has entered the pipeline!`,
        companyName
      ]);

      if (stage === "won") {
        await pool.query(`
          INSERT INTO portal_news_posts (id, title, caption, image_path, image_alt, posted_by_name, posted_by_role, is_seed)
          VALUES ($1, $2, $3, '', 'Deal won', $4, 'Partner', true)
        `, [
          randomId(),
          `Goal Reached by ${companyName}!`,
          `A deal for LIVEY Pro was successfully closed won. Outstanding work!`,
          companyName
        ]);
      }
    }
  }

  console.log("Seeding complete!");
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
