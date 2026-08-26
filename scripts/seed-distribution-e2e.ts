import "dotenv/config";

import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

import { GOVERNANCE_GEOGRAPHY_NODE_IDS } from "../src/domain/contracts/governance";
import { createPool } from "./db";

/**
 * Deterministic Distribution fixtures for E2E and demos.
 *
 * Everything that touches stock goes through the named commands, never a
 * direct INSERT: locations are created with createStockLocation() and the
 * opening balances are posted with postManualStockMovement(). Inserting
 * inventory_balances rows straight into the database would mean the E2E setup
 * exercised a path the product does not have, and the balance projection
 * would carry quantities with no movement behind them — which is exactly the
 * divergence §24.2 calls an incident.
 *
 * Idempotent: re-running reuses the same identities, locations, and movement
 * idempotency keys, so it converges rather than stacking up duplicates.
 *
 *   bun scripts/seed-distribution-e2e.ts
 *
 * Set E2E_DISTRIBUTION_PASSWORD to control the fixture logins; it defaults to
 * a fixed development value that is obviously not a production secret.
 */

const PASSWORD = process.env.E2E_DISTRIBUTION_PASSWORD ?? "DistributionE2E!2026";
const TENANT_ID = "tenant-livey-org";

export const DISTRIBUTION_FIXTURE = {
  /**
   * A fixture Super Admin with this script's own password.
   *
   * Deliberately NOT the bootstrap Super Admin: that account's password is a
   * real secret in .env, and a fixture should never need one. Delete this row
   * when you are done demoing —
   *   DELETE FROM user_roles WHERE user_id = (SELECT id FROM profiles WHERE email = 'dev.stockadmin@livey.tech');
   */
  admin: {
    email: "dev.stockadmin@livey.tech",
    fullName: "Dev Stock Admin",
    assignmentId: "assignment-e2e-stock-admin",
  },
  distributor: {
    email: "dev.distributor@livey.tech",
    fullName: "Dev Distributor",
    assignmentId: "assignment-e2e-distributor",
  },
  otherDistributor: {
    email: "other.distributor@livey.tech",
    fullName: "Other Distributor",
    assignmentId: "assignment-e2e-distributor-2",
  },
  manager: {
    email: "dev.stockmanager@livey.tech",
    fullName: "Dev Stock Manager",
    assignmentId: "assignment-e2e-stock-manager",
  },
  custodian: {
    email: "dev.custodian@livey.tech",
    fullName: "Dev Warehouse Custodian",
    assignmentId: "assignment-e2e-custodian",
  },
  warehouse: { code: "E2E-WH-MUM", name: "E2E Mumbai Warehouse" },
  distributorStore: { code: "E2E-DS-PUN", name: "E2E Pune Distributor Store" },
  otherStore: { code: "E2E-DS-NAG", name: "E2E Nagpur Distributor Store" },
  openingQuantity: 40,
  password: PASSWORD,
} as const;

type Client = Awaited<ReturnType<ReturnType<typeof createPool>["connect"]>>;

async function ensureProfile(
  client: Client,
  input: { email: string; fullName: string },
): Promise<string> {
  const existing = await client.query(`SELECT id FROM profiles WHERE lower(email) = lower($1)`, [
    input.email,
  ]);
  if (existing.rows[0]) return String((existing.rows[0] as { id: string }).id);

  const id = randomUUID();
  await client.query(
    `INSERT INTO profiles (id, email, password_hash, full_name, phone, company_name, partner_status, must_reset_password, is_seed)
     VALUES ($1,$2,$3,$4,'','LIVEY','approved',FALSE,TRUE)`,
    [id, input.email, await bcrypt.hash(PASSWORD, 10), input.fullName],
  );
  return id;
}

async function ensureAssignment(
  client: Client,
  input: {
    assignmentId: string;
    userId: string;
    roleKey: string;
    teamDomain: string;
    managerAssignmentId: string | null;
    partnerId: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO assignments (
       assignment_id, user_id, tenant_id, organization_tenant_id, role_key, team_domain,
       geography_ceiling_node_id, partner_id, manager_assignment_id, source, status,
       valid_from, version, is_seed
     ) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,'e2e-fixture','active',now(),1,TRUE)
     ON CONFLICT (assignment_id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       role_key = EXCLUDED.role_key,
       team_domain = EXCLUDED.team_domain,
       partner_id = EXCLUDED.partner_id,
       manager_assignment_id = EXCLUDED.manager_assignment_id,
       status = 'active',
       updated_at = now()`,
    [
      input.assignmentId,
      input.userId,
      TENANT_ID,
      input.roleKey,
      input.teamDomain,
      GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
      input.partnerId,
      input.managerAssignmentId,
    ],
  );

  // The shell resolves its governing role from user_roles, not from the
  // Assignment (see resolveAuthContextForProfile). Without a row here the
  // fixture logs in with no governing role at all and falls through to the
  // Partner-external journey, which is not what any of these people are.
  await client.query(
    `INSERT INTO user_roles (user_id, role, is_seed)
     VALUES ($1, $2::app_role, TRUE)
     ON CONFLICT DO NOTHING`,
    [input.userId, input.roleKey],
  );

  // A governed actor needs a live Active Context as well as an Assignment;
  // without one every policy check fails closed and the fixture logs in to a
  // workspace that denies everything.
  await client.query(
    `INSERT INTO active_contexts (
       context_id, user_id, assignment_id, tenant_id, organization_tenant_id,
       issued_at, expires_at, version, correlation_id, is_seed
     ) VALUES ($1,$2,$3,$4,$4,now(),now() + INTERVAL '30 days',1,$5,TRUE)
     ON CONFLICT (context_id) DO UPDATE SET
       expires_at = now() + INTERVAL '30 days',
       revoked_at = NULL,
       updated_at = now()`,
    [`context-${input.assignmentId}`, input.userId, input.assignmentId, TENANT_ID, randomUUID()],
  );
}

async function ensureTwoActiveSkus(client: Client): Promise<string[]> {
  const existing = await client.query(
    `SELECT sku.id
     FROM product_skus sku
     JOIN product_variants variant ON variant.id = sku.product_variant_id
     JOIN products product ON product.id = variant.product_id
     WHERE sku.status = 'active' AND sku.archived_at IS NULL
       AND variant.status = 'active' AND variant.archived_at IS NULL
       AND product.status = 'active' AND product.archived_at IS NULL
     ORDER BY sku.sku_code ASC
     LIMIT 2`,
  );
  const found = (existing.rows as Array<{ id: string }>).map((row) => String(row.id));
  if (found.length === 2) return found;

  // A catalogue with fewer than two governed SKUs cannot exercise a
  // multi-line request, so the fixture supplies its own.
  const ids: string[] = [...found];
  for (const index of [1, 2]) {
    if (ids.length >= 2) break;
    const productId = randomUUID();
    const variantId = randomUUID();
    const skuId = randomUUID();
    await client.query(
      `INSERT INTO products (id, product_code, product_name, status, is_seed)
       VALUES ($1,$2,$3,'active',TRUE) ON CONFLICT (product_code) DO NOTHING`,
      [productId, `E2E-PROD-${index}`, `E2E Distribution Product ${index}`],
    );
    const product = await client.query(`SELECT id FROM products WHERE product_code = $1`, [
      `E2E-PROD-${index}`,
    ]);
    const resolvedProductId = String((product.rows[0] as { id: string }).id);
    await client.query(
      `INSERT INTO product_variants (id, product_id, variant_code, variant_name, status, is_seed)
       VALUES ($1,$2,$3,'Standard','active',TRUE) ON CONFLICT (variant_code) DO NOTHING`,
      [variantId, resolvedProductId, `E2E-VAR-${index}`],
    );
    const variant = await client.query(`SELECT id FROM product_variants WHERE variant_code = $1`, [
      `E2E-VAR-${index}`,
    ]);
    const resolvedVariantId = String((variant.rows[0] as { id: string }).id);
    await client.query(
      `INSERT INTO product_skus (id, product_variant_id, sku_code, currency_code, status, is_seed)
       VALUES ($1,$2,$3,'INR','active',TRUE) ON CONFLICT (sku_code) DO NOTHING`,
      [skuId, resolvedVariantId, `E2E-SKU-${index}`],
    );
    const sku = await client.query(`SELECT id FROM product_skus WHERE sku_code = $1`, [
      `E2E-SKU-${index}`,
    ]);
    ids.push(String((sku.rows[0] as { id: string }).id));
  }
  return ids.slice(0, 2);
}

async function findSuperAdmin(
  client: Client,
): Promise<{ userId: string; assignmentId: string } | null> {
  const { rows } = await client.query(
    `SELECT a.user_id, a.assignment_id
     FROM assignments a
     WHERE a.role_key = 'super_admin' AND a.status = 'active'
     ORDER BY a.valid_from ASC
     LIMIT 1`,
  );
  const row = rows[0] as { user_id: string; assignment_id: string } | undefined;
  return row ? { userId: String(row.user_id), assignmentId: String(row.assignment_id) } : null;
}

/**
 * `identitiesOnly` stops after the people and the feature flag, leaving the
 * locations and the opening stock to be created through the workspace UI.
 * That is the mode to use when the point is to verify the interface actually
 * works, rather than to hand a test a pre-built world.
 */
export async function seedDistributionE2E(
  options: { identitiesOnly?: boolean } = {},
): Promise<void> {
  const pool = createPool();
  const client = await pool.connect();

  try {
    const admin = await findSuperAdmin(client);
    if (!admin) {
      throw new Error(
        "No active super_admin assignment found. Run bun scripts/bootstrap-db.ts first.",
      );
    }

    // Distribution must be on for the fixture to be usable at all; the flag
    // ships disabled, and a fixture that cannot reach the surface is not a
    // fixture.
    await client.query(
      `UPDATE feature_flags SET enabled = TRUE, updated_at = now() WHERE flag_key = 'distribution-core'`,
    );

    const adminUserId = await ensureProfile(client, DISTRIBUTION_FIXTURE.admin);
    await ensureAssignment(client, {
      assignmentId: DISTRIBUTION_FIXTURE.admin.assignmentId,
      userId: adminUserId,
      roleKey: "super_admin",
      teamDomain: "identity",
      managerAssignmentId: null,
      partnerId: null,
    });

    const managerUserId = await ensureProfile(client, DISTRIBUTION_FIXTURE.manager);
    const custodianUserId = await ensureProfile(client, DISTRIBUTION_FIXTURE.custodian);
    const distributorUserId = await ensureProfile(client, DISTRIBUTION_FIXTURE.distributor);
    const otherDistributorUserId = await ensureProfile(
      client,
      DISTRIBUTION_FIXTURE.otherDistributor,
    );

    await ensureAssignment(client, {
      assignmentId: DISTRIBUTION_FIXTURE.manager.assignmentId,
      userId: managerUserId,
      roleKey: "rm",
      teamDomain: "sales",
      managerAssignmentId: null,
      partnerId: null,
    });
    await ensureAssignment(client, {
      assignmentId: DISTRIBUTION_FIXTURE.custodian.assignmentId,
      userId: custodianUserId,
      roleKey: "pam",
      teamDomain: "sales",
      managerAssignmentId: DISTRIBUTION_FIXTURE.manager.assignmentId,
      partnerId: null,
    });
    await ensureAssignment(client, {
      assignmentId: DISTRIBUTION_FIXTURE.distributor.assignmentId,
      userId: distributorUserId,
      roleKey: "restricted_distributor",
      teamDomain: "logistics",
      managerAssignmentId: DISTRIBUTION_FIXTURE.manager.assignmentId,
      partnerId: null,
    });
    await ensureAssignment(client, {
      assignmentId: DISTRIBUTION_FIXTURE.otherDistributor.assignmentId,
      userId: otherDistributorUserId,
      roleKey: "restricted_distributor",
      teamDomain: "logistics",
      managerAssignmentId: DISTRIBUTION_FIXTURE.manager.assignmentId,
      partnerId: null,
    });

    const skuIds = await ensureTwoActiveSkus(client);
    if (skuIds.length < 2) {
      throw new Error("Could not resolve two active product SKUs for the fixture");
    }

    client.release();

    if (options.identitiesOnly) {
      console.log(
        [
          "Distribution identities ready (no locations or stock — create those in the UI).",
          `  super admin       ${DISTRIBUTION_FIXTURE.admin.email}`,
          `  distributor       ${DISTRIBUTION_FIXTURE.distributor.email}`,
          `  other distributor ${DISTRIBUTION_FIXTURE.otherDistributor.email}`,
          `  manager           ${DISTRIBUTION_FIXTURE.manager.email}`,
          `  custodian         ${DISTRIBUTION_FIXTURE.custodian.email}`,
          "  password          set via E2E_DISTRIBUTION_PASSWORD",
          "  distribution-core enabled",
        ].join("\n"),
      );
      return;
    }

    // Everything below goes through the named commands, so the fixture
    // exercises the same code path a real operator would.
    const { createStockLocation, postManualStockMovement } =
      await import("../src/server/distribution-commands.server");
    const { pool: appPool } = await import("../src/server/postgres.server");

    const adminActor = await buildSuperAdminActor(admin);

    const locations: Record<string, string> = {};
    for (const [key, definition, distributorAssignmentId] of [
      ["warehouse", DISTRIBUTION_FIXTURE.warehouse, null],
      [
        "distributorStore",
        DISTRIBUTION_FIXTURE.distributorStore,
        DISTRIBUTION_FIXTURE.distributor.assignmentId,
      ],
      [
        "otherStore",
        DISTRIBUTION_FIXTURE.otherStore,
        DISTRIBUTION_FIXTURE.otherDistributor.assignmentId,
      ],
    ] as const) {
      const existing = await appPool.query(
        `SELECT id FROM stock_locations WHERE location_code = $1`,
        [definition.code],
      );
      if (existing.rows[0]) {
        locations[key] = String((existing.rows[0] as { id: string }).id);
        continue;
      }
      const result = await createStockLocation({
        actor: adminActor,
        data: {
          locationCode: definition.code,
          locationName: definition.name,
          locationType: distributorAssignmentId ? "distributor" : "livey_warehouse",
          geographyNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
          distributorAssignmentId,
          custodianAssignmentId: distributorAssignmentId
            ? null
            : DISTRIBUTION_FIXTURE.custodian.assignmentId,
        },
      });
      if (!result.ok) {
        throw new Error(`Could not create ${definition.code}: ${JSON.stringify(result.failure)}`);
      }
      locations[key] = result.subjectId;
    }

    for (const skuId of skuIds) {
      const result = await postManualStockMovement({
        actor: adminActor,
        data: {
          movementType: "opening_balance",
          productSkuId: skuId,
          destinationLocationId: locations.warehouse!,
          quantity: DISTRIBUTION_FIXTURE.openingQuantity,
          reason: "E2E fixture opening count",
          // Stable key, so re-running the fixture does not keep adding stock.
          idempotencyKey: `e2e-opening:${locations.warehouse}:${skuId}`,
        },
      });
      if (!result.ok) {
        throw new Error(`Could not post opening balance: ${JSON.stringify(result.failure)}`);
      }
    }

    console.log(
      [
        "Distribution E2E fixtures ready.",
        `  distributor      ${DISTRIBUTION_FIXTURE.distributor.email}`,
        `  other distributor ${DISTRIBUTION_FIXTURE.otherDistributor.email}`,
        `  manager          ${DISTRIBUTION_FIXTURE.manager.email}`,
        `  custodian        ${DISTRIBUTION_FIXTURE.custodian.email}`,
        `  warehouse        ${DISTRIBUTION_FIXTURE.warehouse.code} (${DISTRIBUTION_FIXTURE.openingQuantity} units of 2 SKUs)`,
        `  destination      ${DISTRIBUTION_FIXTURE.distributorStore.code}`,
        "  password         set via E2E_DISTRIBUTION_PASSWORD (default in this script)",
      ].join("\n"),
    );
  } finally {
    await pool.end();
  }
}

async function buildSuperAdminActor(admin: { userId: string; assignmentId: string }) {
  const { pool } = await import("../src/server/postgres.server");
  const { rows } = await pool.query(
    `SELECT assignment_id, user_id, tenant_id, organization_tenant_id, role_key, team_domain,
            geography_ceiling_node_id, partner_id, status::text AS status, valid_from, version
     FROM assignments WHERE assignment_id = $1`,
    [admin.assignmentId],
  );
  const row = rows[0] as Record<string, unknown>;
  const assignment = {
    assignmentId: String(row.assignment_id),
    userId: String(row.user_id),
    tenantId: String(row.tenant_id),
    organizationTenantId: String(row.organization_tenant_id),
    roleKey: String(row.role_key),
    teamDomain: String(row.team_domain),
    geographyCeilingNodeId: String(row.geography_ceiling_node_id),
    partnerId: row.partner_id == null ? null : String(row.partner_id),
    accountId: null,
    portfolioId: null,
    queueId: null,
    status: "active",
    validFrom: new Date(String(row.valid_from)).toISOString(),
    validTo: null,
    managerAssignmentId: null,
    source: "e2e-fixture",
    approverUserId: null,
    predecessorAssignmentId: null,
    successorAssignmentId: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: Number(row.version ?? 1),
    isSeed: true,
  } as never;

  return {
    userId: admin.userId,
    assignment,
    activeContext: {
      contextId: `context-${admin.assignmentId}`,
      userId: admin.userId,
      assignmentId: admin.assignmentId,
      assignmentStatus: "active",
      tenantId: String(row.tenant_id),
      organizationTenantId: String(row.organization_tenant_id),
      workingScope: null,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      version: 1,
      revocationLink: null,
      correlationId: randomUUID(),
      assignmentVersion: Number(row.version ?? 1),
      workingScopeNodeId: null,
      revokedAt: null,
      revocationReason: null,
      isSeed: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never,
  };
}

if (import.meta.main) {
  seedDistributionE2E({ identitiesOnly: process.argv.includes("--identities-only") })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
