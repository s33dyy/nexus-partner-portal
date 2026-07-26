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

