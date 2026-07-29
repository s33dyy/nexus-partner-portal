import { pool } from "@/server/postgres.server";
import {
  buildCatalogInsertRow,
  buildCatalogCreateValues,
  getCatalogKindLabel,
  normalizeCatalogKind,
  pickCatalogInsertColumns,
  type CatalogKind,
} from "@/lib/catalog";

import type { DropdownOption, DropdownSourceKey } from "@/lib/dropdown-sources";

function normalizeTerm(value: string | undefined | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed;
}

function likePattern(value: string) {
  return `%${value.replace(/[%_]/g, "\\$&")}%`;
}

const portalCatalogItemColumnsPromise = (async () => {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'portal_catalog_items'`,
  );
  return new Set(result.rows.map((row) => String(row.column_name)));
})();

async function getPortalCatalogItemColumns() {
  return portalCatalogItemColumnsPromise;
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
  catalogKind?: CatalogKind | "all";
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

  if (input.source === "catalog") {
    const values: unknown[] = [];
    const where: string[] = [];
    const columns = await getPortalCatalogItemColumns();
    const hasCatalogKindColumn = columns.has("catalog_kind");
    let sql = hasCatalogKindColumn
      ? `SELECT id, sku, product_name AS label, category, partner_tier, catalog_kind
               FROM portal_catalog_items`
      : `SELECT id, sku, product_name AS label, category, partner_tier, 'product'::text AS catalog_kind
               FROM portal_catalog_items`;

    if (input.catalogKind && input.catalogKind !== "all") {
      if (!hasCatalogKindColumn && input.catalogKind === "combo") {
        return [];
      }
      if (hasCatalogKindColumn) {
        values.push(input.catalogKind);
        where.push(`COALESCE(catalog_kind, 'product') = $${values.length}`);
      }
    }

    if (term) {
      values.push(search, search, search, search);
      where.push(
        `(sku ILIKE $${values.length - 3}
          OR product_name ILIKE $${values.length - 2}
          OR COALESCE(category, '') ILIKE $${values.length - 1}
          OR COALESCE(partner_tier, '') ILIKE $${values.length})`,
      );
    }

    if (where.length) {
      sql += ` WHERE ${where.join(" AND ")}`;
    }

    sql += ` ORDER BY updated_at DESC, product_name ASC`;
    const result = await pool.query(sql, values);
    return result.rows.map((row) => ({
      id: String(row.id ?? ""),
      label: String(row.label ?? row.product_name ?? ""),
      description: `${getCatalogKindLabel(normalizeCatalogKind(row.catalog_kind as string | null))} · ${
        row.sku ?? ""
      }`,
      source: input.source,
    }));
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

export async function createCatalogItemFromDropdown(input: {
  product_name: string;
  sku?: string;
  category?: string;
  partner_tier?: string;
  list_price?: string;
  margin?: string;
  stock?: number;
  availability?: string;
  benefits?: string;
  catalog_kind?: CatalogKind;
}) {
  const values = buildCatalogCreateValues(input);
  const row = buildCatalogInsertRow(values);
  const columns = await getPortalCatalogItemColumns();
  const insert = pickCatalogInsertColumns(row, columns);
  const placeholders = insert.columns.map((_, index) => `$${index + 1}`).join(", ");

  const result = await pool.query(
    `INSERT INTO portal_catalog_items (${insert.columns.join(", ")})
     VALUES (${placeholders})
     RETURNING *`,
    insert.values,
  );

  return result.rows[0];
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
