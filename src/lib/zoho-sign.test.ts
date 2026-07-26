import { expect, test } from "bun:test";

test("zoho agreement naming helpers are deterministic and partner-specific", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";

  const {
    buildPartnerAgreementSourceFilePath,
    buildZohoAgreementRequestName,
  } = await import("@/lib/zoho-sign");

  expect(
    buildZohoAgreementRequestName({
      partnerId: "partner-123",
      partnerCompany: "Acme & Co",
    }),
  ).toBe("LIVEY Partner Agreement — Acme & Co (partner-123)");

  expect(buildPartnerAgreementSourceFilePath("partner-123")).toBe(
    "partners/partner-123/agreement-source.pdf",
  );
});

test("zoho sign request payload uses image_fields for the signature field", async () => {
  process.env.DATABASE_URL ??= "postgres://localhost/test";
  process.env.ZOHO_SIGN_CLIENT_ID ??= "client-id";
  process.env.ZOHO_SIGN_CLIENT_SECRET ??= "client-secret";

  const { sendAgreement } = await import("@/lib/zoho-sign");
  const { pool } = await import("@/server/postgres.server");

  const originalQuery = pool.query.bind(pool);
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

  pool.query = (async (sql: string) => {
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
    fetchCalls.push({ url: String(input), init });

    if (String(input).includes("/api/v1/documents")) {
      return new Response(
        JSON.stringify({
          documents: {
            document_ids: [{ document_id: "doc-123" }],
          },
        }),
        { status: 200 },
      );
    }

    if (String(input).includes("/api/v1/requests/req-123") && !String(input).includes("/embedtoken")) {
      return new Response(
        JSON.stringify({
          requests: {
            request_id: "req-123",
            actions: [{ action_id: "action-123", action_type: "SIGN" }],
          },
        }),
        { status: 200 },
      );
    }

    if (String(input).includes("/api/v1/requests")) {
      return new Response(
        JSON.stringify({
          code: 0,
          requests: {
            request_id: "req-123",
            actions: [{ action_id: "action-123", action_type: "SIGN" }],
          },
        }),
        { status: 200 },
      );
    }

    if (String(input).includes("/api/v1/requests/req-123/submit")) {
      return new Response(
        JSON.stringify({
          status: "success",
          requests: { request_status: "pending" },
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected fetch call: ${String(input)}`);
  }) as typeof fetch;

  try {
    const result = await sendAgreement({
      partnerId: "partner-123",
      partnerEmail: "partner@example.com",
      partnerName: "Partner Name",
      partnerCompany: "Acme & Co",
      sourceFile: new File([new Uint8Array([37, 80, 68, 70])], "agreement.pdf", {
        type: "application/pdf",
      }),
    });

    expect(result.requestId).toBe("req-123");

    const submitCall = fetchCalls.find((entry) => entry.url.endsWith("/api/v1/requests/req-123/submit"));
    expect(submitCall).toBeDefined();

    const requestCall = fetchCalls.find(
      (entry) => entry.url.endsWith("/api/v1/requests") && !!entry.init?.body,
    );
    expect(requestCall).toBeDefined();

    const requestBody = JSON.parse(String(requestCall?.init?.body)) as {
      requests?: {
        document_ids?: Array<{ document_id?: string; document_order?: number }>;
        actions?: Array<{ fields?: { image_fields?: Array<{ field_type_name?: string }> } }>;
      };
    };
    expect(requestBody.requests?.document_ids?.[0]).toMatchObject({
      document_id: "doc-123",
      document_order: 0,
    });
    expect(requestBody.requests?.actions?.[0]?.fields?.image_fields?.[0]).toMatchObject({
      field_type_name: "Signature",
    });
    expect(requestBody.requests?.actions?.[0]).toMatchObject({
      action_type: "SIGN",
      is_embedded: true,
      signing_order: 0,
      verify_recipient: true,
      verification_type: "EMAIL",
    });
  } finally {
    pool.query = originalQuery as typeof pool.query;
    globalThis.fetch = originalFetch;
  }
});
