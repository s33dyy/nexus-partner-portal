import { expect, test } from "bun:test";

test("Zoho send-agreement form parsing requires a PDF upload", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";

  const { parseZohoSendAgreementFormData } = await import("@/server/zoho-api.server");

  const form = new FormData();
  form.append("partnerId", "partner-123");
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
    partnerName: "Partner Name",
    partnerCompany: "Acme & Co",
  });

  const missingFile = new FormData();
  missingFile.append("partnerId", "partner-123");
  missingFile.append("partnerName", "Partner Name");
  missingFile.append("partnerCompany", "Acme & Co");

  expect(() => parseZohoSendAgreementFormData(missingFile)).toThrow(
    "A PDF file upload is required",
  );
});

test("Zoho send-agreement resolves the recipient email from the partner owner profile", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  process.env.ZOHO_SIGN_CLIENT_ID ??= "client-id";
  process.env.ZOHO_SIGN_CLIENT_SECRET ??= "client-secret";

  const { handleZohoSendAgreement } = await import("@/server/zoho-api.server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  const originalFetch = globalThis.fetch;
  let requestBody: unknown = null;

  pool.query = (async (sql: string, params?: unknown[]) => {
    if (String(sql).includes("FROM public.partners p") && String(sql).includes("owner_email")) {
      return {
        rows: [
          {
            id: "partner-123",
            owner_user_id: "user-123",
            owner_email: "owner@example.com",
          },
        ],
        rowCount: 1,
      } as never;
    }

    if (String(sql).includes("DELETE FROM public.partner_documents")) {
      return { rows: [], rowCount: 1 } as never;
    }

    if (String(sql).includes("INSERT INTO public.partner_documents")) {
      return { rows: [], rowCount: 1 } as never;
    }

    if (String(sql).includes("UPDATE public.partners") && String(sql).includes("agreement_envelope_id")) {
      return { rows: [], rowCount: 1 } as never;
    }

    if (String(sql).includes("UPDATE public.profiles") && String(sql).includes("partner_status")) {
      return { rows: [], rowCount: 1 } as never;
    }

    if (String(sql).includes("UPDATE public.partners") && String(sql).includes("agreement_source_doc_path")) {
      return { rows: [], rowCount: 1 } as never;
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
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = request.url;

    if (url.includes("api.cloudinary.com/v1_1/")) {
      return new Response(
        JSON.stringify({
          public_id: "partners/partner-123/agreement-source",
          secure_url: "https://res.cloudinary.com/example/raw/upload/partners/partner-123/agreement-source",
          resource_type: "raw",
          bytes: 4,
        }),
        { status: 200 },
      );
    }

    if (url.includes("/api/v1/documents")) {
      return new Response(
        JSON.stringify({
          documents: {
            document_ids: [{ document_id: "doc-123" }],
          },
        }),
        { status: 200 },
      );
    }

    if (url.endsWith("/api/v1/requests") && request.method === "POST") {
      requestBody = JSON.parse((await request.clone().text()) || "{}");
      return new Response(JSON.stringify({ requests: { request_id: "req-123" } }), {
        status: 200,
      });
    }

    if (url.includes("/api/v1/requests/req-123") && !url.includes("/embedtoken")) {
      return new Response(
        JSON.stringify({
          requests: {
            actions: [{ action_id: "action-456", action_type: "SIGN" }],
          },
        }),
        { status: 200 },
      );
    }

    if (url.includes("/embedtoken")) {
      return new Response(JSON.stringify({ sign_url: "https://sign.zoho.in/sign/req-123/fresh" }), {
        status: 200,
      });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  }) as typeof fetch;

  try {
    const form = new FormData();
    form.append("partnerId", "partner-123");
    form.append("partnerName", "Partner Name");
    form.append("partnerCompany", "Acme & Co");
    form.append("agreementFile", new File([new Uint8Array([37, 80, 68, 70])], "agreement.pdf", {
      type: "application/pdf",
    }));

    const request = new Request("http://localhost/api/integrations/zoho-sign/send-agreement", {
      method: "POST",
      body: form,
    });

    const response = await handleZohoSendAgreement(request);

    expect(response.status).toBe(200);
    expect((requestBody as { requests?: { actions?: Array<{ recipient_email?: string }> } })?.requests?.actions?.[0]?.recipient_email).toBe(
      "owner@example.com",
    );
  } finally {
    pool.query = originalQuery as typeof pool.query;
    globalThis.fetch = originalFetch;
  }
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
    if (
      String(input).includes("/api/v1/requests/req-123/actions/action-456/embedtoken") &&
      String(input).includes("host=http%3A%2F%2Flocalhost")
    ) {
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

test("Zoho sign-url endpoint falls back to the authenticated user as partner owner", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  process.env.ZOHO_SIGN_CLIENT_ID ??= "client-id";
  process.env.ZOHO_SIGN_CLIENT_SECRET ??= "client-secret";

  const { default: server } = await import("@/server");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  const originalFetch = globalThis.fetch;

  pool.query = (async (sql: string, params?: unknown[]) => {
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
            partner_id: null,
            partner_status: "pending_agreement",
          },
        ],
        rowCount: 1,
      } as never;
    }

    if (
      String(sql).includes("FROM public.partners") &&
      String(sql).includes("WHERE id = $1 OR owner_user_id = $2")
    ) {
      expect(params).toEqual([null, "user-123"]);
      return {
        rows: [
          {
            id: "partner-123",
            agreement_envelope_id: "req-123",
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

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (
      String(input).includes("/api/v1/requests/req-123/actions/action-456/embedtoken") &&
      String(input).includes("host=http%3A%2F%2Flocalhost")
    ) {
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
    const data = (await response.json()) as { signUrl?: string };
    expect(data.signUrl).toBe("https://sign.zoho.in/sign/req-123/fresh");
  } finally {
    pool.query = originalQuery as typeof pool.query;
    globalThis.fetch = originalFetch;
  }
});
