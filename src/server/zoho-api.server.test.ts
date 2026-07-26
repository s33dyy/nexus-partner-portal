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

