import { randomUUID } from "node:crypto";

import { pool } from "@/server/postgres.server";

import type { DropdownOption, DropdownSourceKey } from "@/lib/dropdown-sources";

function normalizeTerm(value: string | undefined | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed;
}

function likePattern(value: string) {
  return `%${value.replace(/[%_]/g, "\\$&")}%`;
}

function toOption(row: Record<string, unknown>, source: DropdownSourceKey): DropdownOption {
  const id = String(row.id ?? "");
  const label = String(row.label ?? row.value ?? row.company_name ?? row.full_name ?? "");
  const description = row.description == null ? null : String(row.description);
  return {
    id,
    label,
    description,
    source,
  };
}

export async function listDropdownSourceValues(input: {
  source: DropdownSourceKey;
  fieldName?: string;
  q?: string;
  partnerId?: string | null;
  userId?: string | null;
}) {
  const term = normalizeTerm(input.q);
  const search = term ? likePattern(term) : "";

  if (input.source === "lookup") {
    if (!input.fieldName) {
      throw new Error("fieldName is required for lookup dropdowns");
    }
    const values: unknown[] = [input.fieldName];
    let sql = `SELECT id, value AS label, NULL::text AS description
               FROM lookup_values
               WHERE field_name = $1`;
    if (term) {
      values.push(search);
      sql += ` AND value ILIKE $2`;
    }
    sql += ` ORDER BY value ASC`;
    const result = await pool.query(sql, values);
    return result.rows.map((row) => toOption(row, input.source));
  }

  if (input.source === "account") {
    const values: unknown[] = [];
    const where: string[] = [];
    let sql = `SELECT id, company_name AS label, legal_name AS description
               FROM partners`;
    if (input.partnerId) {
      values.push(input.partnerId);
      where.push(`id = $${values.length}`);
    } else if (input.userId) {
      values.push(input.userId);
      where.push(`owner_user_id = $${values.length}`);
    }
    if (term) {
      values.push(search, search);
      where.push(
        `(company_name ILIKE $${values.length - 1} OR COALESCE(legal_name, '') ILIKE $${values.length})`,
      );
    }
    if (where.length) {
      sql += ` WHERE ${where.join(" AND ")}`;
    }
    sql += ` ORDER BY company_name ASC`;
    const result = await pool.query(sql, values);
    return result.rows.map((row) => toOption(row, input.source));
  }

  if (input.source === "client") {
    const values: unknown[] = [];
    const where: string[] = [];
    let sql = `SELECT id, company_name AS label, account_owner AS description, region, segment, mrr
               FROM portal_customers`;
    if (input.partnerId) {
      values.push(input.partnerId);
      where.push(`partner_id = $${values.length}`);
    } else if (input.userId) {
      values.push(input.userId);
      where.push(`user_id = $${values.length}`);
    }
    if (term) {
      values.push(search, search, search, search, search);
      where.push(
        `(company_name ILIKE $${values.length - 4}
          OR account_owner ILIKE $${values.length - 3}
          OR COALESCE(region, '') ILIKE $${values.length - 2}
          OR COALESCE(segment, '') ILIKE $${values.length - 1}
          OR COALESCE(mrr, '') ILIKE $${values.length})`,
      );
    }
    if (where.length) {
      sql += ` WHERE ${where.join(" AND ")}`;
    }
    sql += ` ORDER BY company_name ASC`;
    const result = await pool.query(sql, values);
    return result.rows.map((row) => toOption(row, input.source));
  }

  const values: unknown[] = [];
  const where: string[] = [];
  let sql = `SELECT id, full_name AS label, email AS description
             FROM profiles`;
  if (input.partnerId) {
    values.push(input.partnerId);
    where.push(`partner_id = $${values.length}`);
  } else if (input.userId) {
    values.push(input.userId);
    where.push(`id = $${values.length}`);
  }
  if (term) {
    values.push(search, search, search);
    where.push(
      `(full_name ILIKE $${values.length - 2}
        OR COALESCE(email, '') ILIKE $${values.length - 1}
        OR COALESCE(company_name, '') ILIKE $${values.length})`,
    );
  }
  if (where.length) {
    sql += ` WHERE ${where.join(" AND ")}`;
  }
  sql += ` ORDER BY full_name ASC`;
  const result = await pool.query(sql, values);
  return result.rows.map((row) => toOption(row, input.source));
}

export async function createCustomerFromDropdown(input: {
  company_name: string;
  account_owner: string;
  region: string;
  segment: string;
  health_score?: number;
  mrr: string;
  renewal_date: string;
  status: string;
  next_step: string;
  last_touch?: string;
  user_id?: string | null;
  partner_id?: string | null;
}) {
  const createdAt = new Date().toISOString();
  const result = await pool.query(
    `INSERT INTO portal_customers (
       id, company_name, account_owner, region, segment, health_score, mrr,
       renewal_date, status, next_step, last_touch, user_id, partner_id,
       is_seed, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,$14,$15)
     RETURNING *`,
    [
      randomUUID(),
      input.company_name.trim(),
      input.account_owner.trim(),
      input.region.trim(),
      input.segment.trim(),
      input.health_score ?? 0,
      input.mrr.trim(),
      input.renewal_date,
      input.status.trim(),
      input.next_step.trim(),
      input.last_touch?.trim() || "New",
      input.user_id ?? null,
      input.partner_id ?? null,
      createdAt,
      createdAt,
    ],
  );

  return result.rows[0];
}
