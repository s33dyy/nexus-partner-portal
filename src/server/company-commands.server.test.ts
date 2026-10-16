import { expect, test } from "bun:test";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "@/domain/contracts/governance";
import type { ActiveContextRecord, AssignmentRecord } from "@/domain/contracts/governance";
import type { GovernedActor } from "@/server/governed-actor.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

const ISSUED_AT = "2026-10-16T00:00:00.000Z";

function buildActor(roleKey: AssignmentRecord["roleKey"] = "super_admin"): GovernedActor {
  const assignment: AssignmentRecord = {
    assignmentId: "assignment-company-admin",
    userId: "11111111-1111-1111-1111-111111111111",
    tenantId: "tenant-livey-org",
    organizationTenantId: "tenant-livey-org",
    roleKey,
    teamDomain: "identity",
    geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
    partnerId: null,
    accountId: null,
    portfolioId: null,
    queueId: null,
    status: "active",
    validFrom: ISSUED_AT,
    validTo: null,
    managerAssignmentId: null,
    source: "test",
    approverUserId: null,
    predecessorAssignmentId: null,
    successorAssignmentId: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: ISSUED_AT,
    updatedAt: ISSUED_AT,
    version: 1,
    isSeed: true,
  };
  const activeContext: ActiveContextRecord = {
    contextId: "context-company-admin",
    userId: assignment.userId,
    assignmentId: assignment.assignmentId,
    assignmentStatus: assignment.status,
    tenantId: assignment.tenantId,
    organizationTenantId: assignment.organizationTenantId,
    workingScope: null,
    issuedAt: ISSUED_AT,
    expiresAt: "2026-10-16T08:00:00.000Z",
    version: 1,
    revocationLink: null,
    correlationId: "corr-company-admin",
    assignmentVersion: assignment.version,
    workingScopeNodeId: null,
    revokedAt: null,
    revocationReason: null,
    isSeed: true,
    createdAt: ISSUED_AT,
    updatedAt: ISSUED_AT,
  };
  return { userId: assignment.userId, assignment, activeContext };
}

type CompanyRow = {
  id: string;
  name: string;
  legal_name: string | null;
  country: string | null;
  region: string | null;
  status: string;
  owner_user_id: string | null;
  is_seed: boolean;
};

type CompanyHarnessState = {
  companies: CompanyRow[];
  profiles: Array<{ company_name: string | null; company_id: string | null }>;
  customers: Array<{ company_name: string; company_id: string | null }>;
  calls: string[];
  failUniqueOnUpdate: boolean;
};

function installFakePool(state: CompanyHarnessState) {
  return async () => {
    const { pool } = await import("@/server/postgres.server");
    const originalConnect = pool.connect.bind(pool);

    const fakeClient = {
      query: async (sql: string, params: unknown[] = []) => {
        const text = sql.trim().replace(/\s+/g, " ");
        state.calls.push(text);

        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
          return { rows: [], rowCount: 0 };
        }

        if (text.startsWith("SELECT id FROM companies WHERE lower(name)")) {
          const [name, excludedId] = params as [string, string | null];
          const row = state.companies.find(
            (company) =>
              company.status !== "deleted" &&
              company.name.toLowerCase() === name.toLowerCase() &&
              company.id !== excludedId,
          );
          return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
        }

        if (text.startsWith("SELECT id, name, legal_name")) {
          return {
            rows: state.companies.map((company) => ({
              ...company,
              linked_user_count: state.profiles.filter(
                (profile) => profile.company_id === company.id,
              ).length,
              linked_customer_count: state.customers.filter(
                (customer) => customer.company_id === company.id,
              ).length,
            })),
            rowCount: state.companies.length,
          };
        }

        if (text.startsWith("SELECT c.id,")) {
          const [companyId] = params as [string];
          const company = state.companies.find((candidate) => candidate.id === companyId);
          return {
            rows: company
              ? [
                  {
                    id: companyId,
                    linked_user_count: state.profiles.filter(
                      (profile) => profile.company_id === companyId,
                    ).length,
                    linked_customer_count: state.customers.filter(
                      (customer) => customer.company_id === companyId,
                    ).length,
                  },
                ]
              : [],
            rowCount: company ? 1 : 0,
          };
        }

        if (text.startsWith("SELECT id, name, legal_name, country, region, status")) {
          const [companyId] = params as [string];
          const company = state.companies.find((candidate) => candidate.id === companyId);
          return {
            rows: company
              ? [
                  {
                    ...company,
                    linked_user_count: state.profiles.filter(
                      (profile) => profile.company_id === company.id,
                    ).length,
                    linked_customer_count: state.customers.filter(
                      (customer) => customer.company_id === company.id,
                    ).length,
                  },
                ]
              : [],
            rowCount: company ? 1 : 0,
          };
        }

        if (text.startsWith("INSERT INTO companies (name, is_seed)")) {
          const names = new Map<string, string>();
          for (const value of [
            ...state.profiles.map((profile) => profile.company_name),
            ...state.customers.map((customer) => customer.company_name),
          ]) {
            const name = value?.trim();
            if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
          }
          let rowCount = 0;
          for (const name of names.values()) {
            if (
              state.companies.some((company) => company.name.toLowerCase() === name.toLowerCase())
            ) {
              continue;
            }
            state.companies.push({
              id: `company-${state.companies.length + 1}`,
              name,
              legal_name: null,
              country: null,
              region: null,
              status: "active",
              owner_user_id: null,
              is_seed: true,
            });
            rowCount += 1;
          }
          return { rows: [], rowCount };
        }

        if (text.startsWith("INSERT INTO companies")) {
          const [id, name, legalName, country, region, ownerUserId, isSeed] = params as [
            string,
            string,
            string | null,
            string | null,
            string | null,
            string | null,
            boolean,
          ];
          const company: CompanyRow = {
            id,
            name,
            legal_name: legalName,
            country,
            region,
            status: "active",
            owner_user_id: ownerUserId,
            is_seed: isSeed,
          };
          state.companies.push(company);
          return { rows: [{ ...company }], rowCount: 1 };
        }

        if (text.startsWith("UPDATE companies SET status = 'deleted'")) {
          const [companyId] = params as [string];
          const company = state.companies.find((candidate) => candidate.id === companyId);
          const hasLinks =
            state.profiles.some((profile) => profile.company_id === companyId) ||
            state.customers.some((customer) => customer.company_id === companyId);
          if (!company || company.status === "deleted" || hasLinks) {
            return { rows: [], rowCount: 0 };
          }
          company.status = "deleted";
          return { rows: [{ id: companyId }], rowCount: 1 };
        }

        if (text.startsWith("UPDATE companies SET name")) {
          if (state.failUniqueOnUpdate) throw { code: "23505" };
          const [name, legalName, country, region, status, companyId] = params as [
            string,
            string | null,
            string | null,
            string | null,
            string,
            string,
          ];
          const company = state.companies.find((candidate) => candidate.id === companyId);
          if (!company) return { rows: [], rowCount: 0 };
          Object.assign(company, {
            name,
            legal_name: legalName,
            country,
            region,
            status,
          });
          return { rows: [{ ...company }], rowCount: 1 };
        }

        if (text.startsWith("UPDATE profiles p SET company_id")) {
          const linked = new Map(
            state.companies
              .filter((company) => company.status !== "deleted")
              .map((company) => [company.name.trim().toLowerCase(), company.id] as const),
          );
          let rowCount = 0;
          for (const profile of state.profiles) {
            if (profile.company_id || !profile.company_name?.trim()) continue;
            const companyId = linked.get(profile.company_name.trim().toLowerCase());
            if (companyId) {
              profile.company_id = companyId;
              rowCount += 1;
            }
          }
          return { rows: [], rowCount };
        }

        if (text.startsWith("UPDATE portal_customers c SET company_id")) {
          const linked = new Map(
            state.companies
              .filter((company) => company.status !== "deleted")
              .map((company) => [company.name.trim().toLowerCase(), company.id] as const),
          );
          let rowCount = 0;
          for (const customer of state.customers) {
            if (customer.company_id || !customer.company_name.trim()) continue;
            const companyId = linked.get(customer.company_name.trim().toLowerCase());
            if (companyId) {
              customer.company_id = companyId;
              rowCount += 1;
            }
          }
          return { rows: [], rowCount };
        }

        throw new Error(`Unhandled statement: ${text}`);
      },
      release: () => undefined,
    };

    pool.connect = (async () => fakeClient) as typeof pool.connect;
    return {
      restore: () => {
        pool.connect = originalConnect as typeof pool.connect;
      },
    };
  };
}

function emptyState(overrides: Partial<CompanyHarnessState> = {}): CompanyHarnessState {
  return {
    companies: [],
    profiles: [],
    customers: [],
    calls: [],
    failUniqueOnUpdate: false,
    ...overrides,
  };
}

test("createCompany trims the name and returns the governed company", async () => {
  const state = emptyState();
  const harness = await installFakePool(state)();
  try {
    const { createCompany } = await import("@/server/company-commands.server");
    const result = await createCompany({
      actor: buildActor(),
      data: { name: "  Acme Systems  ", legalName: "Acme Systems Pvt Ltd" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.company.name).toBe("Acme Systems");
      expect(result.company.legalName).toBe("Acme Systems Pvt Ltd");
    }
  } finally {
    harness.restore();
  }
});

test("createCompany rejects an active duplicate name case-insensitively", async () => {
  const state = emptyState({
    companies: [
      {
        id: "company-1",
        name: "Acme Systems",
        legal_name: null,
        country: null,
        region: null,
        status: "active",
        owner_user_id: null,
        is_seed: false,
      },
    ],
  });
  const harness = await installFakePool(state)();
  try {
    const { createCompany } = await import("@/server/company-commands.server");
    const result = await createCompany({ actor: buildActor(), data: { name: " acme systems " } });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("VALIDATION_FAILED");
    expect(state.companies).toHaveLength(1);
  } finally {
    harness.restore();
  }
});

test("company creation denies a non-Super-Admin before querying", async () => {
  const state = emptyState();
  const harness = await installFakePool(state)();
  try {
    const { createCompany } = await import("@/server/company-commands.server");
    const result = await createCompany({
      actor: buildActor("partner_admin"),
      data: { name: "Acme Systems" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.code).toBe("POLICY_DENIED");
    expect(state.calls).toEqual([]);
  } finally {
    harness.restore();
  }
});

test("deleteCompany reports linked users and customers without deleting", async () => {
  const state = emptyState({
    companies: [
      {
        id: "company-1",
        name: "Acme Systems",
        legal_name: null,
        country: null,
        region: null,
        status: "active",
        owner_user_id: null,
        is_seed: false,
      },
    ],
    profiles: [{ company_name: "Acme Systems", company_id: "company-1" }],
    customers: [{ company_name: "Acme Systems", company_id: "company-1" }],
  });
  const harness = await installFakePool(state)();
  try {
    const { deleteCompany } = await import("@/server/company-commands.server");
    const result = await deleteCompany({ actor: buildActor(), companyId: "company-1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.linkedUserCount).toBe(1);
      expect(result.linkedCustomerCount).toBe(1);
      expect(result.failure.code).toBe("VALIDATION_FAILED");
    }
    expect(state.companies[0]?.status).toBe("active");
  } finally {
    harness.restore();
  }
});

test("deleteCompany atomically deletes an unlinked partner company", async () => {
  const state = emptyState({
    companies: [
      {
        id: "company-1",
        name: "Acme Systems",
        legal_name: null,
        country: null,
        region: null,
        status: "active",
        owner_user_id: null,
        is_seed: false,
      },
    ],
  });
  const harness = await installFakePool(state)();
  try {
    const { deleteCompany } = await import("@/server/company-commands.server");
    const result = await deleteCompany({ actor: buildActor(), companyId: "company-1" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deleted).toBe(true);
    expect(state.companies[0]?.status).toBe("deleted");
    const deleteSql = state.calls.find((sql) => sql.startsWith("UPDATE companies SET status"));
    expect(deleteSql).toContain("NOT EXISTS");
  } finally {
    harness.restore();
  }
});

test("updateCompany returns current linked counts after a successful update", async () => {
  const state = emptyState({
    companies: [
      {
        id: "company-1",
        name: "Acme Systems",
        legal_name: null,
        country: null,
        region: null,
        status: "active",
        owner_user_id: null,
        is_seed: false,
      },
    ],
    profiles: [{ company_name: "Acme Systems", company_id: "company-1" }],
    customers: [{ company_name: "Acme Systems", company_id: "company-1" }],
  });
  const harness = await installFakePool(state)();
  try {
    const { updateCompany } = await import("@/server/company-commands.server");
    const result = await updateCompany({
      actor: buildActor(),
      companyId: "company-1",
      data: { name: "Acme Global" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.company.name).toBe("Acme Global");
      expect(result.company.linkedUserCount).toBe(1);
      expect(result.company.linkedCustomerCount).toBe(1);
    }
    expect(state.calls.some((sql) => sql.startsWith("UPDATE companies SET name"))).toBe(true);
  } finally {
    harness.restore();
  }
});

test("updateCompany translates a concurrent unique-index conflict into a duplicate error", async () => {
  const state = emptyState({
    companies: [
      {
        id: "company-1",
        name: "Acme Systems",
        legal_name: null,
        country: null,
        region: null,
        status: "active",
        owner_user_id: null,
        is_seed: false,
      },
    ],
    failUniqueOnUpdate: true,
  });
  const harness = await installFakePool(state)();
  try {
    const { updateCompany } = await import("@/server/company-commands.server");
    const result = await updateCompany({
      actor: buildActor(),
      companyId: "company-1",
      data: { name: "Acme Global" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_FAILED");
      expect(result.failure.message).toContain("Partner Company");
    }
  } finally {
    harness.restore();
  }
});

test("updateCompany refuses status deleted when users or customers are linked", async () => {
  const state = emptyState({
    companies: [
      {
        id: "company-1",
        name: "Acme Systems",
        legal_name: null,
        country: null,
        region: null,
        status: "active",
        owner_user_id: null,
        is_seed: false,
      },
    ],
    profiles: [{ company_name: "Acme Systems", company_id: "company-1" }],
    customers: [{ company_name: "Acme Systems", company_id: "company-1" }],
  });
  const harness = await installFakePool(state)();
  try {
    const { updateCompany } = await import("@/server/company-commands.server");
    const result = await updateCompany({
      actor: buildActor(),
      companyId: "company-1",
      data: { status: "deleted" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe("VALIDATION_FAILED");
      expect(result.failure.message).toContain("Partner Company");
    }
    expect(state.companies[0]?.status).toBe("active");
  } finally {
    harness.restore();
  }
});

test("backfillLegacyCompanyNames is idempotent and preserves legacy text", async () => {
  const state = emptyState({
    profiles: [
      { company_name: "  Acme Systems ", company_id: null },
      { company_name: "acme systems", company_id: null },
      { company_name: "", company_id: null },
    ],
    customers: [{ company_name: "Beta Logistics", company_id: null }],
  });
  const harness = await installFakePool(state)();
  try {
    const { backfillLegacyCompanyNames } = await import("@/server/company-commands.server");
    const first = await backfillLegacyCompanyNames({ actor: buildActor() });
    const second = await backfillLegacyCompanyNames({ actor: buildActor() });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(state.companies.map((company) => company.name)).toEqual([
      "Acme Systems",
      "Beta Logistics",
    ]);
    expect(state.profiles[0]?.company_name).toBe("  Acme Systems ");
    expect(state.profiles[0]?.company_id).toBe(state.companies[0]?.id);
    expect(state.profiles[1]?.company_id).toBe(state.companies[0]?.id);
    expect(state.customers[0]?.company_id).toBe(state.companies[1]?.id);
    expect(state.calls.filter((sql) => sql.startsWith("INSERT INTO companies"))[0]).toContain(
      "ON CONFLICT",
    );
  } finally {
    harness.restore();
  }
});

test("schema backfill uses the active-name unique index for concurrent safety", async () => {
  const schema = await Bun.file("db/schema.sql").text();
  expect(schema).toContain("ON CONFLICT (lower(name)) WHERE status <> 'deleted' DO NOTHING");
});
