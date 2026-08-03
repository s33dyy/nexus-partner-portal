import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import bcrypt from "bcryptjs";
import { deleteCookie, getCookie, getRequestUrl, setCookie } from "@tanstack/react-start/server";
import type { PoolClient } from "pg";

import {
  GOVERNANCE_GEOGRAPHY_NODE_IDS,
  GOVERNANCE_TENANT_IDS,
  issueActiveContextFromAssignment,
  type ActiveContextRecord,
  type AssignmentRecord,
} from "@/domain/contracts/governance";
import { pool } from "@/server/postgres.server";
import { applyTablePolicy, type TablePolicyAuthContext } from "@/server/table-policy.server";
import type { PartnerStatus } from "@/lib/partner-status";
import {
  deleteFromCloudinary,
  hasCloudinaryConfig,
  uploadToCloudinary,
} from "@/server/cloudinary.server";

import { ROLE_KEYS, type RoleKey } from "@/domain/contracts/taxonomy";

export type AppRole = RoleKey;
export type { PartnerStatus };

export type LocalUser = {
  id: string;
  email: string;
  user_metadata: {
    full_name: string;
    phone: string | null;
    company_name: string | null;
  };
};

export type LocalSession = {
  access_token: string;
  expires_at: number;
  user: LocalUser;
};

type WorkspaceUserInput = {
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  password: string;
  role: AppRole;
  partner_status?: PartnerStatus;
  partner_id?: string;
  must_reset_password?: boolean;
};

type QueryFilter = {
  column: string;
  value: unknown;
  operator: "eq" | "in";
};

type QueryOrder = {
  column: string;
  ascending?: boolean;
};

export type TableQuery = {
  table: string;
  operation: "select" | "insert" | "update" | "delete" | "count";
  filters?: QueryFilter[];
  order?: QueryOrder;
  values?: Record<string, unknown> | Array<Record<string, unknown>>;
  single?: "single" | "maybeSingle" | null;
  limit?: number;
  // A caller-supplied ".select(...)" comma-separated column list. "*" (the
  // default) is unchanged — SELECT *. Anything narrower is honored exactly:
  // the caller who deliberately left a column out (e.g. profiles callers
  // omitting password_hash) actually gets it left out now, instead of the
  // server always returning every column regardless of what was asked for.
  select?: string;
  // Set only by the policy layer (never client-supplied) when a single
  // ownership column can't express a read scope — e.g. tasks visible to
  // whoever created OR was assigned them.
  scopeAnyColumnEquals?: { columns: [string, string]; value: string };
  // Same idea, for "I own it OR I'm an active tagged participant on it" —
  // see table-policy.server.ts's isRestrictedPartnerRole.
  scopeOwnerOrParticipantTag?: {
    ownerColumn: string;
    ownerValue: string;
    participantTable: "deal_participants" | "customer_participants";
    fkColumn: "deal_id" | "customer_id";
  };
};

const TABLE_COLUMNS: Record<string, string[]> = {
  profiles: [
    "id",
    "email",
    "password_hash",
    "full_name",
    "phone",
    "company_name",
    "avatar_url",
    "partner_id",
    "partner_status",
    "must_reset_password",
    "google_id",
    "google_email",
    "google_linked_at",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  user_roles: ["id", "user_id", "role", "is_seed", "created_at"],
  governed_tenants: [
    "tenant_id",
    "tenant_kind",
    "display_name",
    "parent_tenant_id",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  geography_nodes: [
    "node_id",
    "tenant_id",
    "organization_tenant_id",
    "node_code",
    "node_type",
    "display_name",
    "parent_node_id",
    "valid_from",
    "valid_to",
    "version",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  geography_node_aliases: [
    "alias_id",
    "node_id",
    "legacy_value",
    "valid_from",
    "valid_to",
    "source",
    "is_seed",
    "created_at",
  ],
  assignments: [
    "assignment_id",
    "user_id",
    "tenant_id",
    "organization_tenant_id",
    "role_key",
    "team_domain",
    "geography_ceiling_node_id",
    "partner_id",
    "account_id",
    "portfolio_id",
    "queue_id",
    "manager_assignment_id",
    "source",
    "approver_user_id",
    "status",
    "predecessor_assignment_id",
    "successor_assignment_id",
    "valid_from",
    "valid_to",
    "revoked_at",
    "revocation_reason",
    "version",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  assignment_events: [
    "event_id",
    "assignment_id",
    "actor_user_id",
    "actor_assignment_id",
    "action",
    "reason",
    "before_state",
    "after_state",
    "effective_at",
    "predecessor_assignment_id",
    "successor_assignment_id",
    "session_revocation_result",
    "correlation_id",
    "is_seed",
    "created_at",
  ],
  active_contexts: [
    "context_id",
    "user_id",
    "assignment_id",
    "tenant_id",
    "organization_tenant_id",
    "working_scope",
    "issued_at",
    "expires_at",
    "version",
    "revocation_link",
    "revoked_at",
    "revocation_reason",
    "correlation_id",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  partners: [
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
    "agreement_envelope_id",
    "agreement_sent_at",
    "agreement_signed_at",
    "agreement_source_doc_path",
    "agreement_signed_doc_path",
    "agreement_provider",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  partner_documents: [
    "id",
    "partner_id",
    "uploaded_by",
    "doc_type",
    "file_name",
    "file_path",
    "mime_type",
    "size_bytes",
    "is_seed",
    "created_at",
  ],
  deal_documents: [
    "id",
    "deal_id",
    "partner_id",
    "uploaded_by",
    "doc_type",
    "file_name",
    "file_path",
    "mime_type",
    "size_bytes",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  partner_review_notes: [
    "id",
    "partner_id",
    "author_id",
    "note",
    "status_change",
    "is_seed",
    "created_at",
  ],
  portal_deals: [
    "id",
    "account_name",
    "customer_id",
    "contact_name",
    "poc_profile_id",
    "owner_name",
    "country",
    "region",
    "product",
    "stage",
    "status",
    "quantity",
    "amount",
    "currency_code",
    "amount_value",
    "amount_usd",
    "fx_rate",
    "fx_provider",
    "fx_rate_fetched_at",
    "customer_budget",
    "probability",
    "possible_close_date",
    "close_date",
    "source",
    "last_touch",
    "notes",
    "user_id",
    "partner_id",
    "is_hidden_to_team",
    "reward_rate_percent",
    "version",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  portal_deal_collaborators: [
    "id",
    "deal_id",
    "user_id",
    "split_percent",
    "sort_order",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  portal_customers: [
    "id",
    "company_name",
    "account_owner",
    "country",
    "region",
    "segment",
    "health_score",
    "mrr",
    "renewal_date",
    "status",
    "next_step",
    "last_touch",
    "domain",
    "phone",
    "tax_registration_id",
    "provider_customer_id",
    "address",
    "origin",
    "duplicate_review_status",
    "master_customer_id",
    "merged_into_customer_id",
    "merged_at",
    "merge_reason",
    "external_ids",
    "user_id",
    "partner_id",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  portal_customer_activities: [
    "id",
    "customer_id",
    "partner_id",
    "actor_id",
    "actor_name",
    "summary",
    "next_step",
    "created_at",
  ],
  customer_participants: [
    "id",
    "customer_id",
    "partner_id",
    "participant_type",
    "source",
    "actor_id",
    "participant_user_id",
    "reason",
    "valid_from",
    "valid_to",
    "provenance",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  deal_line_items: [
    "id",
    "deal_id",
    "product_id",
    "quantity",
    "msrp_usd",
    "ptp_usd",
    "discount_pct",
    "dtp_usd",
    "proposed_selling_price_usd",
    "reward_eligible",
    "snapshot_at",
    "created_at",
    "updated_at",
  ],
  learning_tracks: [
    "id",
    "title",
    "description",
    "status",
    "created_at",
    "updated_at",
    "is_published",
    "tier_requirement",
  ],
  learning_subjects: [
    "id",
    "track_id",
    "title",
    "description",
    "status",
    "sort_order",
    "created_at",
    "updated_at",
    "order_index",
  ],
  learning_lessons: [
    "id",
    "course_id",
    "title",
    "content_url",
    "content_body",
    "content_type",
    "duration_minutes",
    "status",
    "sort_order",
    "created_at",
    "updated_at",
    "subject_id",
    "order_index",
    "is_required",
  ],
  learning_enrollments: [
    "id",
    "user_id",
    "track_id",
    "status",
    "score_percent",
    "completed_at",
    "created_at",
    "updated_at",
    "certificate_token",
    "is_certified",
    "progress_percent",
  ],
  learning_assessments: ["id", "subject_id", "title", "passing_score", "created_at", "updated_at"],
  learning_assessment_attempts: [
    "id",
    "assessment_id",
    "user_id",
    "score",
    "is_passed",
    "created_at",
  ],
  learning_lesson_progress: ["id", "user_id", "lesson_id", "completed_at", "created_at"],
  deal_participants: [
    "id",
    "deal_id",
    "partner_id",
    "participant_type",
    "source",
    "actor_id",
    "participant_user_id",
    "reason",
    "valid_from",
    "valid_to",
    "provenance",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  customer_merge_events: [
    "id",
    "partner_id",
    "surviving_customer_id",
    "merged_customer_id",
    "redirect_customer_id",
    "before_state",
    "after_state",
    "external_id_snapshot",
    "scope_restrictions",
    "reason",
    "actor_id",
    "is_seed",
    "created_at",
  ],
  portal_catalog_items: [
    "id",
    "sku",
    "product_name",
    "category",
    "partner_tier",
    "list_price",
    "margin",
    "stock",
    "availability",
    "benefits",
    "catalog_kind",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  portal_team_members: [
    "id",
    "company_name",
    "full_name",
    "email",
    "role_title",
    "portal_role",
    "responsibility",
    "status",
    "last_active",
    "phone",
    "permissions",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  portal_audit_events: [
    "id",
    "actor_id",
    "actor_name",
    "actor_role",
    "action",
    "target_type",
    "target_name",
    "outcome",
    "details",
    "severity",
    "is_seed",
    "created_at",
  ],
  portal_news_posts: [
    "id",
    "title",
    "caption",
    "image_path",
    "image_alt",
    "posted_by_name",
    "posted_by_role",
    "updated_at",
    "is_seed",
    "created_at",
  ],
  reward_catalog_items: [
    "id",
    "title",
    "description",
    "image_path",
    "category",
    "points_cost",
    "stock",
    "availability",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  reward_point_events: [
    "id",
    "user_id",
    "partner_id",
    "source_type",
    "source_id",
    "points_delta",
    "reason",
    "approved_by",
    "approved_at",
    "is_seed",
    "created_at",
  ],
  reward_redemptions: [
    "id",
    "reward_id",
    "user_id",
    "partner_id",
    "points_cost",
    "status",
    "shipping_name",
    "shipping_address",
    "notes",
    "approved_by",
    "approved_at",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  lookup_values: ["id", "field_name", "value", "value_key", "created_by", "is_seed", "created_at"],
  document_blobs: [
    "file_path",
    "bucket",
    "file_name",
    "mime_type",
    "size_bytes",
    "file_data",
    "is_seed",
    "created_at",
  ],
  sessions: [
    "id",
    "user_id",
    "token_hash",
    "is_seed",
    "expires_at",
    "last_seen_at",
    "created_at",
    "updated_at",
  ],
  password_reset_tokens: ["id", "user_id", "token_hash", "expires_at", "used_at", "created_at"],
  notifications: ["id", "user_id", "partner_id", "title", "message", "type", "read", "created_at"],
  domain_activity_events: [
    "id",
    "tenant_id",
    "organization_tenant_id",
    "subject_type",
    "subject_id",
    "actor_user_id",
    "assignment_id",
    "correlation_id",
    "event_name",
    "schema_version",
    "payload",
    "created_at",
  ],
  support_tickets: [
    "id",
    "partner_id",
    "created_by",
    "created_by_name",
    "subject",
    "description",
    "status",
    "priority",
    "assignee_name",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  support_ticket_comments: [
    "id",
    "ticket_id",
    "author_id",
    "author_name",
    "author_role",
    "body",
    "is_internal",
    "is_seed",
    "created_at",
  ],
  tasks: [
    "id",
    "title",
    "description",
    "status",
    "priority",
    "related_type",
    "related_id",
    "assignee_id",
    "creator_id",
    "partner_id",
    "due_at",
    "blocked_reason",
    "completed_at",
    "cancelled_at",
    "version",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  role_permissions: [
    "role_key",
    "feature_key",
    "can_create",
    "can_read",
    "can_update",
    "can_delete",
    "updated_at",
  ],
  role_geography_access: ["role_key", "geography_node_id", "created_at"],
};

export const SESSION_COOKIE = "livey_session";
// §19.2: Super Admin, Partner Admin, and every LIVEY-internal role get the
// stricter 12h absolute lifetime; only a caller whose sole role is
// partner_user gets the looser 24h one. Unknown/no role falls back to the
// stricter tier rather than the looser one.
const INTERNAL_SESSION_HOURS = 12;
const PARTNER_USER_SESSION_HOURS = 24;
const RESET_TOKEN_MINUTES = 60;

function assertTable(table: string): asserts table is keyof typeof TABLE_COLUMNS {
  if (!(table in TABLE_COLUMNS)) {
    throw new Error(`Unsupported table: ${table}`);
  }
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function hashSha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createToken(): string {
  return randomBytes(32).toString("hex");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function signCloudinaryArchiveRequest(input: {
  apiSecret: string;
  mode: "download";
  publicIds: string;
  targetFormat: "zip";
  timestamp: number;
  type: "upload" | "private" | "authenticated";
}) {
  const serialized = Object.entries({
    mode: input.mode,
    public_ids: input.publicIds,
    target_format: input.targetFormat,
    timestamp: input.timestamp,
    type: input.type,
  })
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("&");
  return createHash("sha1").update(`${serialized}${input.apiSecret}`).digest("hex");
}

function extractSingleZipEntry(zipBuffer: Buffer) {
  const eocdSignature = 0x06054b50;
  const centralDirectorySignature = 0x02014b50;

  let eocdOffset = -1;
  for (
    let index = zipBuffer.length - 22;
    index >= 0 && index >= zipBuffer.length - 65557;
    index -= 1
  ) {
    if (zipBuffer.readUInt32LE(index) === eocdSignature) {
      eocdOffset = index;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error("Cloudinary archive is missing an end-of-central-directory record");
  }

  const centralDirectoryOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  if (zipBuffer.readUInt32LE(centralDirectoryOffset) !== centralDirectorySignature) {
    throw new Error("Cloudinary archive is missing a central directory entry");
  }

  const compressedSize = zipBuffer.readUInt32LE(centralDirectoryOffset + 20);
  const localHeaderOffset = zipBuffer.readUInt32LE(centralDirectoryOffset + 42);
  const method = zipBuffer.readUInt16LE(localHeaderOffset + 8);
  const fileNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
  const fileName = zipBuffer
    .subarray(localHeaderOffset + 30, localHeaderOffset + 30 + fileNameLength)
    .toString("utf8");
  const compressedStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressedEnd = compressedStart + compressedSize;
  const compressed = zipBuffer.subarray(compressedStart, compressedEnd);

  if (method === 0) {
    return { fileName, bytes: Buffer.from(compressed) };
  }

  if (method === 8) {
    return { fileName, bytes: Buffer.from(inflateRawSync(compressed)) };
  }

  throw new Error(`Unsupported archive compression method: ${method}`);
}

async function downloadCloudinaryDocumentBytes(
  publicId: string,
  resourceType: "image" | "raw" | "video" | "auto" = "raw",
) {
  const config =
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
      ? {
          cloudName: process.env.CLOUDINARY_CLOUD_NAME,
          apiKey: process.env.CLOUDINARY_API_KEY,
          apiSecret: process.env.CLOUDINARY_API_SECRET,
        }
      : null;

  if (!config) {
    throw new Error("Missing Cloudinary environment variables");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signCloudinaryArchiveRequest({
    apiSecret: config.apiSecret,
    mode: "download",
    publicIds: publicId,
    targetFormat: "zip",
    timestamp,
    type: "upload",
  });
  const form = new FormData();
  form.append("api_key", config.apiKey);
  form.append("timestamp", String(timestamp));
  form.append("mode", "download");
  form.append("public_ids", publicId);
  form.append("type", "upload");
  form.append("target_format", "zip");
  form.append("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/${resourceType}/generate_archive`,
    {
      method: "POST",
      body: form,
    },
  );
  if (!response.ok) {
    throw new Error(`Cloudinary archive download failed (${response.status})`);
  }

  const zipBuffer = Buffer.from(await response.arrayBuffer());
  return extractSingleZipEntry(zipBuffer);
}

async function fetchCloudinaryDocumentBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cloudinary document fetch failed (${response.status})`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function looksLikePdf(bytes: Buffer) {
  return bytes.subarray(0, 5).toString("utf8") === "%PDF-";
}

function normalizePdfText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[^\x20-\x7E]/g, "?");
}

function escapePdfText(value: string) {
  return normalizePdfText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapPdfLines(value: string, maxLineLength = 92) {
  const lines: string[] = [];
  for (const paragraph of normalizePdfText(value).split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(/\s+/);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxLineLength) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (word.length > maxLineLength) {
        let index = 0;
        while (index < word.length) {
          lines.push(word.slice(index, index + maxLineLength));
          index += maxLineLength;
        }
        current = "";
      } else {
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function buildTextPdfBytes(input: { title: string; body: string }) {
  const title = normalizePdfText(input.title || "Document");
  const bodyLines = wrapPdfLines(input.body || "Document preview unavailable.");
  const contentLines = [
    "BT",
    "/F1 14 Tf",
    "72 760 Td",
    `(${escapePdfText(title)}) Tj`,
    "/F1 10 Tf",
    "0 -24 Td",
    ...(bodyLines.length > 0
      ? bodyLines.flatMap((line, index) => [
          `(${escapePdfText(line)}) Tj`,
          ...(index < bodyLines.length - 1 ? ["0 -14 Td"] : []),
        ])
      : ["(Document preview unavailable.) Tj"]),
    "ET",
  ];
  const contentStream = contentLines.join("\n");

  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let byteLength = 0;

  const push = (value: string) => {
    offsets.push(byteLength);
    const chunk = Buffer.from(value, "utf8");
    chunks.push(chunk);
    byteLength += chunk.length;
  };

  push("%PDF-1.4\n");
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
  );
  push("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  push(
    `5 0 obj\n<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
  );

  const xrefStart = byteLength;
  const xrefEntries = ["xref\n0 6\n0000000000 65535 f \n"];
  for (const offset of offsets) {
    xrefEntries.push(`${offset.toString().padStart(10, "0")} 00000 n \n`);
  }
  xrefEntries.push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  push(xrefEntries.join(""));

  return Buffer.concat(chunks);
}

function buildPdfDataUrl(input: { title: string; bytes: Buffer; fallbackText: string }) {
  const bytes = looksLikePdf(input.bytes)
    ? input.bytes
    : buildTextPdfBytes({ title: input.title, body: input.fallbackText });
  return `data:application/pdf;base64,${bytes.toString("base64")}`;
}

function buildWhereClause(filters: QueryFilter[], columns: string[], parameterOffset = 0) {
  const whereClauses: string[] = [];
  const whereParams: unknown[] = [];

  filters.forEach((filter, index) => {
    if (!columns.includes(filter.column)) {
      throw new Error(`Unsupported filter column: ${filter.column}`);
    }
    const paramIndex = parameterOffset + index + 1;
    if (filter.operator === "eq") {
      whereClauses.push(`${quoteIdent(filter.column)} = $${paramIndex}`);
      whereParams.push(filter.value);
    } else if (filter.operator === "in") {
      whereClauses.push(`${quoteIdent(filter.column)} = ANY($${paramIndex})`);
      whereParams.push(filter.value);
    } else {
      throw new Error(`Unsupported filter operator: ${filter.operator}`);
    }
  });

  return {
    whereSql: whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "",
    whereParams,
  };
}

// A caller's ".select(...)" is only honored when it's narrower than "*" —
// the default stays exactly SELECT * (no risk of silently dropping a real
// column that isn't in the curated TABLE_COLUMNS allowlist for some table).
// But a caller that deliberately asked for a specific column list — e.g.
// admin.users.tsx omitting password_hash — now actually gets only that list
// back, instead of the server ignoring it and returning every column.
export function buildSelectColumnsSql(select: string | undefined, columns: string[]): string {
  if (!select || select.trim() === "*") {
    return "*";
  }
  const requested = select
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  if (requested.length === 0) {
    return "*";
  }
  for (const column of requested) {
    if (!columns.includes(column)) {
      throw new Error(`Unsupported select column: ${column}`);
    }
  }
  return requested.map(quoteIdent).join(", ");
}

// Appends the policy layer's "creator OR assignee" style read scope (see
// TableQuery.scopeAnyColumnEquals) on top of whatever regular filters were
// already built — this is never client-supplied, only ever set by
// applyTablePolicyInner, but the column names are still validated against
// the table's own allowlist as defense in depth.
function appendAnyColumnScope(
  whereSql: string,
  whereParams: unknown[],
  scope: { columns: [string, string]; value: string } | undefined,
  columns: string[],
): { sql: string; params: unknown[] } {
  if (!scope) {
    return { sql: whereSql, params: whereParams };
  }
  for (const column of scope.columns) {
    if (!columns.includes(column)) {
      throw new Error(`Unsupported scope column: ${column}`);
    }
  }
  const paramIndex = whereParams.length + 1;
  const [columnA, columnB] = scope.columns;
  const condition = `(${quoteIdent(columnA)} = $${paramIndex} OR ${quoteIdent(columnB)} = $${paramIndex})`;
  return {
    sql: whereSql ? `${whereSql} AND ${condition}` : ` WHERE ${condition}`,
    params: [...whereParams, scope.value],
  };
}

// deal_participants/customer_participants are the only two valid
// scopeOwnerOrParticipantTag.participantTable values (see the type), but
// re-checked here at runtime as defense in depth since the value is
// interpolated directly into raw SQL — matching appendAnyColumnScope's own
// column-allowlist check just above.
const PARTICIPANT_SCOPE_TABLES = new Set(["deal_participants", "customer_participants"]);
const PARTICIPANT_SCOPE_FK_COLUMNS = new Set(["deal_id", "customer_id"]);

// Appends the policy layer's "I own it OR I'm an active tagged
// participant on it" read scope (see TableQuery.scopeOwnerOrParticipantTag)
// on top of whatever regular filters were already built. Never
// client-supplied, only ever set by applyTablePolicyInner. The EXISTS
// subquery correlates against the outer query's own FROM table (queried
// unaliased as `${quoteIdent(table)}` — see the SELECT/COUNT SQL below),
// which is exactly the table this function's caller is already scoping.
function appendOwnerOrParticipantTagScope(
  whereSql: string,
  whereParams: unknown[],
  scope: TableQuery["scopeOwnerOrParticipantTag"],
  table: string,
  columns: string[],
): { sql: string; params: unknown[] } {
  if (!scope) {
    return { sql: whereSql, params: whereParams };
  }
  if (!columns.includes(scope.ownerColumn)) {
    throw new Error(`Unsupported scope column: ${scope.ownerColumn}`);
  }
  if (!PARTICIPANT_SCOPE_TABLES.has(scope.participantTable)) {
    throw new Error(`Unsupported participant scope table: ${scope.participantTable}`);
  }
  if (!PARTICIPANT_SCOPE_FK_COLUMNS.has(scope.fkColumn)) {
    throw new Error(`Unsupported participant scope fk column: ${scope.fkColumn}`);
  }
  const paramIndex = whereParams.length + 1;
  const condition = `(${quoteIdent(scope.ownerColumn)} = $${paramIndex} OR EXISTS (
    SELECT 1 FROM ${quoteIdent(scope.participantTable)} AS pt
    WHERE pt.${quoteIdent(scope.fkColumn)} = ${quoteIdent(table)}.${quoteIdent("id")}
      AND pt.${quoteIdent("participant_user_id")} = $${paramIndex}
      AND pt.${quoteIdent("valid_to")} IS NULL
  ))`;
  return {
    sql: whereSql ? `${whereSql} AND ${condition}` : ` WHERE ${condition}`,
    params: [...whereParams, scope.ownerValue],
  };
}

function serializeDbValue<T>(value: T): T {
  if (value instanceof Date) {
    return value.toISOString() as T;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("base64") as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeDbValue(item)) as T;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeDbValue(entry)]),
    ) as T;
  }

  return value;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function sessionExpiresAt(roles: readonly string[] = []): Date {
  const hours =
    roles.length > 0 && roles.every((role) => role === "partner_user")
      ? PARTNER_USER_SESSION_HOURS
      : INTERNAL_SESSION_HOURS;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function loadUserRoles(userId: string, client: Pick<PoolClient, "query"> = pool) {
  const { rows } = await client.query(`SELECT role FROM user_roles WHERE user_id = $1`, [userId]);
  return rows.map((row) => String((row as { role: string }).role));
}

function resetExpiresAt(): Date {
  return new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000);
}

function toLocalUser(row: {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  company_name: string | null;
}): LocalUser {
  return {
    id: row.id,
    email: row.email,
    user_metadata: {
      full_name: row.full_name,
      phone: row.phone,
      company_name: row.company_name,
    },
  };
}

export async function queryTableWithAuthContext(
  query: TableQuery,
  authContext: TablePolicyAuthContext,
) {
  assertTable(query.table);
  const columns = TABLE_COLUMNS[query.table];
  let policyQuery: TableQuery;
  try {
    policyQuery = await applyTablePolicy(query, authContext);
  } catch {
    return {
      data: null,
      error: { message: "Access denied" },
    };
  }
  const filters = policyQuery.filters ?? [];
  const order = policyQuery.order;
  const values = policyQuery.values;
  const orderSql =
    order && columns.includes(order.column)
      ? ` ORDER BY ${quoteIdent(order.column)} ${order.ascending === false ? "DESC" : "ASC"}`
      : "";
  // Validated as an actual number (not client-supplied text) before being
  // inlined, so this can never carry SQL syntax.
  const limitSql =
    Number.isInteger(policyQuery.limit) && (policyQuery.limit as number) > 0
      ? ` LIMIT ${Math.min(policyQuery.limit as number, 1000)}`
      : "";

  if (policyQuery.operation === "select") {
    const { whereSql, whereParams } = buildWhereClause(filters, columns);
    const anyColumnScoped = appendAnyColumnScope(
      whereSql,
      whereParams,
      policyQuery.scopeAnyColumnEquals,
      columns,
    );
    const { sql: scopedWhereSql, params: scopedParams } = appendOwnerOrParticipantTagScope(
      anyColumnScoped.sql,
      anyColumnScoped.params,
      policyQuery.scopeOwnerOrParticipantTag,
      policyQuery.table,
      columns,
    );
    const selectSql = buildSelectColumnsSql(policyQuery.select, columns);
    const result = await pool.query(
      `SELECT ${selectSql} FROM ${quoteIdent(policyQuery.table)}${scopedWhereSql}${orderSql}${limitSql}`,
      scopedParams,
    );
    const data = result.rows.map((row) => serializeDbValue(row));
    return {
      data:
        policyQuery.single === "single"
          ? (data[0] ?? null)
          : policyQuery.single === "maybeSingle"
            ? (data[0] ?? null)
            : data,
      error: null,
    };
  }

  if (policyQuery.operation === "count") {
    const { whereSql, whereParams } = buildWhereClause(filters, columns);
    const anyColumnScoped = appendAnyColumnScope(
      whereSql,
      whereParams,
      policyQuery.scopeAnyColumnEquals,
      columns,
    );
    const { sql: scopedWhereSql, params: scopedParams } = appendOwnerOrParticipantTagScope(
      anyColumnScoped.sql,
      anyColumnScoped.params,
      policyQuery.scopeOwnerOrParticipantTag,
      policyQuery.table,
      columns,
    );
    const result = await pool.query(
      `SELECT count(*) AS count FROM ${quoteIdent(policyQuery.table)}${scopedWhereSql}`,
      scopedParams,
    );
    return {
      data: result.rows[0]?.count ?? 0,
      error: null,
    };
  }

  if (policyQuery.operation === "insert") {
    const inserts = Array.isArray(values) ? values : [values ?? {}];
    if (inserts.length === 0) {
      return { data: [], error: null };
    }

    const inserted: unknown[] = [];
    for (const row of inserts) {
      if (!isPlainObject(row)) {
        throw new Error("Insert values must be objects");
      }

      const rowColumns = Object.keys(row).filter((column) => columns.includes(column));
      const rowParams = rowColumns.map((column) => row[column]);
      const sql = `INSERT INTO ${quoteIdent(policyQuery.table)} (${rowColumns
        .map(quoteIdent)
        .join(
          ", ",
        )}) VALUES (${rowColumns.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING *`;
      const result = await pool.query(sql, rowParams);
      inserted.push(serializeDbValue(result.rows[0]));
    }

    return {
      data:
        policyQuery.single === "single"
          ? (inserted[0] ?? null)
          : policyQuery.single === "maybeSingle"
            ? (inserted[0] ?? null)
            : inserted,
      error: null,
    };
  }

  if (policyQuery.operation === "update") {
    if (!isPlainObject(values)) {
      throw new Error("Update values must be an object");
    }

    const updateColumns = Object.keys(values).filter((column) => columns.includes(column));
    if (updateColumns.length === 0) {
      return { data: [], error: null };
    }

    const setSql = updateColumns
      .map((column, index) => `${quoteIdent(column)} = $${index + 1}`)
      .join(", ");
    const updateParams = updateColumns.map((column) => values[column]);
    const { whereSql, whereParams } = buildWhereClause(filters, columns, updateColumns.length);
    const result = await pool.query(
      `UPDATE ${quoteIdent(policyQuery.table)} SET ${setSql}${whereSql} RETURNING *`,
      [...updateParams, ...whereParams],
    );
    const rows = result.rows.map((row) => serializeDbValue(row));
    return {
      data:
        policyQuery.single === "single"
          ? (rows[0] ?? null)
          : policyQuery.single === "maybeSingle"
            ? (rows[0] ?? null)
            : rows,
      error: null,
    };
  }

  if (policyQuery.operation === "delete") {
    const { whereSql, whereParams } = buildWhereClause(filters, columns);
    const result = await pool.query(
      `DELETE FROM ${quoteIdent(policyQuery.table)}${whereSql} RETURNING *`,
      whereParams,
    );
    const rows = result.rows.map((row) => serializeDbValue(row));
    return {
      data:
        policyQuery.single === "single"
          ? (rows[0] ?? null)
          : policyQuery.single === "maybeSingle"
            ? (rows[0] ?? null)
            : rows,
      error: null,
    };
  }

  throw new Error(`Unsupported operation: ${policyQuery.operation}`);
}

export async function queryTable(query: TableQuery) {
  const authContext = await getAuthContext();
  return queryTableWithAuthContext(query, {
    userId: authContext.session?.user.id ?? null,
    roles: authContext.roles,
    partnerId: authContext.profile?.partner_id ?? null,
    companyName: authContext.profile?.company_name ?? null,
    hasGovernedContext: Boolean(authContext.activeContext),
    governedRoleKey: authContext.assignment?.roleKey ?? null,
    geographyCeilingNodeId: authContext.assignment?.geographyCeilingNodeId ?? null,
  });
}

export async function findSessionFromRequest() {
  const token = getCookie(SESSION_COOKIE);
  if (!token) {
    return null;
  }
  return getSessionFromToken(token);
}

export async function getSessionFromToken(token: string): Promise<LocalSession | null> {
  const sessionHash = hashSha256(token);
  const result = await pool.query(
    `SELECT s.token_hash, s.expires_at, s.revoked_at, p.id, p.email, p.full_name, p.phone, p.company_name
     FROM sessions s
     JOIN profiles p ON p.id = s.user_id
     WHERE s.token_hash = $1
     LIMIT 1`,
    [sessionHash],
  );

  const row = result.rows[0] as
    | {
        token_hash: string;
        expires_at: Date;
        revoked_at: Date | null;
        id: string;
        email: string;
        full_name: string;
        phone: string | null;
        company_name: string | null;
      }
    | undefined;

  if (!row) {
    return null;
  }

  if (row.revoked_at) {
    await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [sessionHash]);
    return null;
  }

  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.valueOf()) || expiresAt.getTime() <= Date.now()) {
    await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [sessionHash]);
    return null;
  }

  await pool.query(`UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1`, [sessionHash]);

  return {
    access_token: token,
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    user: toLocalUser(row),
  };
}

function mapAssignmentRow(row: Record<string, unknown>): AssignmentRecord {
  return {
    assignmentId: String(row.assignment_id),
    userId: String(row.user_id),
    tenantId: String(row.tenant_id),
    organizationTenantId: String(row.organization_tenant_id),
    roleKey: row.role_key as AssignmentRecord["roleKey"],
    teamDomain: row.team_domain as AssignmentRecord["teamDomain"],
    geographyCeilingNodeId: String(row.geography_ceiling_node_id),
    partnerId: row.partner_id == null ? null : String(row.partner_id),
    accountId: row.account_id == null ? null : String(row.account_id),
    portfolioId: row.portfolio_id == null ? null : String(row.portfolio_id),
    queueId: row.queue_id == null ? null : String(row.queue_id),
    status: row.assignment_status as AssignmentRecord["status"],
    validFrom: String(row.valid_from),
    validTo: row.valid_to == null ? null : String(row.valid_to),
    managerAssignmentId:
      row.manager_assignment_id == null ? null : String(row.manager_assignment_id),
    source: String(row.source),
    approverUserId: row.approver_user_id == null ? null : String(row.approver_user_id),
    predecessorAssignmentId:
      row.predecessor_assignment_id == null ? null : String(row.predecessor_assignment_id),
    successorAssignmentId:
      row.successor_assignment_id == null ? null : String(row.successor_assignment_id),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
    revocationReason: row.revocation_reason == null ? null : String(row.revocation_reason),
    createdAt: String(row.assignment_created_at),
    updatedAt: String(row.assignment_updated_at),
    version: Number(row.assignment_version),
    isSeed: Boolean(row.assignment_is_seed),
  };
}

function mapActiveContextRow(row: Record<string, unknown>): ActiveContextRecord {
  return {
    contextId: String(row.context_id),
    userId: String(row.user_id),
    assignmentId: String(row.assignment_id),
    assignmentStatus: row.assignment_status as ActiveContextRecord["assignmentStatus"],
    tenantId: String(row.tenant_id),
    organizationTenantId: String(row.organization_tenant_id),
    workingScope: row.working_scope == null ? null : String(row.working_scope),
    issuedAt: String(row.issued_at),
    expiresAt: String(row.expires_at),
    version: Number(row.version),
    revocationLink: row.revocation_link == null ? null : String(row.revocation_link),
    correlationId: String(row.correlation_id),
    assignmentVersion: Number(row.assignment_version),
    workingScopeNodeId: row.working_scope == null ? null : String(row.working_scope),
    revokedAt: row.context_revoked_at == null ? null : String(row.context_revoked_at),
    revocationReason:
      row.context_revocation_reason == null ? null : String(row.context_revocation_reason),
    isSeed: Boolean(row.context_is_seed),
    createdAt: String(row.context_created_at),
    updatedAt: String(row.context_updated_at),
  };
}

async function loadGovernedAuthState(userId: string) {
  const { rows } = await pool.query(
    `SELECT
       ac.context_id,
       ac.user_id,
       ac.assignment_id,
       ac.tenant_id,
       ac.organization_tenant_id,
       ac.working_scope,
       ac.issued_at,
       ac.expires_at,
       ac.version,
       ac.revocation_link,
       ac.revoked_at AS context_revoked_at,
       ac.revocation_reason AS context_revocation_reason,
       ac.correlation_id,
       ac.is_seed AS context_is_seed,
       ac.created_at AS context_created_at,
       ac.updated_at AS context_updated_at,
       a.assignment_id,
       a.user_id,
       a.tenant_id,
       a.organization_tenant_id,
       a.version AS assignment_version,
       a.status AS assignment_status,
       a.role_key,
       a.team_domain,
       a.geography_ceiling_node_id,
       a.partner_id,
       a.account_id,
       a.portfolio_id,
       a.queue_id,
       a.manager_assignment_id,
       a.source,
       a.approver_user_id,
       a.predecessor_assignment_id,
       a.successor_assignment_id,
       a.valid_from,
       a.valid_to,
       a.revoked_at,
       a.revocation_reason,
       a.created_at AS assignment_created_at,
       a.updated_at AS assignment_updated_at,
       a.is_seed AS assignment_is_seed
     FROM active_contexts ac
     JOIN assignments a ON a.assignment_id = ac.assignment_id
     WHERE ac.user_id = $1 AND ac.revoked_at IS NULL
     ORDER BY ac.issued_at DESC, ac.created_at DESC
     LIMIT 1`,
    [userId],
  );

  const contextRow = rows[0] as Record<string, unknown> | undefined;
  if (!contextRow) {
    const { rows: assignmentRows } = await pool.query(
      `SELECT
         a.assignment_id,
         a.user_id,
         a.tenant_id,
         a.organization_tenant_id,
         a.version AS assignment_version,
         a.status AS assignment_status,
         a.role_key,
         a.team_domain,
         a.geography_ceiling_node_id,
         a.partner_id,
         a.account_id,
         a.portfolio_id,
         a.queue_id,
         a.manager_assignment_id,
         a.source,
         a.approver_user_id,
         a.predecessor_assignment_id,
         a.successor_assignment_id,
         a.valid_from,
         a.valid_to,
         a.revoked_at,
         a.revocation_reason,
         a.created_at AS assignment_created_at,
         a.updated_at AS assignment_updated_at,
         a.is_seed AS assignment_is_seed
       FROM assignments a
       WHERE a.user_id = $1
       ORDER BY a.valid_from DESC, a.created_at DESC
       LIMIT 1`,
      [userId],
    );
    const assignmentRow = assignmentRows[0] as Record<string, unknown> | undefined;
    return {
      assignment: assignmentRow ? mapAssignmentRow(assignmentRow) : null,
      activeContext: null,
    };
  }

  return {
    assignment: mapAssignmentRow(contextRow),
    activeContext: mapActiveContextRow(contextRow),
  };
}

export async function revokeUserSessionsAndContexts(
  input: {
    userId: string;
    reason: string;
    revokedByContextId?: string | null;
  },
  client: Pick<PoolClient, "query"> = pool,
) {
  const sessionsResult = await client.query(
    `UPDATE sessions
     SET revoked_at = now(),
         revoked_by_context_id = $2,
         revocation_reason = $3
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [input.userId, input.revokedByContextId ?? null, input.reason],
  );

  const contextsResult = await client.query(
    `UPDATE active_contexts
     SET revoked_at = now(),
         revocation_reason = $2
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [input.userId, input.reason],
  );

  return {
    revokedSessionCount: sessionsResult.rowCount ?? 0,
    revokedContextCount: contextsResult.rowCount ?? 0,
  };
}

export async function getAuthContext(token?: string) {
  const session = token ? await getSessionFromToken(token) : await findSessionFromRequest();
  if (!session) {
    return {
      session: null,
      profile: null,
      roles: [] as AppRole[],
      assignment: null,
      activeContext: null,
    };
  }

  // getAuthContext() is called by every authenticated page load and its
  // result is sent straight to the browser (see the client-facing
  // getAuthContext RPC in integrations/local/client.ts) — this SELECT must
  // never include password_hash or any other credential/secret column.
  const [{ rows: profileRows }, { rows: roleRows }, governedState] = await Promise.all([
    pool.query(
      `SELECT id, email, full_name, phone, company_name, avatar_url, partner_id, partner_status, must_reset_password
       FROM profiles WHERE id = $1 LIMIT 1`,
      [session.user.id],
    ),
    pool.query(`SELECT role FROM user_roles WHERE user_id = $1 ORDER BY created_at ASC`, [
      session.user.id,
    ]),
    loadGovernedAuthState(session.user.id),
  ]);

  const profile = profileRows[0]
    ? ({
        ...(profileRows[0] as Record<string, unknown>),
        id: String(profileRows[0].id),
        partner_id: profileRows[0].partner_id == null ? null : String(profileRows[0].partner_id),
        partner_status: profileRows[0].partner_status as PartnerStatus,
      } as {
        id: string;
        email: string;
        full_name: string;
        phone: string | null;
        company_name: string | null;
        avatar_url: string | null;
        partner_id: string | null;
        partner_status: PartnerStatus;
        must_reset_password: boolean;
      })
    : null;

  const roles = roleRows.map((row: { role: AppRole }) => row.role);

  return {
    session,
    profile,
    roles,
    assignment: governedState.assignment,
    activeContext: governedState.activeContext,
  };
}

export async function signInWithPassword(email: string, password: string) {
  const result = await pool.query(
    `SELECT id, email, password_hash, full_name, phone, company_name, avatar_url, partner_id, partner_status, must_reset_password
     FROM profiles WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  const profile = result.rows[0] as
    | {
        id: string;
        email: string;
        password_hash: string;
        full_name: string;
        phone: string | null;
        company_name: string | null;
        avatar_url: string | null;
        partner_id: string | null;
        partner_status: PartnerStatus;
        must_reset_password: boolean;
      }
    | undefined;

  if (!profile) {
    throw new Error("Invalid email or password");
  }

  const ok = await bcrypt.compare(password, profile.password_hash);
  if (!ok) {
    throw new Error("Invalid email or password");
  }

  const roles = await loadUserRoles(profile.id);
  const token = createToken();
  const expiresAt = sessionExpiresAt(roles);
  await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    profile.id,
    hashSha256(token),
    expiresAt,
  ]);
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });

  return {
    session: {
      access_token: token,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      user: toLocalUser(profile),
    } satisfies LocalSession,
    user: toLocalUser(profile),
  };
}

// §5.2: "A user identity... does not directly grant business access. Access
// is granted through one or more assignments" — every account-creation path
// must leave the user with a real governed Assignment, or every generic
// table read/write denies them everywhere (governedRoleKey resolves to
// null -> loadRoleCapabilities returns emptyCapabilities()). Only
// admin.users.tsx's createUser flow did this, via a separate follow-up call
// to assignGovernedRole after the fact — self-registration (signUpLocal)
// and partner-invited teammates (createPartnerTeamMembersBulk) never did.
// assignGovernedRole itself can't be reused directly here: it requires an
// acting GovernedActor authorised via authorizeAssignRole (super_admin
// only), which doesn't exist for a brand-new self-registering user and
// wouldn't authorise an inviting partner_admin either. This is the minimal
// bootstrap equivalent — no acting-on-behalf-of authorization needed, since
// the assignment is a normal, expected side effect of account creation
// itself, not a privileged admin action on someone else's behalf.
//
// Geography ceiling always defaults to Global: role_geography_access has no
// rows for partner_admin/partner_user today (confirmed live), and
// geography-based scope narrowing is a LIVEY-internal-role concept (see
// appendGeographyFilter/GEOGRAPHY_SCOPED_TABLES) — a partner's own tenant
// boundary comes from profiles.partner_id, not the geography ceiling.
export async function bootstrapPartnerAssignment(
  client: Pick<PoolClient, "query">,
  input: {
    userId: string;
    roleKey: "partner_admin" | "partner_user";
    source: string;
    approverUserId: string;
  },
): Promise<void> {
  const issuedAt = new Date().toISOString();
  const assignmentId = randomUUID();

  await client.query(
    `INSERT INTO assignments (
       assignment_id, user_id, tenant_id, organization_tenant_id, role_key, team_domain,
       geography_ceiling_node_id, status, valid_from, source, approver_user_id, is_seed
     ) VALUES ($1,$2,$3,$4,$5,'partner_success',$6,'active',$7,$8,$9,false)`,
    [
      assignmentId,
      input.userId,
      GOVERNANCE_TENANT_IDS.liveyOrganization,
      GOVERNANCE_TENANT_IDS.liveyOrganization,
      input.roleKey,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
      issuedAt,
      input.source,
      input.approverUserId,
    ],
  );

  const assignmentRecord: AssignmentRecord = {
    assignmentId,
    userId: input.userId,
    tenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    organizationTenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
    roleKey: input.roleKey,
    teamDomain: "partner_success",
    geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    partnerId: null,
    accountId: null,
    portfolioId: null,
    queueId: null,
    status: "active",
    validFrom: issuedAt,
    validTo: null,
    managerAssignmentId: null,
    source: input.source,
    approverUserId: input.approverUserId,
    predecessorAssignmentId: null,
    successorAssignmentId: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: issuedAt,
    updatedAt: issuedAt,
    version: 1,
    isSeed: false,
  };

  const activeContext = issueActiveContextFromAssignment({
    assignment: assignmentRecord,
    issuedAt,
  });

  await client.query(
    `INSERT INTO active_contexts (
       context_id, user_id, assignment_id, tenant_id, organization_tenant_id,
       working_scope, issued_at, expires_at, version, correlation_id, is_seed
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false)`,
    [
      activeContext.contextId,
      activeContext.userId,
      activeContext.assignmentId,
      activeContext.tenantId,
      activeContext.organizationTenantId,
      activeContext.workingScope,
      activeContext.issuedAt,
      activeContext.expiresAt,
      activeContext.version,
      activeContext.correlationId,
    ],
  );
}

export async function signUpLocal(input: {
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  password: string;
}) {
  const existing = await pool.query(`SELECT id FROM profiles WHERE lower(email) = lower($1)`, [
    input.email,
  ]);
  if (existing.rows.length > 0) {
    throw new Error("An account with that email already exists");
  }

  const id = randomUUID();
  const passwordHash = await bcrypt.hash(input.password, 10);
  await pool.query(
    `INSERT INTO profiles (id, email, password_hash, full_name, phone, company_name, partner_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending_partner_registration')`,
    [id, input.email, passwordHash, input.full_name, input.phone || null, input.company_name],
  );
  await pool.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'partner_admin')`, [id]);
  await bootstrapPartnerAssignment(pool, {
    userId: id,
    roleKey: "partner_admin",
    source: "self_registration",
    approverUserId: id,
  });

  const token = createToken();
  const expiresAt = sessionExpiresAt(["partner_admin"]);
  await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    id,
    hashSha256(token),
    expiresAt,
  ]);
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });

  return {
    session: {
      access_token: token,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      user: toLocalUser({
        id,
        email: input.email,
        full_name: input.full_name,
        phone: input.phone || null,
        company_name: input.company_name,
      }),
    } satisfies LocalSession,
    user_id: id,
  };
}

export async function createWorkspaceUser(input: {
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  password: string;
  role: AppRole;
  partner_status?: PartnerStatus;
  partner_id?: string;
  must_reset_password?: boolean;
}) {
  // admin.users.tsx (the only caller) gates its entire "Create user" UI to
  // super_admin — see the note on assertCanGrantWorkspaceUser below for why
  // this must also be enforced server-side, not just by the page's own
  // `hasRole("super_admin")` redirect.
  const ctx = await getAuthContext();
  if (!ctx.roles.includes("super_admin")) {
    throw new Error("Unauthorized");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const createdUser = await insertWorkspaceUserRecord(client, ctx, input);
    await client.query("COMMIT");
    return createdUser;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** insertWorkspaceUserRecord is shared by two genuinely different authority
 * contexts, so their allowed-role sets differ:
 *   - createWorkspaceUser/createWorkspaceUsersBulk (admin.users.tsx, an
 *     internal LIVEY-admin screen for creating any of the 9 canonical
 *     roles, including rm/pam/kam/isr/livey_support) — now restricted to
 *     super_admin callers only, above.
 *   - createPartnerTeamMembersBulk (partner.team.tsx) — a Partner Admin
 *     managing their own org's roster, which may legitimately grant a
 *     lateral "partner_admin" co-admin as well as "partner_user" (product.md
 *     §6.9: "a Partner Admin can grant only at or below their own
 *     authority" — partner_admin is "at", not above), but never anything
 *     from the internal RoleKey set.
 *
 * Previously, BOTH paths accepted a caller who merely had super_admin OR
 * partner_admin, with nothing checking what role or partner_id was actually
 * being granted — so a plain partner_admin could pass `role: "super_admin"`
 * (or any other partner's partner_id) straight through to this function's
 * INSERTs and get instant privilege escalation to full super_admin, or
 * plant an account inside a different tenant. TanStack Start's
 * `.validator((input: T) => input)` pattern used by every createServerFn in
 * integrations/local/client.ts is a type-only identity function with no
 * runtime effect, so the `AppRole`/`RoleKey` TypeScript typing on these
 * fields provided no real protection either — a raw request body can carry
 * any string. */
export function assertCanGrantWorkspaceUser(
  ctx: { roles: readonly string[]; profile: { partner_id?: string | null } | null },
  input: Pick<WorkspaceUserInput, "role" | "partner_id">,
  options: { allowedRoles?: readonly RoleKey[] } = {},
): { callerIsSuperAdmin: boolean; ownPartnerId: string | null } {
  const callerIsSuperAdmin = ctx.roles.includes("super_admin");

  if (!(ROLE_KEYS as readonly string[]).includes(input.role)) {
    throw new Error(`Unknown role: ${input.role}`);
  }

  // Defence in depth: even if a future call site forgets to pass
  // allowedRoles, a non-super_admin caller can never grant anything beyond
  // a lateral partner_admin/partner_user by default — never any of the
  // internal RoleKey values (rm/pam/kam/isr/livey_support/
  // restricted_distributor) or super_admin itself.
  const effectiveAllowedRoles =
    options.allowedRoles ??
    (callerIsSuperAdmin ? null : (["partner_admin", "partner_user"] as const));
  if (effectiveAllowedRoles && !effectiveAllowedRoles.includes(input.role)) {
    throw new Error(`"${input.role}" cannot be granted through this path`);
  }

  const ownPartnerId = ctx.profile?.partner_id ?? null;
  if (!callerIsSuperAdmin && input.partner_id && input.partner_id !== ownPartnerId) {
    throw new Error("Cannot create a user under a different partner");
  }

  return { callerIsSuperAdmin, ownPartnerId };
}

async function insertWorkspaceUserRecord(
  client: PoolClient,
  ctx: Awaited<ReturnType<typeof getAuthContext>>,
  input: WorkspaceUserInput,
  options: { allowedRoles?: readonly RoleKey[] } = {},
) {
  const { callerIsSuperAdmin, ownPartnerId } = assertCanGrantWorkspaceUser(ctx, input, options);

  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = await client.query(`SELECT id FROM profiles WHERE lower(email) = lower($1)`, [
    normalizedEmail,
  ]);
  if (existing.rows.length > 0) {
    throw new Error(`An account with email ${normalizedEmail} already exists`);
  }

  const id = randomUUID();
  const passwordHash = await bcrypt.hash(input.password, 10);
  const partnerStatus =
    input.partner_status ??
    (input.role === "super_admin" ? "approved" : "pending_partner_registration");
  // A non-super_admin caller can only ever land the new user in their own
  // partner (assertCanGrantWorkspaceUser already rejected a mismatched
  // input.partner_id above) — never trust a client-supplied partner_id on
  // its own for who it targets.
  const partnerId = callerIsSuperAdmin ? (input.partner_id ?? ownPartnerId ?? null) : ownPartnerId;

  await client.query(
    `INSERT INTO profiles (id, email, password_hash, full_name, phone, company_name, partner_status, partner_id, must_reset_password, is_seed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)`,
    [
      id,
      normalizedEmail,
      passwordHash,
      input.full_name.trim(),
      input.phone.trim() || null,
      input.company_name?.trim() || null,
      partnerStatus,
      partnerId,
      input.must_reset_password ?? false,
    ],
  );
  await client.query(`INSERT INTO user_roles (user_id, role, is_seed) VALUES ($1, $2, false)`, [
    id,
    input.role,
  ]);

  return {
    id,
    email: normalizedEmail,
    full_name: input.full_name.trim(),
    phone: input.phone.trim() || null,
    company_name: input.company_name?.trim() || null,
    role: input.role,
    partner_status: partnerStatus,
  };
}

export async function createWorkspaceUsersBulk(input: { rows: WorkspaceUserInput[] }) {
  // See the note on createWorkspaceUser above — this shares its authority
  // context (admin.users.tsx's bulk import), so the same super_admin-only
  // restriction applies.
  const ctx = await getAuthContext();
  if (!ctx.roles.includes("super_admin")) {
    throw new Error("Unauthorized");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const createdUsers = [];
    for (const row of input.rows) {
      createdUsers.push(await insertWorkspaceUserRecord(client, ctx, row));
    }
    await client.query("COMMIT");
    return { createdCount: createdUsers.length, users: createdUsers };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createPartnerTeamMembersBulk(input: {
  company_name: string;
  rows: Array<{
    full_name: string;
    email: string;
    phone: string;
    password: string;
    role_title: string;
    portal_role: "partner_admin" | "partner_user";
    responsibility: string;
    status: "invited" | "active" | "paused";
  }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx.roles.includes("super_admin") && !ctx.roles.includes("partner_admin")) {
    throw new Error("Unauthorized");
  }

  const callerIsSuperAdmin = ctx.roles.includes("super_admin");
  const ownCompanyName = (ctx.profile as { company_name?: string | null } | null)?.company_name;
  // A partner_admin's team import must land in their own company's roster.
  // Without this, a partner_admin could pass a different company_name and
  // plant rows into another partner's team-member listing (scoped by
  // company_name in table-policy.server.ts's portal_team_members case).
  if (!callerIsSuperAdmin && input.company_name.trim() !== (ownCompanyName ?? "").trim()) {
    throw new Error("Cannot import team members for a different company");
  }

  const companyName = input.company_name.trim();
  if (!companyName) {
    throw new Error("Company name is required for team imports");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const createdAt = new Date().toISOString();

    for (const row of input.rows) {
      const createdUser = await insertWorkspaceUserRecord(
        client,
        ctx,
        {
          full_name: row.full_name,
          email: row.email,
          phone: row.phone,
          company_name: companyName,
          password: row.password,
          role: row.portal_role,
          partner_status: "approved",
        },
        // A raw request could still send a portal_role outside this
        // union — the "partner_admin" | "partner_user" TS type on the
        // outer function's input has no runtime effect (see the note on
        // assertCanGrantWorkspaceUser above).
        { allowedRoles: ["partner_admin", "partner_user"] },
      );
      await bootstrapPartnerAssignment(client, {
        userId: createdUser.id,
        roleKey: row.portal_role,
        source: "partner_invite",
        approverUserId: ctx.profile?.id ?? ctx.session?.user.id ?? createdUser.id,
      });
      await client.query(
        `INSERT INTO portal_team_members (
           id, company_name, full_name, email, role_title, portal_role, responsibility,
           status, last_active, phone, permissions, is_seed, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12, $13)`,
        [
          createdUser.id,
          companyName,
          row.full_name.trim(),
          row.email.trim().toLowerCase(),
          row.role_title.trim(),
          row.portal_role,
          row.responsibility.trim(),
          row.portal_role === "partner_user" ? "active" : row.status,
          "Just added",
          row.phone.trim(),
          row.portal_role === "partner_admin"
            ? ["deals", "documents", "team"]
            : ["dashboard", "deals", "pipeline", "customers", "analytics", "documents", "rewards"],
          createdAt,
          createdAt,
        ],
      );
    }

    await client.query("COMMIT");
    return { createdCount: input.rows.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function signOutLocal() {
  const token = getCookie(SESSION_COOKIE);
  if (token) {
    await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashSha256(token)]);
  }
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

export async function updatePasswordFromSession(password: string) {
  const session = await findSessionFromRequest();
  if (!session) {
    throw new Error("Unauthorized");
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `UPDATE profiles SET password_hash = $1, must_reset_password = false WHERE id = $2`,
    [passwordHash, session.user.id],
  );
  return { ok: true };
}

export async function updateProfileFromSession(input: { full_name: string; phone: string | null }) {
  const session = await findSessionFromRequest();
  if (!session) {
    throw new Error("Unauthorized");
  }
  const fullName = input.full_name.trim();
  if (!fullName) {
    throw new Error("Full name is required");
  }
  await pool.query(
    `UPDATE profiles SET full_name = $1, phone = $2, updated_at = now() WHERE id = $3`,
    [fullName, input.phone?.trim() || null, session.user.id],
  );
  return { ok: true as const };
}

export async function disconnectGoogleAccount() {
  const session = await findSessionFromRequest();
  if (!session) {
    throw new Error("Unauthorized");
  }
  await pool.query(
    `UPDATE profiles SET google_id = NULL, google_email = NULL, google_linked_at = NULL WHERE id = $1`,
    [session.user.id],
  );
  return { ok: true as const };
}

export async function requestPasswordReset(email: string) {
  // Deliberately returns the same { ok: true } shape regardless of whether the
  // account exists, and never puts the reset token/link in the response — a
  // caller who can see either the account's existence or a working token can
  // take the account over. No email transport is configured yet (see
  // docs/implementation-status.md), so the link is logged server-side only;
  // an operator with log access relays it out-of-band until real email
  // delivery is wired up.
  const result = await pool.query(
    `SELECT id, email FROM profiles WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  const profile = result.rows[0] as { id: string; email: string } | undefined;

  if (profile) {
    const token = createToken();
    const expiresAt = resetExpiresAt();
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [profile.id, hashSha256(token), expiresAt],
    );
    const origin = getRequestUrl().origin;
    console.info(
      `[password-reset] requested for ${profile.email}: ${origin}/reset-password?token=${token}`,
    );
  }

  return { ok: true as const };
}

export async function completePasswordReset(token: string, password: string) {
  const tokenHash = hashSha256(token);
  const result = await pool.query(
    `SELECT prt.user_id, prt.expires_at, prt.used_at, p.email, p.full_name, p.phone, p.company_name
     FROM password_reset_tokens prt
     JOIN profiles p ON p.id = prt.user_id
     WHERE prt.token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );
  const row = result.rows[0] as
    | {
        user_id: string;
        expires_at: Date;
        used_at: Date | null;
        email: string;
        full_name: string;
        phone: string | null;
        company_name: string | null;
      }
    | undefined;
  if (!row) {
    throw new Error("Invalid or expired reset token");
  }
  if (row.used_at) {
    throw new Error("Reset token has already been used");
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new Error("Reset token has expired");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `UPDATE profiles SET password_hash = $1, must_reset_password = false WHERE id = $2`,
    [passwordHash, row.user_id],
  );
  await pool.query(`UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = $1`, [
    tokenHash,
  ]);

  // A password reset means any previously-issued session may have been
  // obtained by whoever no longer has the (now-changed) password — revoke
  // every prior session before issuing the fresh one below.
  await revokeUserSessionsAndContexts({ userId: row.user_id, reason: "password_reset" });

  const roles = await loadUserRoles(row.user_id);
  const sessionToken = createToken();
  const expiresAt = sessionExpiresAt(roles);
  await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    row.user_id,
    hashSha256(sessionToken),
    expiresAt,
  ]);
  setCookie(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });

  return {
    session: {
      access_token: sessionToken,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      user: {
        id: row.user_id,
        email: row.email,
        user_metadata: {
          full_name: row.full_name,
          phone: row.phone,
          company_name: row.company_name,
        },
      },
    } satisfies LocalSession,
  };
}

export async function issueTemporaryPasswordForUser(userId: string) {
  const ctx = await getAuthContext();
  if (!ctx.roles.includes("super_admin")) {
    throw new Error("Unauthorized");
  }

  const { generateTemporaryPassword } = await import("@/lib/temp-password");
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  await pool.query(
    `UPDATE profiles
     SET password_hash = $1, must_reset_password = true, updated_at = now()
     WHERE id = $2`,
    [passwordHash, userId],
  );

  // The user's old password no longer works; any session issued under it
  // should not either.
  await revokeUserSessionsAndContexts({ userId, reason: "admin_forced_password_reset" });

  return { temporaryPassword };
}

const DOCUMENT_BUCKET_TABLES: Record<string, "partner_documents" | "deal_documents"> = {
  "partner-documents": "partner_documents",
  "deal-documents": "deal_documents",
};

/** product.md §9.16/§2.6 finding 1: uploadDocument/createSignedUrl/removeDocuments
 * (the createServerFn handlers in integrations/local/client.ts that call
 * uploadDocumentBlob/createDocumentDataUrl/removeDocumentBlobs below) had no
 * authentication or authorization check at all — any caller, including an
 * anonymous one, could read, overwrite, or delete any document by
 * file_path, entirely bypassing table-policy.server.ts. Mirrors the exact
 * ownership rule table-policy.server.ts already applies to reads/writes of
 * the partner_documents/deal_documents rows themselves (partner_id or
 * uploaded_by match; unscoped for super_admin) — not a new, separately
 * invented policy. A path with no matching row yet is only valid for a
 * fresh upload into a path prefixed with the caller's own partner_id,
 * matching the `{partnerId}/...` convention both upload call sites already
 * use. Known residual gap, matching the identical gap already documented
 * for support_tickets: LIVEY-internal roles (rm/pam/kam/isr/livey_support)
 * have no bypass here, same as they currently don't on the generic
 * partner_documents/deal_documents read path either — not widened here. */
export async function assertDocumentAccessWithAuthContext(
  input: {
    bucket: string;
    filePath: string;
    operation: "read" | "write" | "delete";
  },
  auth: { userId: string | null; partnerId: string | null; isSuperAdmin: boolean },
) {
  if (!auth.userId) {
    throw new Error("Access denied");
  }
  if (auth.isSuperAdmin) {
    return;
  }

  const table = DOCUMENT_BUCKET_TABLES[input.bucket];
  if (!table) {
    throw new Error("Access denied");
  }

  const { rows } = await pool.query(
    `SELECT partner_id, uploaded_by FROM ${table} WHERE file_path = $1 LIMIT 1`,
    [input.filePath],
  );
  const row = rows[0] as { partner_id: string | null; uploaded_by: string | null } | undefined;

  if (row) {
    if (auth.partnerId && row.partner_id === auth.partnerId) return;
    if (row.uploaded_by === auth.userId) return;
    throw new Error("Access denied");
  }

  if (input.operation !== "write") {
    throw new Error("Access denied");
  }
  const prefix = input.filePath.split("/")[0];
  if (!auth.partnerId || prefix !== auth.partnerId) {
    throw new Error("Access denied");
  }
}

export async function assertDocumentAccess(input: {
  bucket: string;
  filePath: string;
  operation: "read" | "write" | "delete";
}) {
  const authContext = await getAuthContext();
  return assertDocumentAccessWithAuthContext(input, {
    userId: authContext.session?.user.id ?? null,
    partnerId: authContext.profile?.partner_id ?? null,
    isSuperAdmin: authContext.roles.includes("super_admin"),
  });
}

export async function uploadDocumentBlob(input: {
  bucket: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  file: File;
  isSeed?: boolean;
}) {
  const resourceType = input.mimeType.startsWith("image/") ? "image" : "raw";

  if (!hasCloudinaryConfig()) {
    const fileBuffer = Buffer.from(await input.file.arrayBuffer());
    await pool.query(
      `INSERT INTO document_blobs (file_path, bucket, file_name, mime_type, size_bytes, file_data, is_seed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (file_path) DO UPDATE SET
         bucket = EXCLUDED.bucket,
         file_name = EXCLUDED.file_name,
         mime_type = EXCLUDED.mime_type,
         size_bytes = EXCLUDED.size_bytes,
         file_data = EXCLUDED.file_data,
         is_seed = EXCLUDED.is_seed`,
      [
        input.filePath,
        input.bucket,
        input.fileName,
        input.mimeType,
        fileBuffer.byteLength,
        fileBuffer,
        input.isSeed ?? false,
      ],
    );
    return {
      path: input.filePath,
      signedUrl: `data:${input.mimeType};base64,${fileBuffer.toString("base64")}`,
      publicId: input.filePath,
    };
  }

  const upload = await uploadToCloudinary({
    file: input.file,
    publicId: input.filePath,
    resourceType,
    folder: input.bucket,
  });
  try {
    await pool.query(
      `INSERT INTO document_blobs (file_path, bucket, file_name, mime_type, size_bytes, file_data, is_seed)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (file_path) DO UPDATE SET
         bucket = EXCLUDED.bucket,
         file_name = EXCLUDED.file_name,
         mime_type = EXCLUDED.mime_type,
         size_bytes = EXCLUDED.size_bytes,
         file_data = EXCLUDED.file_data,
         is_seed = EXCLUDED.is_seed`,
      [
        upload.public_id,
        input.bucket,
        input.fileName,
        input.mimeType,
        upload.bytes,
        Buffer.from(
          JSON.stringify({
            publicId: upload.public_id,
            secureUrl: upload.secure_url,
            resourceType: upload.resource_type,
            version: upload.version ?? null,
            format: upload.format ?? null,
          }),
          "utf8",
        ),
        input.isSeed ?? false,
      ],
    );
  } catch (error) {
    await deleteFromCloudinary({
      publicId: upload.public_id,
      resourceType: upload.resource_type,
    }).catch(() => {});
    throw error;
  }
  return {
    path: upload.public_id,
    signedUrl: upload.secure_url,
    publicId: upload.public_id,
  };
}

export async function createDocumentDataUrl(filePath: string) {
  const result = await pool.query(
    `SELECT file_name, mime_type, file_data FROM document_blobs WHERE file_path = $1 LIMIT 1`,
    [filePath],
  );
  const blob = result.rows[0] as
    | { file_name: string; mime_type: string; file_data: Buffer }
    | undefined;
  if (!blob) {
    throw new Error("Document not found");
  }
  const raw = Buffer.from(blob.file_data ?? Buffer.from([])).toString("utf8");
  try {
    const parsed = JSON.parse(raw) as
      | {
          publicId?: string;
          secureUrl?: string;
          resourceType?: "image" | "raw";
          version?: number | null;
          format?: string | null;
        }
      | undefined;
    if (parsed?.publicId && parsed?.resourceType) {
      if (parsed.secureUrl && parsed.resourceType === "image") {
        return {
          signedUrl: parsed.secureUrl,
          fileName: blob.file_name,
        };
      }
      if (parsed.secureUrl) {
        const bytes = await fetchCloudinaryDocumentBytes(parsed.secureUrl);
        return {
          signedUrl: buildPdfDataUrl({
            title: blob.file_name,
            bytes,
            fallbackText: bytes.toString("utf8"),
          }),
          fileName: blob.file_name,
        };
      }
      const archiveEntry = await downloadCloudinaryDocumentBytes(
        parsed.publicId,
        parsed.resourceType,
      );
      return {
        signedUrl: buildPdfDataUrl({
          title: blob.file_name,
          bytes: archiveEntry.bytes,
          fallbackText: archiveEntry.bytes.toString("utf8"),
        }),
        fileName: blob.file_name,
      };
    }
  } catch {
    // Fall back to the legacy in-DB binary blob format below.
  }

  const fileBytes = Buffer.from(blob.file_data);
  const signedUrl =
    blob.mime_type === "application/pdf"
      ? buildPdfDataUrl({
          title: blob.file_name,
          bytes: fileBytes,
          fallbackText: fileBytes.toString("utf8"),
        })
      : `data:${blob.mime_type};base64,${fileBytes.toString("base64")}`;
  return {
    signedUrl,
    fileName: blob.file_name,
  };
}

export async function removeDocumentBlobs(paths: string[]) {
  if (paths.length === 0) {
    return { removed: 0 };
  }
  const blobRows = await pool.query(
    `SELECT file_path, file_data FROM document_blobs WHERE file_path = ANY($1::text[])`,
    [paths],
  );
  await Promise.all(
    blobRows.rows.map(async (row) => {
      try {
        const parsed = JSON.parse(
          Buffer.from(row.file_data ?? Buffer.from([])).toString("utf8"),
        ) as
          | {
              publicId?: string;
              resourceType?: "image" | "raw";
            }
          | undefined;
        if (parsed?.publicId && parsed?.resourceType) {
          await deleteFromCloudinary({
            publicId: parsed.publicId,
            resourceType: parsed.resourceType,
          });
        }
      } catch {
        // Legacy binary blobs or malformed metadata: delete the database row only.
      }
    }),
  );
  const result = await pool.query(`DELETE FROM document_blobs WHERE file_path = ANY($1::text[])`, [
    paths,
  ]);
  return { removed: result.rowCount ?? 0 };
}

// Cookie-free half of session creation — safe to call from anywhere,
// including request handlers that run outside TanStack's own router (e.g.
// google-oauth.server.ts's manually-intercepted routes in server.ts, which
// run before the AsyncLocalStorage context setCookie()/getCookie() depend
// on is ever established — see createSessionForUser's own comment below).
export async function createSessionTokenForUser(userId: string): Promise<{
  token: string;
  expiresAt: Date;
  user: LocalUser;
}> {
  const result = await pool.query(
    `SELECT id, email, full_name, phone, company_name FROM profiles WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const profile = result.rows[0] as
    | {
        id: string;
        email: string;
        full_name: string;
        phone: string | null;
        company_name: string | null;
      }
    | undefined;
  if (!profile) {
    throw new Error("User not found");
  }
  const roles = await loadUserRoles(userId);
  const token = createToken();
  const expiresAt = sessionExpiresAt(roles);
  await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    userId,
    hashSha256(token),
    expiresAt,
  ]);
  return { token, expiresAt, user: toLocalUser(profile) };
}

// Callers inside a real TanStack request (e.g. a createServerFn handler) —
// use this. Anything intercepted in server.ts before TanStack's router runs
// (see google-oauth.server.ts) must call createSessionTokenForUser directly
// and write its own Set-Cookie header instead, since setCookie() here would
// throw outside that context.
export async function createSessionForUser(userId: string) {
  const { token, expiresAt, user } = await createSessionTokenForUser(userId);
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
  });
  return {
    session: {
      access_token: token,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      user,
    } satisfies LocalSession,
  };
}

export function isTruthySeed(value: unknown): boolean {
  return toBoolean(value);
}
