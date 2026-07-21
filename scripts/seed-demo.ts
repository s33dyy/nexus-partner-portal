import { Buffer } from "node:buffer";

import bcrypt from "bcryptjs";

import { DEMO_DOCUMENTS, DEMO_FEED_ITEMS, DEMO_METRICS, DEMO_PARTNER_SPOTLIGHTS, DEMO_PARTNERS, DEMO_REVIEW_NOTES, DEMO_USERS } from "../db/demo-seed";
import { createPool } from "./db";
import { clearSeedData } from "./clear-seed";

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function insertRow(
  pool: ReturnType<typeof createPool>,
  table: string,
  columns: string[],
  row: Record<string, unknown>,
) {
  const values = columns.map((column) => row[column]);
  const sql = `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) VALUES (${columns
    .map((_, index) => `$${index + 1}`)
    .join(", ")})`;
  await pool.query(sql, values);
}

export async function seedDemoData() {
  await clearSeedData();

  const pool = createPool();
  try {
    await pool.query("BEGIN");

    for (const user of DEMO_USERS) {
      await insertRow(pool, "profiles", [
        "id",
        "email",
        "password_hash",
        "full_name",
        "phone",
        "company_name",
        "partner_status",
        "is_seed",
      ], {
        id: user.id,
        email: user.email,
        password_hash: await bcrypt.hash(user.password, 10),
        full_name: user.full_name,
        phone: user.phone,
        company_name: user.company_name,
        partner_status: user.partner_status,
        is_seed: user.is_seed,
      });
    }

    for (const user of DEMO_USERS) {
      for (const role of user.roles) {
        await insertRow(pool, "user_roles", ["user_id", "role", "is_seed"], {
          user_id: user.id,
          role,
          is_seed: user.is_seed,
        });
      }
    }

    for (const partner of DEMO_PARTNERS) {
      await insertRow(pool, "partners", [
        "id",
        "owner_user_id",
        "company_name",
        "legal_name",
        "gst_number",
        "pan",
        "cin",
        "website",
        "business_address",
        "country",
        "state",
        "business_type",
        "years_in_business",
        "annual_turnover",
        "employee_count",
        "business_focus",
        "status",
        "tier",
        "is_seed",
      ], partner as Record<string, unknown>);
    }

    const partnerOwnerToId = new Map(DEMO_PARTNERS.map((partner) => [partner.owner_user_id, partner.id]));
    for (const user of DEMO_USERS) {
      const partnerId = partnerOwnerToId.get(user.id) ?? null;
      if (partnerId) {
        await pool.query(`UPDATE profiles SET partner_id = $1 WHERE id = $2`, [partnerId, user.id]);
      }
    }

    for (const doc of DEMO_DOCUMENTS) {
      await insertRow(pool, "document_blobs", [
        "file_path",
        "bucket",
        "file_name",
        "mime_type",
        "size_bytes",
        "file_data",
        "is_seed",
      ], {
        file_path: doc.file_path,
        bucket: "partner-documents",
        file_name: doc.file_name,
        mime_type: doc.mime_type,
        size_bytes: Buffer.byteLength(doc.content, "utf8"),
        file_data: Buffer.from(doc.content, "utf8"),
        is_seed: doc.is_seed,
      });
    }

    for (const doc of DEMO_DOCUMENTS) {
      await insertRow(pool, "partner_documents", [
        "partner_id",
        "uploaded_by",
        "doc_type",
        "file_name",
        "file_path",
        "mime_type",
        "size_bytes",
        "is_seed",
      ], {
        partner_id: doc.partner_id,
        uploaded_by: doc.uploaded_by,
        doc_type: doc.doc_type,
        file_name: doc.file_name,
        file_path: doc.file_path,
        mime_type: doc.mime_type,
        size_bytes: Buffer.byteLength(doc.content, "utf8"),
        is_seed: doc.is_seed,
      });
    }

    for (const note of DEMO_REVIEW_NOTES) {
      await insertRow(pool, "partner_review_notes", [
        "partner_id",
        "author_id",
        "note",
        "status_change",
        "is_seed",
      ], note as Record<string, unknown>);
    }

    for (const metric of DEMO_METRICS) {
      await insertRow(pool, "portal_demo_metrics", [
        "id",
        "label",
        "value",
        "hint",
        "tone",
        "sort_order",
        "is_seed",
      ], {
        ...metric,
        is_seed: true,
      });
    }

    for (const item of DEMO_FEED_ITEMS) {
      await insertRow(pool, "portal_demo_feed_items", [
        "id",
        "title",
        "body",
        "time_label",
        "tone",
        "sort_order",
        "is_seed",
      ], {
        ...item,
        is_seed: true,
      });
    }

    for (const spotlight of DEMO_PARTNER_SPOTLIGHTS) {
      await insertRow(pool, "portal_demo_partner_spotlights", [
        "id",
        "company_name",
        "contact_name",
        "region",
        "tier",
        "pipeline_value",
        "last_activity",
        "status",
        "sort_order",
        "is_seed",
      ], {
        ...spotlight,
        is_seed: true,
      });
    }

    await pool.query("COMMIT");
  } catch (error) {
    await pool.query("ROLLBACK");
    throw error;
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  seedDemoData()
    .then(() => {
      console.log("Demo data seeded");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
