import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import bcrypt from "bcryptjs";
import { deleteCookie, getCookie, getRequestUrl, setCookie } from "@tanstack/react-start/server";
import type { PoolClient } from "pg";

import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import { pool } from "@/server/postgres.server";
import { applyTablePolicy, type TablePolicyAuthContext } from "@/server/table-policy.server";
import type { PartnerStatus } from "@/lib/partner-status";
import {
  deleteFromCloudinary,
  hasCloudinaryConfig,
  uploadToCloudinary,
} from "@/server/cloudinary.server";

export type AppRole = "super_admin" | "partner_admin" | "partner_user";
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
  operator: "eq";
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
    "reason",
    "valid_from",
    "valid_to",
    "provenance",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  deal_participants: [
    "id",
    "deal_id",
    "partner_id",
    "participant_type",
    "source",
    "actor_id",
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
    "is_seed",
    "created_at",
  ],
};

const SESSION_COOKIE = "livey_session";
const SESSION_DAYS = 14;
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
    if (filter.operator !== "eq") {
      throw new Error(`Unsupported filter operator: ${filter.operator}`);
    }
    if (!columns.includes(filter.column)) {
      throw new Error(`Unsupported filter column: ${filter.column}`);
    }
    whereClauses.push(`${quoteIdent(filter.column)} = $${parameterOffset + index + 1}`);
    whereParams.push(filter.value);
  });

  return {
    whereSql: whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "",
    whereParams,
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

function sessionExpiresAt(): Date {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
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

  if (policyQuery.operation === "select") {
    const { whereSql, whereParams } = buildWhereClause(filters, columns);
    const result = await pool.query(
      `SELECT * FROM ${quoteIdent(policyQuery.table)}${whereSql}${orderSql}`,
      whereParams,
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
    const result = await pool.query(
      `SELECT count(*) AS count FROM ${quoteIdent(policyQuery.table)}${whereSql}`,
      whereParams,
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

  const [{ rows: profileRows }, { rows: roleRows }, governedState] = await Promise.all([
    pool.query(
      `SELECT id, email, password_hash, full_name, phone, company_name, avatar_url, partner_id, partner_status, must_reset_password
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
        password_hash: string;
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

  const token = createToken();
  const expiresAt = sessionExpiresAt();
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

  const token = createToken();
  const expiresAt = sessionExpiresAt();
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
  const ctx = await getAuthContext();
  if (!ctx.roles.includes("super_admin") && !ctx.roles.includes("partner_admin")) {
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

async function insertWorkspaceUserRecord(
  client: PoolClient,
  ctx: Awaited<ReturnType<typeof getAuthContext>>,
  input: WorkspaceUserInput,
) {
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
  const partnerId =
    input.partner_id || (ctx.profile as { partner_id?: string | null } | null)?.partner_id || null;

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
  const ctx = await getAuthContext();
  if (!ctx.roles.includes("super_admin") && !ctx.roles.includes("partner_admin")) {
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

  const companyName = input.company_name.trim();
  if (!companyName) {
    throw new Error("Company name is required for team imports");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const createdAt = new Date().toISOString();

    for (const row of input.rows) {
      const createdUser = await insertWorkspaceUserRecord(client, ctx, {
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        company_name: companyName,
        password: row.password,
        role: row.portal_role,
        partner_status: "approved",
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

export async function requestPasswordReset(email: string) {
  const result = await pool.query(
    `SELECT id, email, full_name FROM profiles WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  const profile = result.rows[0] as { id: string; email: string; full_name: string } | undefined;
  if (!profile) {
    return { resetLink: null };
  }

  const token = createToken();
  const expiresAt = resetExpiresAt();
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [profile.id, hashSha256(token), expiresAt],
  );

  const origin = getRequestUrl().origin;
  return {
    resetLink: `${origin}/reset-password?token=${token}`,
  };
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

  const sessionToken = createToken();
  const expiresAt = sessionExpiresAt();
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

  return { temporaryPassword };
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

export async function createSessionForUser(userId: string) {
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
  const token = createToken();
  const expiresAt = sessionExpiresAt();
  await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [
    userId,
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
  };
}

export function isTruthySeed(value: unknown): boolean {
  return toBoolean(value);
}
