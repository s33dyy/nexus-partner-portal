import { randomUUID } from "node:crypto";
import { pool } from "@/server/postgres.server";
import { getAuthContext } from "@/server/livey-service.server";
import {
  buildCatalogInsertRow,
  buildCatalogCreateValues,
  getCatalogKindLabel,
  normalizeCatalogKind,
  pickCatalogInsertColumns,
  type CatalogKind,
} from "@/lib/catalog";

import type { DropdownOption, DropdownSourceKey } from "@/lib/dropdown-sources";

/** None of the functions in this file had any authentication or
 * authorization check at all — every createServerFn wrapping them
 * (dropdown-sources.ts) passes the client's input straight through. Any
 * caller, including an anonymous one, could:
 *   - listDropdownSourceValues("account"/"client"/default): read every
 *     partner's company/legal name, every customer across every partner
 *     (company, region, segment, MRR), and every profile's full_name/email
 *     system-wide, by simply omitting the optional partnerId/userId filter
 *     (or passing someone else's).
 *   - createCatalogItemFromDropdown / updateCatalogItemFromDropdown: write
 *     arbitrary pricing/stock/tier into the shared product catalogue with
 *     no admin check, even though the only UI caller (admin.catalog.tsx)
 *     is super_admin-gated.
 *   - createCustomerFromDropdown: plant a customer record under any
 *     partner_id/user_id of the caller's choosing.
 * Fixed by resolving the real session server-side and, for every non-
 * super_admin caller, forcing partner/user scope to their own identity
 * rather than trusting the client-supplied value — matching the same
 * pattern already applied to createWorkspaceUser and the document-access
 * endpoints elsewhere in this codebase. "lookup" and "catalog" reads
 * remain intentionally open to any authenticated-or-not caller, matching
 * table-policy.server.ts's PUBLIC_READ_TABLES precedent for those same two
 * tables (lookup_values, portal_catalog_items). */
export type DropdownCallerAuth = {
  userId: string;
  partnerId: string | null;
  isSuperAdmin: boolean;
  // §2.4/§8.7a/§8.8: "Distributor cannot discover an untagged Customer" —
  // this lookup runs its own raw SQL rather than going through
  // table-policy.server.ts's applyTablePolicy, so the tag-only scoping
  // added there for restricted_distributor has to be re-applied here too.
  isDistributor: boolean;
};

async function requireAuthenticatedCaller(): Promise<DropdownCallerAuth> {
  const ctx = await getAuthContext();
  const userId = ctx.session?.user.id ?? null;
  if (!userId) {
    throw new Error("Access denied");
  }
  return {
    userId,
    partnerId: (ctx.profile as { partner_id?: string | null } | null)?.partner_id ?? null,
    isSuperAdmin: ctx.roles.includes("super_admin"),
    isDistributor: ctx.roles.includes("restricted_distributor"),
  };
}

/** Pure, unit-testable core of the account/client/profile scoping fix — a
 * non-super_admin caller's own identity always wins over whatever
 * partnerId/userId the client passed in. */
export function resolveDropdownScope(
  auth: DropdownCallerAuth,
  input: { partnerId?: string | null; userId?: string | null },
): { scopedPartnerId: string | null; scopedUserId: string | null } {
  if (auth.isSuperAdmin) {
    return { scopedPartnerId: input.partnerId ?? null, scopedUserId: input.userId ?? null };
  }
  return {
    scopedPartnerId: auth.partnerId,
    scopedUserId: auth.partnerId ? null : auth.userId,
  };
}

/** Pure, unit-testable core of createCustomerFromDropdown's ownership fix. */
export function resolveDropdownCustomerOwner(
  auth: DropdownCallerAuth,
  input: { partner_id?: string | null; user_id?: string | null },
): { ownerPartnerId: string | null; ownerUserId: string | null } {
  if (auth.isSuperAdmin) {
    return {
      ownerPartnerId: input.partner_id ?? null,
      ownerUserId: input.user_id ?? null,
    };
  }
  return { ownerPartnerId: auth.partnerId, ownerUserId: auth.userId };
}

/** Pure, unit-testable core of the two catalog-write functions' admin gate. */
export function assertSuperAdminCaller(auth: DropdownCallerAuth) {
  if (!auth.isSuperAdmin) {
    throw new Error("Access denied");
  }
}

function normalizeTerm(value: string | undefined | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed;
}

function likePattern(value: string) {
  return `%${value.replace(/[%_]/g, "\\$&")}%`;
}

async function getPortalCatalogItemColumns() {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'portal_catalog_items'`,
  );
  return new Set(result.rows.map((row) => String(row.column_name)));
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
  // Callers outside a TanStack Start request (e.g. the WhatsApp webhook,
  // which has no session cookie to read) already have a resolved caller
  // identity and pass it here instead of letting requireAuthenticatedCaller
  // re-derive it from getAuthContext()/the request cookie.
  callerAuth?: DropdownCallerAuth;
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

  // account/client/profile all read across tenants (partners, customers,
  // profiles) — the caller must be authenticated, and a non-super_admin
  // caller's own partner/user identity always wins over whatever the
  // client passed, so this can never be used to browse another tenant's
  // records by supplying (or omitting) partnerId/userId.
  const auth = input.callerAuth ?? (await requireAuthenticatedCaller());
  const { scopedPartnerId, scopedUserId } = resolveDropdownScope(auth, input);

  if (input.source === "account") {
    const values: unknown[] = [];
    const where: string[] = [];
    let sql = `SELECT id, company_name AS label, legal_name AS description
               FROM partners`;
    if (scopedPartnerId) {
      values.push(scopedPartnerId);
      where.push(`id = $${values.length}`);
    } else if (scopedUserId) {
      values.push(scopedUserId);
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
    if (scopedPartnerId) {
      values.push(scopedPartnerId);
      where.push(`partner_id = $${values.length}`);
    } else if (scopedUserId) {
      values.push(scopedUserId);
      where.push(`user_id = $${values.length}`);
    }
    if (auth.isDistributor && auth.userId) {
      values.push(auth.userId);
      where.push(
        `id IN (SELECT customer_id FROM customer_participants WHERE participant_user_id = $${values.length} AND valid_to IS NULL)`,
      );
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
  if (scopedPartnerId) {
    values.push(scopedPartnerId);
    where.push(`partner_id = $${values.length}`);
  } else if (scopedUserId) {
    values.push(scopedUserId);
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
  // admin.catalog.tsx (the only UI caller) is itself gated to super_admin —
  // this enforces that server-side too.
  const auth = await requireAuthenticatedCaller();
  assertSuperAdminCaller(auth);

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

export async function updateCatalogItemFromDropdown(input: {
  id: string;
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
  const auth = await requireAuthenticatedCaller();
  assertSuperAdminCaller(auth);

  const values = buildCatalogCreateValues(input);
  const columns = await getPortalCatalogItemColumns();
  const updatedAt = new Date().toISOString();
  const updatableValues = {
    ...values,
    updated_at: updatedAt,
  };
  const orderedColumns: Array<keyof typeof updatableValues> = [
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
    "updated_at",
  ];
  const updateColumns = orderedColumns.filter((column) => columns.has(column));
  if (updateColumns.length === 0) {
    throw new Error("No writable catalog columns available");
  }

  const setSql = updateColumns.map((column, index) => `${column} = $${index + 1}`).join(", ");
  const updateParams = updateColumns.map((column) => updatableValues[column]);
  const result = await pool.query(
    `UPDATE portal_catalog_items
     SET ${setSql}
     WHERE id = $${updateParams.length + 1}
     RETURNING *`,
    [...updateParams, input.id],
  );

  const updated = result.rows[0];
  if (!updated) {
    throw new Error("Catalog item not found");
  }

  return updated;
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
  // customer-quick-create-dialog.tsx passes the current user's own
  // userId/partnerId as props — but since that's just client input to this
  // function, a non-super_admin caller could otherwise supply any user_id/
  // partner_id and plant a customer record under a different tenant. Force
  // their own identity instead of trusting the client for those two
  // fields; super_admin keeps full flexibility (e.g. creating on behalf of
  // a specific partner from an admin view).
  const auth = await requireAuthenticatedCaller();
  const { ownerPartnerId, ownerUserId } = resolveDropdownCustomerOwner(auth, input);

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
      ownerUserId,
      ownerPartnerId,
      createdAt,
      createdAt,
    ],
  );

  return result.rows[0];
}
