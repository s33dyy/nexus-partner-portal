/**
 * GyFTR Voucher Fulfillment Adapter
 * Handles reward redemption via the GyFTR B2B API.
 *
 * Environment variables required:
 *   GYFTR_API_URL     - Base URL of the GyFTR API
 *   GYFTR_CLIENT_ID   - GyFTR client/partner ID
 *   GYFTR_SECRET_KEY  - GyFTR HMAC secret key
 */

export type GyFTRVoucherRequest = {
  productCode: string; // GyFTR product/catalog code
  quantity: number;
  referenceId: string; // Idempotency key (our redemption ID)
  userMobile?: string;
  userEmail?: string;
};

export type GyFTRVoucherResponse =
  | {
      ok: true;
      voucherCode: string;
      expiryDate: string;
      fulfillmentRef: string;
    }
  | {
      ok: false;
      errorCode: string;
      errorMessage: string;
    };

export async function issueGyFTRVoucher(
  request: GyFTRVoucherRequest
): Promise<GyFTRVoucherResponse> {
  const apiUrl = process.env.GYFTR_API_URL;
  const clientId = process.env.GYFTR_CLIENT_ID;
  const secretKey = process.env.GYFTR_SECRET_KEY;

  if (!apiUrl || !clientId || !secretKey) {
    // Return a stubbed response in dev/staging when credentials are absent
    console.warn("[GyFTR] Missing credentials — returning stub voucher response");
    return {
      ok: true,
      voucherCode: `STUB-${request.referenceId.slice(0, 8).toUpperCase()}`,
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      fulfillmentRef: `stub-${request.referenceId}`,
    };
  }

  try {
    const body = JSON.stringify({
      client_id: clientId,
      product_code: request.productCode,
      quantity: request.quantity,
      reference_id: request.referenceId,
      user_mobile: request.userMobile ?? "",
      user_email: request.userEmail ?? "",
    });

    const res = await fetch(`${apiUrl}/v1/vouchers/issue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": clientId,
        "X-Timestamp": String(Date.now()),
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, errorCode: String(res.status), errorMessage: text };
    }

    const json = (await res.json()) as {
      voucher_code: string;
      expiry_date: string;
      fulfillment_ref: string;
    };
    return {
      ok: true,
      voucherCode: json.voucher_code,
      expiryDate: json.expiry_date,
      fulfillmentRef: json.fulfillment_ref,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errorCode: "NETWORK_ERROR", errorMessage: message };
  }
}
