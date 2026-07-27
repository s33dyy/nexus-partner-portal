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
