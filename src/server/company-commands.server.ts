import { randomUUID } from "node:crypto";

import type { CommandFailureContract, CommandSuccessResult } from "@/domain/contracts/commands";
import { makePolicyDenial } from "@/domain/contracts/commands";
import { createCorrelationId } from "@/domain/contracts/telemetry";
import { withTransaction, type QueryRunner } from "@/server/command-runtime.server";
import type { GovernedActor } from "@/server/governed-actor.server";

export type CompanyCommandActor = GovernedActor;

export type Company = {
  id: string;
  name: string;
  legalName: string | null;
  country: string | null;
  region: string | null;
  status: string;
  ownerUserId: string | null;
  isSeed: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  linkedUserCount: number;
  linkedCustomerCount: number;
};

export type CreateCompanyInput = {
  name: string;
  legalName?: string | null;
  country?: string | null;
  region?: string | null;
  ownerUserId?: string | null;
};

export type UpdateCompanyInput = {
  name?: string;
  legalName?: string | null;
  country?: string | null;
  region?: string | null;
  status?: string;
};

type CompanyFailure = {
  ok: false;
  failure: CommandFailureContract;
  correlationId: string;
};

export type CompanyListResult =
  | { ok: true; companies: Company[]; correlationId: string }
  | CompanyFailure;

export type CompanyMutationResult = (CommandSuccessResult & { company: Company }) | CompanyFailure;

export type CompanyDeleteResult =
  | (CommandSuccessResult & { deleted: true })
  | (CompanyFailure & { linkedUserCount: number; linkedCustomerCount: number });

export type CompanyBackfillResult =
  | {
      ok: true;
      createdCount: number;
      linkedProfileCount: number;
      linkedCustomerCount: number;
      correlationId: string;
    }
  | CompanyFailure;

type CompanyRow = {
  id: string;
  name: string;
  legal_name: string | null;
  country: string | null;
  region: string | null;
  status: string;
  owner_user_id: string | null;
  is_seed: boolean;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  linked_user_count?: number | string | null;
  linked_customer_count?: number | string | null;
};

function isSuperAdmin(actor: CompanyCommandActor): boolean {
  return actor.assignment.roleKey === "super_admin";
}

function deny(correlationId: string): CompanyFailure {
  return {
    ok: false,
    failure: makePolicyDenial(null, "Only Super Admin can manage companies"),
    correlationId,
  };
}

function validationFailure(message: string, field = "name"): CompanyFailure {
  return {
    ok: false,
    failure: {
      code: "VALIDATION_FAILED",
      message,
      fieldErrors: [{ field, message }],
      retryable: false,
    },
    correlationId: createCorrelationId(),
  };
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function mapCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    country: row.country,
    region: row.region,
    status: row.status,
    ownerUserId: row.owner_user_id,
    isSeed: row.is_seed,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ?? null),
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at ?? null),
    linkedUserCount: Number(row.linked_user_count ?? 0),
    linkedCustomerCount: Number(row.linked_customer_count ?? 0),
  };
}

async function findDuplicate(
  tx: QueryRunner,
  name: string,
  excludedCompanyId: string | null = null,
): Promise<boolean> {
  const result = await tx.query(
    `SELECT id
       FROM companies
      WHERE lower(name) = lower($1)
        AND status <> 'deleted'
        AND ($2::uuid IS NULL OR id <> $2)
      LIMIT 1`,
    [name, excludedCompanyId],
  );
  return result.rows.length > 0;
}

async function loadCompany(tx: QueryRunner, companyId: string): Promise<Company | null> {
  const result = await tx.query(
    `SELECT id, name, legal_name, country, region, status, owner_user_id, is_seed,
            created_at, updated_at,
            (SELECT COUNT(*)::int FROM profiles p WHERE p.company_id = companies.id) AS linked_user_count,
            (SELECT COUNT(*)::int FROM portal_customers c WHERE c.company_id = companies.id) AS linked_customer_count
       FROM companies
      WHERE id = $1`,
    [companyId],
  );
  const row = result.rows[0] as CompanyRow | undefined;
  return row ? mapCompany(row) : null;
}

export async function listCompanies(input: {
  actor: CompanyCommandActor;
}): Promise<CompanyListResult> {
  const correlationId = createCorrelationId();
  if (!isSuperAdmin(input.actor)) return deny(correlationId);

  return withTransaction(async (tx) => {
    const result = await tx.query(
      `SELECT id, name, legal_name, country, region, status, owner_user_id, is_seed,
              created_at, updated_at,
              (SELECT COUNT(*)::int FROM profiles p WHERE p.company_id = companies.id) AS linked_user_count,
              (SELECT COUNT(*)::int FROM portal_customers c WHERE c.company_id = companies.id) AS linked_customer_count
         FROM companies
        ORDER BY lower(name), id`,
    );
    return {
      ok: true,
      companies: result.rows.map((row) => mapCompany(row as CompanyRow)),
      correlationId,
    };
  });
}

export async function createCompany(input: {
  actor: CompanyCommandActor;
  data: CreateCompanyInput;
}): Promise<CompanyMutationResult> {
  const correlationId = createCorrelationId();
  if (!isSuperAdmin(input.actor)) return deny(correlationId);

  const name = input.data.name.trim();
  if (!name || name.length > 160) {
    return {
      ...validationFailure("Company name is required and must be 160 characters or fewer"),
      correlationId,
    };
  }

  try {
    return await withTransaction(async (tx) => {
      if (await findDuplicate(tx, name)) {
        return {
          ...validationFailure("An active company with this name already exists"),
          correlationId,
        };
      }

      const companyId = randomUUID();
      const result = await tx.query(
        `INSERT INTO companies (
           id, name, legal_name, country, region, owner_user_id, is_seed
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, name, legal_name, country, region, status, owner_user_id, is_seed,
                   created_at, updated_at`,
        [
          companyId,
          name,
          optionalText(input.data.legalName),
          optionalText(input.data.country),
          optionalText(input.data.region),
          input.data.ownerUserId ?? null,
          false,
        ],
      );
      const row = result.rows[0] as CompanyRow | undefined;
      if (!row) {
        return {
          ...validationFailure("Company could not be created"),
          correlationId,
        };
      }
      return {
        ok: true,
        commandName: "company.create",
        subjectId: companyId,
        newVersion: 1,
        nextAuthorisedActions: ["company.update", "company.delete"],
        correlationId,
        company: mapCompany(row),
      };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return {
        ...validationFailure("An active company with this name already exists"),
        correlationId,
      };
    }
    throw error;
  }
}

export async function updateCompany(input: {
  actor: CompanyCommandActor;
  companyId: string;
  data: UpdateCompanyInput;
}): Promise<CompanyMutationResult> {
  const correlationId = createCorrelationId();
  if (!isSuperAdmin(input.actor)) return deny(correlationId);

  return withTransaction(async (tx) => {
    const current = await loadCompany(tx, input.companyId);
    if (!current) {
      return { ...validationFailure("Company not found", "companyId"), correlationId };
    }

    const name = input.data.name === undefined ? current.name : input.data.name.trim();
    if (!name || name.length > 160) {
      return {
        ...validationFailure("Company name is required and must be 160 characters or fewer"),
        correlationId,
      };
    }
    if (await findDuplicate(tx, name, input.companyId)) {
      return {
        ...validationFailure("An active company with this name already exists"),
        correlationId,
      };
    }

    const result = await tx.query(
      `UPDATE companies
          SET name = $1,
              legal_name = $2,
              country = $3,
              region = $4,
              status = $5
        WHERE id = $6
        RETURNING id, name, legal_name, country, region, status, owner_user_id, is_seed,
                  created_at, updated_at`,
      [
        name,
        input.data.legalName === undefined ? current.legalName : optionalText(input.data.legalName),
        input.data.country === undefined ? current.country : optionalText(input.data.country),
        input.data.region === undefined ? current.region : optionalText(input.data.region),
        input.data.status?.trim() || current.status,
        input.companyId,
      ],
    );
    const row = result.rows[0] as CompanyRow | undefined;
    if (!row) return { ...validationFailure("Company not found", "companyId"), correlationId };
    return {
      ok: true,
      commandName: "company.update",
      subjectId: input.companyId,
      newVersion: 1,
      nextAuthorisedActions: ["company.update", "company.delete"],
      correlationId,
      company: mapCompany(row),
    };
  });
}

export async function deleteCompany(input: {
  actor: CompanyCommandActor;
  companyId: string;
}): Promise<CompanyDeleteResult> {
  const correlationId = createCorrelationId();
  if (!isSuperAdmin(input.actor)) {
    return { ...deny(correlationId), linkedUserCount: 0, linkedCustomerCount: 0 };
  }

  return withTransaction(async (tx) => {
    const countsResult = await tx.query(
      `SELECT COUNT(*)::int AS linked_user_count,
              (SELECT COUNT(*)::int FROM portal_customers c WHERE c.company_id = $1) AS linked_customer_count
         FROM profiles p
        WHERE p.company_id = $1`,
      [input.companyId],
    );
    const counts = countsResult.rows[0] as
      | { linked_user_count: number | string; linked_customer_count: number | string }
      | undefined;
    if (!counts) {
      return {
        ...validationFailure("Company not found", "companyId"),
        correlationId,
        linkedUserCount: 0,
        linkedCustomerCount: 0,
      };
    }

    const linkedUserCount = Number(counts.linked_user_count);
    const linkedCustomerCount = Number(counts.linked_customer_count);
    if (linkedUserCount > 0 || linkedCustomerCount > 0) {
      return {
        ...validationFailure(
          `Company cannot be deleted while linked to ${linkedUserCount} user(s) and ${linkedCustomerCount} customer(s)`,
          "companyId",
        ),
        correlationId,
        linkedUserCount,
        linkedCustomerCount,
      };
    }

    const deleted = await tx.query(
      `UPDATE companies SET status = 'deleted' WHERE id = $1 AND status <> 'deleted'`,
      [input.companyId],
    );
    if ((deleted.rowCount ?? 0) === 0) {
      return {
        ...validationFailure("Company not found", "companyId"),
        correlationId,
        linkedUserCount: 0,
        linkedCustomerCount: 0,
      };
    }
    return {
      ok: true,
      commandName: "company.delete",
      subjectId: input.companyId,
      newVersion: 1,
      nextAuthorisedActions: [],
      correlationId,
      deleted: true,
    };
  });
}

export async function backfillLegacyCompanyNames(input: {
  actor: CompanyCommandActor;
}): Promise<CompanyBackfillResult> {
  const correlationId = createCorrelationId();
  if (!isSuperAdmin(input.actor)) return deny(correlationId);

  return withTransaction(async (tx) => {
    const created = await tx.query(
      `INSERT INTO companies (name, is_seed)
       SELECT MIN(legacy_name), TRUE
         FROM (
           SELECT btrim(company_name) AS legacy_name
             FROM profiles
            WHERE NULLIF(btrim(company_name), '') IS NOT NULL
           UNION ALL
           SELECT btrim(company_name) AS legacy_name
             FROM portal_customers
            WHERE NULLIF(btrim(company_name), '') IS NOT NULL
         ) legacy_names
        WHERE NOT EXISTS (
          SELECT 1
            FROM companies existing
           WHERE existing.status <> 'deleted'
             AND lower(existing.name) = lower(legacy_names.legacy_name)
        )
        GROUP BY lower(legacy_name)`,
    );
    const linkedProfiles = await tx.query(
      `UPDATE profiles p
          SET company_id = companies.id
         FROM companies
        WHERE p.company_id IS NULL
          AND NULLIF(btrim(p.company_name), '') IS NOT NULL
          AND companies.status <> 'deleted'
          AND lower(companies.name) = lower(btrim(p.company_name))`,
    );
    const linkedCustomers = await tx.query(
      `UPDATE portal_customers c
          SET company_id = companies.id
         FROM companies
        WHERE c.company_id IS NULL
          AND NULLIF(btrim(c.company_name), '') IS NOT NULL
          AND companies.status <> 'deleted'
          AND lower(companies.name) = lower(btrim(c.company_name))`,
    );
    return {
      ok: true,
      createdCount: created.rowCount ?? 0,
      linkedProfileCount: linkedProfiles.rowCount ?? 0,
      linkedCustomerCount: linkedCustomers.rowCount ?? 0,
      correlationId,
    };
  });
}

export const backfillLegacyCompanies = backfillLegacyCompanyNames;
