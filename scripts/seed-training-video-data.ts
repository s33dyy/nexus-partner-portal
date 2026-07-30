import "dotenv/config";

import { File } from "node:buffer";
import { Buffer } from "node:buffer";

import bcrypt from "bcryptjs";

import { applyMigrations } from "./apply-migrations";
import { createPool } from "./db";
import {
  TRAINING_ACCOUNTS,
  TRAINING_AUDIT_EVENTS,
  TRAINING_CUSTOMERS,
  TRAINING_DEALS,
  TRAINING_NEWS_POSTS,
  TRAINING_PARTNER_DOCUMENTS,
  TRAINING_PARTNERS,
  TRAINING_PROFILES,
  TRAINING_REWARD_CATALOG_ITEMS,
  TRAINING_REWARD_POINT_EVENTS,
  TRAINING_REWARD_REDEMPTIONS,
  TRAINING_TEAM_MEMBERS,
  TRAINING_USER_ROLES,
} from "./training-video-fixtures";
import { uploadDocumentBlob } from "../src/server/livey-service.server.ts";

type SeedRow = Record<string, unknown>;

function quoteIdent(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function toColumns(row: SeedRow) {
  return Object.keys(row);
}

async function upsertById(pool: ReturnType<typeof createPool>, table: string, row: SeedRow) {
  const columns = toColumns(row);
  const values = columns.map((column) => row[column]);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const assignments = columns
    .filter((column) => column !== "id" && column !== "created_at")
    .map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`)
    .join(", ");

  await pool.query(
    `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${assignments}`,
    values,
  );
}

async function upsertProfile(
  pool: ReturnType<typeof createPool>,
  profile: (typeof TRAINING_PROFILES)[number],
) {
  const passwordHash = await bcrypt.hash(profile.password, 10);
  const { rows } = await pool.query(
    `INSERT INTO profiles (id, email, password_hash, full_name, phone, company_name, partner_id, partner_status, is_seed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       full_name = EXCLUDED.full_name,
       phone = EXCLUDED.phone,
       company_name = EXCLUDED.company_name,
       partner_id = EXCLUDED.partner_id,
       partner_status = EXCLUDED.partner_status,
       is_seed = true
     RETURNING id`,
    [
      profile.id,
      profile.email,
      passwordHash,
      profile.full_name,
      profile.phone,
      profile.company_name,
      profile.partner_id,
      profile.partner_status,
    ],
  );
  return rows[0]?.id as string;
}

async function upsertUserRole(
  pool: ReturnType<typeof createPool>,
  role: (typeof TRAINING_USER_ROLES)[number],
  userId: string,
) {
  await pool.query(
    `INSERT INTO user_roles (id, user_id, role, is_seed)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (user_id, role) DO UPDATE SET
       is_seed = true`,
    [userId, userId, role.role],
  );
}

async function seedDocumentBlob(
  pool: ReturnType<typeof createPool>,
  partnerId: string,
  fileName: string,
  filePath: string,
  blobText: string,
) {
  const fileBuffer = Buffer.from(blobText);
  const upload = await uploadDocumentBlob({
    bucket: "partner-documents",
    filePath,
    fileName,
    mimeType: "application/pdf",
    file: new File([fileBuffer], fileName.toLowerCase().replace(/\s+/g, "-"), {
      type: "application/pdf",
    }),
    isSeed: true,
  });
  return {
    partner_id: partnerId,
    file_name: fileName,
    file_path: upload.path,
    mime_type: "application/pdf",
    size_bytes: fileBuffer.byteLength,
  };
}

async function seedTrainingVideoData() {
  await applyMigrations();

  const pool = createPool();
  try {
    const seededProfileIds = new Map<string, string>();
    for (const profile of TRAINING_PROFILES) {
      const actualId = await upsertProfile(pool, profile);
      seededProfileIds.set(profile.email, actualId);
      const role = TRAINING_USER_ROLES.find((entry) => entry.user_id === profile.id);
      if (!role) {
        throw new Error(`Missing role fixture for profile ${profile.email}`);
      }
      await upsertUserRole(pool, role, actualId);
    }

    for (const partner of Object.values(TRAINING_PARTNERS)) {
      await upsertById(pool, "partners", partner);
    }

    const approvedPartnerDocument = await seedDocumentBlob(
      pool,
      TRAINING_PARTNERS.approved.id,
      "GST Certificate.pdf",
      `${TRAINING_PARTNERS.approved.id}/gst-certificate.pdf`,
      "LIVEY training fixture",
    );
    const submittedPartnerDocument = await seedDocumentBlob(
      pool,
      TRAINING_PARTNERS.submitted.id,
      "GST Certificate.pdf",
      `${TRAINING_PARTNERS.submitted.id}/gst-certificate.pdf`,
      "LIVEY training fixture for partner review",
    );

    await upsertById(pool, "partner_documents", {
      id: TRAINING_PARTNER_DOCUMENTS[0].id,
      partner_id: TRAINING_PARTNER_DOCUMENTS[0].partner_id,
      uploaded_by: TRAINING_PARTNER_DOCUMENTS[0].uploaded_by,
      doc_type: TRAINING_PARTNER_DOCUMENTS[0].doc_type,
      file_name: TRAINING_PARTNER_DOCUMENTS[0].file_name,
      file_path: TRAINING_PARTNER_DOCUMENTS[0].file_path,
      mime_type: approvedPartnerDocument.mime_type,
      size_bytes: approvedPartnerDocument.size_bytes,
      is_seed: true,
      created_at: new Date().toISOString(),
    });
    await upsertById(pool, "partner_documents", {
      id: TRAINING_PARTNER_DOCUMENTS[1].id,
      partner_id: TRAINING_PARTNER_DOCUMENTS[1].partner_id,
      uploaded_by: TRAINING_PARTNER_DOCUMENTS[1].uploaded_by,
      doc_type: TRAINING_PARTNER_DOCUMENTS[1].doc_type,
      file_name: TRAINING_PARTNER_DOCUMENTS[1].file_name,
      file_path: TRAINING_PARTNER_DOCUMENTS[1].file_path,
      mime_type: submittedPartnerDocument.mime_type,
      size_bytes: submittedPartnerDocument.size_bytes,
      is_seed: true,
      created_at: new Date().toISOString(),
    });

    for (const customer of TRAINING_CUSTOMERS) {
      await upsertById(pool, "portal_customers", customer as SeedRow);
    }

    for (const deal of TRAINING_DEALS) {
      await upsertById(pool, "portal_deals", deal as SeedRow);
    }

    for (const member of TRAINING_TEAM_MEMBERS) {
      await upsertById(pool, "portal_team_members", member as SeedRow);
    }

    for (const reward of TRAINING_REWARD_CATALOG_ITEMS) {
      await upsertById(pool, "reward_catalog_items", reward as SeedRow);
    }

    for (const event of TRAINING_REWARD_POINT_EVENTS) {
      await upsertById(pool, "reward_point_events", {
        ...event,
        approved_by:
          event.approved_by === TRAINING_PROFILES[0].id
            ? (seededProfileIds.get(TRAINING_ACCOUNTS.superAdmin.email) ?? TRAINING_PROFILES[0].id)
            : event.approved_by,
      });
    }

    for (const redemption of TRAINING_REWARD_REDEMPTIONS) {
      await upsertById(pool, "reward_redemptions", {
        ...redemption,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    for (const post of TRAINING_NEWS_POSTS) {
      await upsertById(pool, "portal_news_posts", {
        ...post,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    for (const event of TRAINING_AUDIT_EVENTS) {
      await upsertById(pool, "portal_audit_events", {
        ...event,
        created_at: new Date().toISOString(),
      });
    }

    console.log("Training video data seeded");
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  seedTrainingVideoData().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
