import { expect, test } from "bun:test";

test("createDocumentDataUrl fetches raw Cloudinary PDFs from their stored secure URL", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";

  const { createDocumentDataUrl } = await import("@/server/livey-service.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  const originalFetch = globalThis.fetch;
  const secureUrl = "https://res.cloudinary.com/example/raw/upload/docs/partner-123/agreement.pdf";
  const pdfBytes = Buffer.from("%PDF-1.4\nfake pdf bytes", "utf8");
  const observedUrls: string[] = [];

  pool.query = (async (sql: string) => {
    if (String(sql).includes("FROM document_blobs WHERE file_path = $1 LIMIT 1")) {
      return {
        rows: [
          {
            file_name: "agreement.pdf",
            mime_type: "application/pdf",
            file_data: Buffer.from(
              JSON.stringify({
                publicId: "docs/partner-123/agreement.pdf",
                secureUrl,
                resourceType: "raw",
              }),
              "utf8",
            ),
          },
        ],
        rowCount: 1,
      } as never;
    }

    return { rows: [], rowCount: 1 } as never;
  }) as typeof pool.query;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(String(input));
    observedUrls.push(request.url);
    if (request.url === secureUrl) {
      return new Response(pdfBytes, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    }
    throw new Error(`Unexpected fetch call: ${request.url}`);
  }) as typeof fetch;

  try {
    const result = await createDocumentDataUrl("partner-documents/docs/partner-123/agreement.pdf");
    expect(result.fileName).toBe("agreement.pdf");
    expect(result.signedUrl.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(observedUrls).toEqual([secureUrl]);
  } finally {
    pool.query = originalQuery as typeof pool.query;
    globalThis.fetch = originalFetch;
  }
});

test("createDocumentDataUrl wraps legacy text blobs in a valid PDF", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";

  const { createDocumentDataUrl } = await import("@/server/livey-service.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);

  pool.query = (async (sql: string) => {
    if (String(sql).includes("FROM document_blobs WHERE file_path = $1 LIMIT 1")) {
      return {
        rows: [
          {
            file_name: "GST Certificate.pdf",
            mime_type: "application/pdf",
            file_data: Buffer.from("LIVEY training fixture for partner review", "utf8"),
          },
        ],
        rowCount: 1,
      } as never;
    }

    return { rows: [], rowCount: 1 } as never;
  }) as typeof pool.query;

  try {
    const result = await createDocumentDataUrl("partner-documents/legacy/gst-certificate.pdf");
    const encoded = result.signedUrl.split(",")[1] ?? "";
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    expect(result.fileName).toBe("GST Certificate.pdf");
    expect(decoded.startsWith("%PDF-1.4")).toBe(true);
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("getAuthContext resolves an active governed assignment's status correctly", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";

  const { getAuthContext } = await import("@/server/livey-service.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);

  pool.query = (async (sql: string) => {
    const text = String(sql);
    if (text.includes("FROM sessions s")) {
      return {
        rows: [
          {
            token_hash: "hash",
            expires_at: futureExpiry,
            revoked_at: null,
            id: "user-1",
            email: "user@example.com",
            full_name: "Test User",
            phone: null,
            company_name: null,
          },
        ],
        rowCount: 1,
      } as never;
    }
    if (text.includes("FROM profiles WHERE id = $1")) {
      return {
        rows: [
          {
            id: "user-1",
            email: "user@example.com",
            password_hash: "x",
            full_name: "Test User",
            phone: null,
            company_name: null,
            avatar_url: null,
            partner_id: null,
            partner_status: "approved",
            must_reset_password: false,
          },
        ],
        rowCount: 1,
      } as never;
    }
    if (text.includes("FROM user_roles WHERE user_id = $1")) {
      return { rows: [{ role: "super_admin" }], rowCount: 1 } as never;
    }
    if (text.includes("FROM active_contexts ac")) {
      return {
        rows: [
          {
            context_id: "context-1",
            user_id: "user-1",
            assignment_id: "assignment-1",
            tenant_id: "tenant-livey-org",
            organization_tenant_id: "tenant-livey-org",
            working_scope: null,
            issued_at: "2026-07-30T00:00:00.000Z",
            expires_at: "2026-07-30T08:00:00.000Z",
            version: 1,
            revocation_link: null,
            context_revoked_at: null,
            context_revocation_reason: null,
            correlation_id: "corr-1",
            context_is_seed: true,
            context_created_at: "2026-07-30T00:00:00.000Z",
            context_updated_at: "2026-07-30T00:00:00.000Z",
            assignment_version: 1,
            assignment_status: "active",
            role_key: "super_admin",
            team_domain: "identity",
            geography_ceiling_node_id: "geo-global",
            partner_id: null,
            account_id: null,
            portfolio_id: null,
            queue_id: null,
            manager_assignment_id: null,
            source: "test",
            approver_user_id: null,
            predecessor_assignment_id: null,
            successor_assignment_id: null,
            valid_from: "2026-07-30T00:00:00.000Z",
            valid_to: null,
            revoked_at: null,
            revocation_reason: null,
            assignment_created_at: "2026-07-30T00:00:00.000Z",
            assignment_updated_at: "2026-07-30T00:00:00.000Z",
            assignment_is_seed: true,
          },
        ],
        rowCount: 1,
      } as never;
    }
    return { rows: [], rowCount: 0 } as never;
  }) as typeof pool.query;

  try {
    const authContext = await getAuthContext("any-token");
    expect(authContext.assignment?.status).toBe("active");
    expect(authContext.assignment?.assignmentId).toBe("assignment-1");
    expect(authContext.activeContext?.revokedAt).toBeNull();
    expect(authContext.activeContext?.assignmentId).toBe("assignment-1");
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("every table queried by the client UI is registered in the generic query path", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";

  const { queryTableWithAuthContext } = await import("@/server/livey-service.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  pool.query = (async () => ({ rows: [], rowCount: 0 })) as typeof pool.query;

  // Every table name that appears in a client `.from("...")` call across
  // src/routes, src/lib, src/hooks, and src/components as of the customer
  // governance and deal-participant work. customer_participants and
  // customer_merge_events were previously missing here, which crashed the
  // Customers page (assertTable throws "Unsupported table", the Promise.all
  // in customers.tsx's load() rejects, and the page silently falls back to
  // an empty state for every user).
  const tablesUsedByClientRoutes = [
    "active_contexts",
    "assignments",
    "customer_merge_events",
    "customer_participants",
    "deal_documents",
    "notifications",
    "partner_documents",
    "partner_review_notes",
    "partners",
    "portal_audit_events",
    "portal_catalog_items",
    "portal_customer_activities",
    "portal_customers",
    "portal_deal_collaborators",
    "portal_deals",
    "portal_news_posts",
    "portal_team_members",
    "profiles",
    "reward_catalog_items",
    "reward_point_events",
    "reward_redemptions",
    "support_ticket_comments",
    "support_tickets",
    "user_roles",
  ];

  const superAdmin = {
    userId: "user-a",
    roles: ["super_admin"] as ("super_admin" | "partner_admin" | "partner_user")[],
    partnerId: null,
    companyName: null,
    hasGovernedContext: true,
  };

  try {
    for (const table of tablesUsedByClientRoutes) {
      const result = await queryTableWithAuthContext(
        { table, operation: "select", filters: [] },
        superAdmin,
      );
      expect(result.error).toBeNull();
    }
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("assertDocumentAccessWithAuthContext denies an anonymous caller", async () => {
  const { assertDocumentAccessWithAuthContext } = await import("@/server/livey-service.server");

  await expect(
    assertDocumentAccessWithAuthContext(
      { bucket: "deal-documents", filePath: "partner-1/deal-1/file.pdf", operation: "read" },
      { userId: null, partnerId: null, isSuperAdmin: false },
    ),
  ).rejects.toThrow("Access denied");
});

test("assertDocumentAccessWithAuthContext lets super_admin read/write/delete anything without a DB lookup", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  const { assertDocumentAccessWithAuthContext } = await import("@/server/livey-service.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  let queried = false;
  pool.query = (async () => {
    queried = true;
    return { rows: [], rowCount: 0 };
  }) as never;

  try {
    for (const operation of ["read", "write", "delete"] as const) {
      await assertDocumentAccessWithAuthContext(
        { bucket: "partner-documents", filePath: "someone-elses-partner/file.pdf", operation },
        { userId: "super-admin-user", partnerId: null, isSuperAdmin: true },
      );
    }
    expect(queried).toBe(false);
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("assertDocumentAccessWithAuthContext allows the owning partner and denies a different partner", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  const { assertDocumentAccessWithAuthContext } = await import("@/server/livey-service.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  pool.query = (async () => ({
    rows: [{ partner_id: "partner-1", uploaded_by: "user-owner" }],
    rowCount: 1,
  })) as never;

  try {
    await assertDocumentAccessWithAuthContext(
      { bucket: "deal-documents", filePath: "partner-1/deal-1/file.pdf", operation: "read" },
      { userId: "user-other", partnerId: "partner-1", isSuperAdmin: false },
    );

    await expect(
      assertDocumentAccessWithAuthContext(
        { bucket: "deal-documents", filePath: "partner-1/deal-1/file.pdf", operation: "read" },
        { userId: "user-other", partnerId: "partner-2", isSuperAdmin: false },
      ),
    ).rejects.toThrow("Access denied");
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("assertDocumentAccessWithAuthContext allows the uploader even without a matching partner_id", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  const { assertDocumentAccessWithAuthContext } = await import("@/server/livey-service.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  pool.query = (async () => ({
    rows: [{ partner_id: null, uploaded_by: "user-owner" }],
    rowCount: 1,
  })) as never;

  try {
    await assertDocumentAccessWithAuthContext(
      { bucket: "partner-documents", filePath: "some/path.pdf", operation: "delete" },
      { userId: "user-owner", partnerId: null, isSuperAdmin: false },
    );
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("assertDocumentAccessWithAuthContext denies reading/deleting a path with no matching document row", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  const { assertDocumentAccessWithAuthContext } = await import("@/server/livey-service.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  pool.query = (async () => ({ rows: [], rowCount: 0 })) as never;

  try {
    await expect(
      assertDocumentAccessWithAuthContext(
        { bucket: "deal-documents", filePath: "partner-1/ghost.pdf", operation: "read" },
        { userId: "user-a", partnerId: "partner-1", isSuperAdmin: false },
      ),
    ).rejects.toThrow("Access denied");

    await expect(
      assertDocumentAccessWithAuthContext(
        { bucket: "deal-documents", filePath: "partner-1/ghost.pdf", operation: "delete" },
        { userId: "user-a", partnerId: "partner-1", isSuperAdmin: false },
      ),
    ).rejects.toThrow("Access denied");
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("assertDocumentAccessWithAuthContext allows a fresh upload only under the caller's own partner_id prefix", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  const { assertDocumentAccessWithAuthContext } = await import("@/server/livey-service.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  pool.query = (async () => ({ rows: [], rowCount: 0 })) as never;

  try {
    await assertDocumentAccessWithAuthContext(
      { bucket: "partner-documents", filePath: "partner-1/agreement_123.pdf", operation: "write" },
      { userId: "user-a", partnerId: "partner-1", isSuperAdmin: false },
    );

    await expect(
      assertDocumentAccessWithAuthContext(
        {
          bucket: "partner-documents",
          filePath: "partner-2/agreement_123.pdf",
          operation: "write",
        },
        { userId: "user-a", partnerId: "partner-1", isSuperAdmin: false },
      ),
    ).rejects.toThrow("Access denied");
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("assertDocumentAccessWithAuthContext denies an unknown bucket", async () => {
  const { assertDocumentAccessWithAuthContext } = await import("@/server/livey-service.server");

  await expect(
    assertDocumentAccessWithAuthContext(
      { bucket: "rewards", filePath: "anything.png", operation: "read" },
      { userId: "user-a", partnerId: "partner-1", isSuperAdmin: false },
    ),
  ).rejects.toThrow("Access denied");
});

function partnerAdminCtx(partnerId: string | null) {
  return { roles: ["partner_admin"] as const, profile: { partner_id: partnerId } };
}

function superAdminCtx() {
  return { roles: ["super_admin"] as const, profile: { partner_id: null } };
}

test("assertCanGrantWorkspaceUser blocks a partner_admin from granting super_admin (privilege escalation)", async () => {
  const { assertCanGrantWorkspaceUser } = await import("@/server/livey-service.server");

  expect(() =>
    assertCanGrantWorkspaceUser(partnerAdminCtx("partner-1"), {
      role: "super_admin",
      partner_id: undefined,
    }),
  ).toThrow();
});

test("assertCanGrantWorkspaceUser blocks a partner_admin from granting any internal LIVEY role", async () => {
  const { assertCanGrantWorkspaceUser } = await import("@/server/livey-service.server");

  for (const role of [
    "rm",
    "pam",
    "kam",
    "isr",
    "livey_support",
    "restricted_distributor",
  ] as const) {
    expect(() =>
      assertCanGrantWorkspaceUser(partnerAdminCtx("partner-1"), { role, partner_id: undefined }),
    ).toThrow();
  }
});

test("assertCanGrantWorkspaceUser blocks a partner_admin from creating a user under a different partner", async () => {
  const { assertCanGrantWorkspaceUser } = await import("@/server/livey-service.server");

  expect(() =>
    assertCanGrantWorkspaceUser(partnerAdminCtx("partner-1"), {
      role: "partner_user",
      partner_id: "partner-2",
    }),
  ).toThrow();
});

test("assertCanGrantWorkspaceUser allows a partner_admin to create a partner_user in their own partner", async () => {
  const { assertCanGrantWorkspaceUser } = await import("@/server/livey-service.server");

  const result = assertCanGrantWorkspaceUser(partnerAdminCtx("partner-1"), {
    role: "partner_user",
    partner_id: "partner-1",
  });
  expect(result).toEqual({ callerIsSuperAdmin: false, ownPartnerId: "partner-1" });

  // Omitting partner_id entirely (the normal case) must also succeed.
  expect(() =>
    assertCanGrantWorkspaceUser(partnerAdminCtx("partner-1"), {
      role: "partner_user",
      partner_id: undefined,
    }),
  ).not.toThrow();
});

test("assertCanGrantWorkspaceUser lets a partner_admin grant a lateral partner_admin co-admin (product.md §6.9)", async () => {
  const { assertCanGrantWorkspaceUser } = await import("@/server/livey-service.server");

  expect(() =>
    assertCanGrantWorkspaceUser(
      partnerAdminCtx("partner-1"),
      { role: "partner_admin", partner_id: undefined },
      { allowedRoles: ["partner_admin", "partner_user"] },
    ),
  ).not.toThrow();
});

test("assertCanGrantWorkspaceUser's allowedRoles option still blocks super_admin from the team-invite path", async () => {
  const { assertCanGrantWorkspaceUser } = await import("@/server/livey-service.server");

  expect(() =>
    assertCanGrantWorkspaceUser(
      superAdminCtx(),
      { role: "super_admin", partner_id: undefined },
      { allowedRoles: ["partner_admin", "partner_user"] },
    ),
  ).toThrow();
});

test("assertCanGrantWorkspaceUser lets super_admin grant any role to any partner", async () => {
  const { assertCanGrantWorkspaceUser } = await import("@/server/livey-service.server");

  for (const role of ["super_admin", "rm", "pam", "partner_admin", "partner_user"] as const) {
    expect(() =>
      assertCanGrantWorkspaceUser(superAdminCtx(), { role, partner_id: "any-partner" }),
    ).not.toThrow();
  }
});

test("assertCanGrantWorkspaceUser rejects an unknown role string (a raw request bypassing the TS type)", async () => {
  const { assertCanGrantWorkspaceUser } = await import("@/server/livey-service.server");

  expect(() =>
    assertCanGrantWorkspaceUser(partnerAdminCtx("partner-1"), {
      role: "not_a_real_role" as never,
      partner_id: undefined,
    }),
  ).toThrow("Unknown role");
});
