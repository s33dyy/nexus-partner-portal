import { expect, test } from "bun:test";

test("Zoho send-agreement form parsing requires a PDF upload", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";

  const { parseZohoSendAgreementFormData } = await import("@/server/zoho-api.server");

  const form = new FormData();
  form.append("partnerId", "partner-123");
  form.append("partnerEmail", "partner@example.com");
  form.append("partnerName", "Partner Name");
  form.append("partnerCompany", "Acme & Co");
  form.append(
    "agreementFile",
    new File([new Uint8Array([37, 80, 68, 70])], "agreement.pdf", {
      type: "application/pdf",
    }),
  );

  expect(parseZohoSendAgreementFormData(form)).toMatchObject({
    partnerId: "partner-123",
    partnerEmail: "partner@example.com",
    partnerName: "Partner Name",
    partnerCompany: "Acme & Co",
  });

  const missingFile = new FormData();
  missingFile.append("partnerId", "partner-123");
  missingFile.append("partnerEmail", "partner@example.com");
  missingFile.append("partnerName", "Partner Name");
  missingFile.append("partnerCompany", "Acme & Co");

  expect(() => parseZohoSendAgreementFormData(missingFile)).toThrow(
    "A PDF file upload is required",
  );
});

test("Zoho webhook completion moves the partner into signed_pending_review", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";

  const { handleZohoWebhook } = await import("@/server/zoho-api.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  pool.query = (async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });

    if (String(sql).includes("FROM public.partners WHERE agreement_envelope_id = $1")) {
      return {
        rows: [{ id: "partner-123", owner_user_id: "owner-456" }],
        rowCount: 1,
      } as never;
    }

    return { rows: [], rowCount: 1 } as never;
  }) as typeof pool.query;

  try {
    const request = new Request("http://localhost/api/integrations/zoho-sign/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: {
          request_id: "req-123",
          request_status: "completed",
        },
      }),
    });

    const response = await handleZohoWebhook(request);

    expect(response.status).toBe(200);
    expect(
      queries.some((entry) => String(entry.sql).includes("SET status = 'signed_pending_review'")),
    ).toBe(true);
    expect(
      queries.some((entry) =>
        String(entry.sql).includes("SET partner_status = 'signed_pending_review'"),
      ),
    ).toBe(true);
    expect(
      queries.some((entry) => String(entry.sql).includes("SET status = 'approved'")),
    ).toBe(false);
  } finally {
    pool.query = originalQuery as typeof pool.query;
  }
});

test("Zoho sign-url endpoint returns a fresh embedded signing URL for the current partner", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  process.env.ZOHO_SIGN_CLIENT_ID ??= "client-id";
  process.env.ZOHO_SIGN_CLIENT_SECRET ??= "client-secret";

  const { default: server } = await import("@/server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  const originalFetch = globalThis.fetch;
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  pool.query = (async (sql: string, params?: unknown[]) => {
    queries.push({ sql, params });

    if (
      String(sql).includes("FROM sessions s") &&
      String(sql).includes("JOIN profiles p ON p.id = s.user_id")
    ) {
      return {
        rows: [
          {
            token_hash: "token-hash",
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            id: "user-123",
            email: "partner@example.com",
            full_name: "Partner Admin",
            phone: null,
            company_name: "Acme & Co",
          },
        ],
        rowCount: 1,
      } as never;
    }

    if (String(sql).includes("SELECT role FROM user_roles WHERE user_id = $1")) {
      return {
        rows: [{ role: "partner_admin" }],
        rowCount: 1,
      } as never;
    }

    if (String(sql).includes("FROM profiles WHERE id = $1 LIMIT 1")) {
      return {
        rows: [
          {
            id: "user-123",
            email: "partner@example.com",
            password_hash: "hash",
            full_name: "Partner Admin",
            phone: null,
            company_name: "Acme & Co",
            avatar_url: null,
            partner_id: "partner-123",
            partner_status: "pending_agreement",
          },
        ],
        rowCount: 1,
      } as never;
    }

    if (String(sql).includes("FROM public.partners") && String(sql).includes("WHERE id = $1")) {
      return {
        rows: [
          {
            id: "partner-123",
            owner_user_id: "user-123",
            agreement_envelope_id: "req-123",
            status: "pending_agreement",
          },
        ],
        rowCount: 1,
      } as never;
    }

    if (String(sql).includes("FROM public.zoho_sign_tokens")) {
      return {
        rows: [
          {
            id: "token-1",
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            api_domain: "https://sign.zoho.in",
          },
        ],
        rowCount: 1,
      } as never;
    }

    return { rows: [], rowCount: 1 } as never;
  }) as typeof pool.query;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("/api/v1/requests/req-123/actions/action-456/embedtoken")) {
      return new Response(JSON.stringify({ sign_url: "https://sign.zoho.in/sign/req-123/fresh" }), {
        status: 200,
      });
    }

    if (String(input).includes("/api/v1/requests/req-123")) {
      return new Response(
        JSON.stringify({
          requests: {
            request_id: "req-123",
            actions: [
              {
                action_id: "action-456",
                recipient_email: "partner@example.com",
              },
            ],
          },
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected fetch call: ${String(input)}`);
  }) as typeof fetch;

  try {
    const request = new Request("http://localhost/api/integrations/zoho-sign/sign-url", {
      method: "POST",
      headers: {
        cookie: "livey_session=session-token",
        "Content-Type": "application/json",
      },
    });

    const response = await server.fetch(request, {}, {});

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const data = (await response.json()) as { signUrl?: string };
    expect(data.signUrl).toBe("https://sign.zoho.in/sign/req-123/fresh");
    expect(
      queries.some(
        (entry) =>
          String(entry.sql).includes("FROM sessions s") &&
          String(entry.sql).includes("JOIN profiles p ON p.id = s.user_id"),
      ),
    ).toBe(true);
    expect(
      queries.some(
        (entry) =>
          String(entry.sql).includes("FROM public.partners") &&
          String(entry.sql).includes("WHERE id = $1"),
      ),
    ).toBe(true);
  } finally {
    pool.query = originalQuery as typeof pool.query;
    globalThis.fetch = originalFetch;
  }
});
