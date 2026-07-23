import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import bcrypt from "bcryptjs";
import { deleteCookie, getCookie, getRequestUrl, setCookie } from "@tanstack/react-start/server";

import { pool } from "@/server/postgres.server";
import {
  deleteFromCloudinary,
  hasCloudinaryConfig,
  uploadToCloudinary,
} from "@/server/cloudinary.server";

export type AppRole = "super_admin" | "partner_admin" | "partner_user";
export type PartnerStatus =
  | "pending_partner_registration"
  | "submitted"
  | "under_review"
  | "need_more_info"
  | "approved"
  | "rejected";

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
    "is_seed",
    "created_at",
    "updated_at",
  ],
  user_roles: ["id", "user_id", "role", "is_seed", "created_at"],
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
    "customer_budget",
    "probability",
    "possible_close_date",
    "close_date",
    "source",
    "last_touch",
    "notes",
    "user_id",
    "partner_id",
    "is_seed",
    "created_at",
    "updated_at",
  ],
  portal_customers: [
    "id",
    "company_name",
    "account_owner",
    "region",
    "segment",
    "health_score",
    "mrr",
    "renewal_date",
    "status",
    "next_step",
    "last_touch",
    "user_id",
    "partner_id",
    "is_seed",
    "created_at",
    "updated_at",
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

export async function queryTable(query: TableQuery) {
  assertTable(query.table);
  const columns = TABLE_COLUMNS[query.table];
  const filters = query.filters ?? [];
  const order = query.order;
  const values = query.values;
  const orderSql =
    order && columns.includes(order.column)
      ? ` ORDER BY ${quoteIdent(order.column)} ${order.ascending === false ? "DESC" : "ASC"}`
      : "";

  if (query.operation === "select") {
    const { whereSql, whereParams } = buildWhereClause(filters, columns);
    const result = await pool.query(
      `SELECT * FROM ${quoteIdent(query.table)}${whereSql}${orderSql}`,
      whereParams,
    );
    const data = result.rows.map((row) => serializeDbValue(row));
    return {
      data:
        query.single === "single"
          ? (data[0] ?? null)
          : query.single === "maybeSingle"
            ? (data[0] ?? null)
            : data,
      error: null,
    };
  }

  if (query.operation === "count") {
    const { whereSql, whereParams } = buildWhereClause(filters, columns);
    const result = await pool.query(
      `SELECT count(*) AS count FROM ${quoteIdent(query.table)}${whereSql}`,
      whereParams,
    );
    return {
      data: result.rows[0]?.count ?? 0,
      error: null,
    };
  }

  if (query.operation === "insert") {
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
      const sql = `INSERT INTO ${quoteIdent(query.table)} (${rowColumns
        .map(quoteIdent)
        .join(
          ", ",
        )}) VALUES (${rowColumns.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING *`;
      const result = await pool.query(sql, rowParams);
      inserted.push(serializeDbValue(result.rows[0]));
    }

    return {
      data:
        query.single === "single"
          ? (inserted[0] ?? null)
          : query.single === "maybeSingle"
            ? (inserted[0] ?? null)
            : inserted,
      error: null,
    };
  }

  if (query.operation === "update") {
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
      `UPDATE ${quoteIdent(query.table)} SET ${setSql}${whereSql} RETURNING *`,
      [...updateParams, ...whereParams],
    );
    const rows = result.rows.map((row) => serializeDbValue(row));
    return {
      data:
        query.single === "single"
          ? (rows[0] ?? null)
          : query.single === "maybeSingle"
            ? (rows[0] ?? null)
            : rows,
      error: null,
    };
  }

  if (query.operation === "delete") {
    const { whereSql, whereParams } = buildWhereClause(filters, columns);
    const result = await pool.query(
      `DELETE FROM ${quoteIdent(query.table)}${whereSql} RETURNING *`,
      whereParams,
    );
    const rows = result.rows.map((row) => serializeDbValue(row));
    return {
      data:
        query.single === "single"
          ? (rows[0] ?? null)
          : query.single === "maybeSingle"
            ? (rows[0] ?? null)
            : rows,
      error: null,
    };
  }

  throw new Error(`Unsupported operation: ${query.operation}`);
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
    `SELECT s.token_hash, s.expires_at, p.id, p.email, p.full_name, p.phone, p.company_name
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

export async function getAuthContext(token?: string) {
  const session = token ? await getSessionFromToken(token) : await findSessionFromRequest();
  if (!session) {
    return { session: null, profile: null, roles: [] as AppRole[] };
  }

  const [{ rows: profileRows }, { rows: roleRows }] = await Promise.all([
    pool.query(
      `SELECT id, email, password_hash, full_name, phone, company_name, avatar_url, partner_id, partner_status
       FROM profiles WHERE id = $1 LIMIT 1`,
      [session.user.id],
    ),
    pool.query(`SELECT role FROM user_roles WHERE user_id = $1 ORDER BY created_at ASC`, [
      session.user.id,
    ]),
  ]);

  const profile = profileRows[0]
    ? {
        ...(profileRows[0] as Record<string, unknown>),
        partner_status: profileRows[0].partner_status as PartnerStatus,
      }
    : null;

  const roles = roleRows.map((row: { role: AppRole }) => row.role);

  return { session, profile, roles };
}

export async function signInWithPassword(email: string, password: string) {
  const result = await pool.query(
    `SELECT id, email, password_hash, full_name, phone, company_name, avatar_url, partner_id, partner_status
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
}) {
  const ctx = await getAuthContext();
  if (!ctx.roles.includes("super_admin") && !ctx.roles.includes("partner_admin")) {
    throw new Error("Unauthorized");
  }

  const existing = await pool.query(`SELECT id FROM profiles WHERE lower(email) = lower($1)`, [
    input.email,
  ]);
  if (existing.rows.length > 0) {
    throw new Error("An account with that email already exists");
  }

  const id = randomUUID();
  const passwordHash = await bcrypt.hash(input.password, 10);
  await pool.query(
    `INSERT INTO profiles (id, email, password_hash, full_name, phone, company_name, partner_status, partner_id, is_seed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)`,
    [
      id,
      input.email,
      passwordHash,
      input.full_name,
      input.phone || null,
      input.company_name,
      input.partner_status ??
        (input.role === "super_admin" ? "approved" : "pending_partner_registration"),
      input.partner_id || (ctx.profile as { partner_id?: string | null } | null)?.partner_id || null,
    ],
  );
  await pool.query(`INSERT INTO user_roles (user_id, role, is_seed) VALUES ($1, $2, false)`, [
    id,
    input.role,
  ]);

  return {
    id,
    email: input.email,
    full_name: input.full_name,
    phone: input.phone || null,
    company_name: input.company_name,
    role: input.role,
    partner_status:
      input.partner_status ??
      (input.role === "super_admin" ? "approved" : "pending_partner_registration"),
  };
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
  await pool.query(`UPDATE profiles SET password_hash = $1 WHERE id = $2`, [
    passwordHash,
    session.user.id,
  ]);
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
  await pool.query(`UPDATE profiles SET password_hash = $1 WHERE id = $2`, [
    passwordHash,
    row.user_id,
  ]);
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
      const archiveEntry = await downloadCloudinaryDocumentBytes(
        parsed.publicId,
        parsed.resourceType,
      );
      const mimeType = blob.mime_type || "application/octet-stream";
      return {
        signedUrl: `data:${mimeType};base64,${archiveEntry.bytes.toString("base64")}`,
        fileName: blob.file_name,
      };
    }
  } catch {
    // Fall back to the legacy in-DB binary blob format below.
  }

  const base64 = Buffer.from(blob.file_data).toString("base64");
  return {
    signedUrl: `data:${blob.mime_type};base64,${base64}`,
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
