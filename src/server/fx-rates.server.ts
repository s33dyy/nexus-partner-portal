import "dotenv/config";

export type FxQuoteRequest = {
  sourceCurrency: string;
  amount: number;
};

export type FxQuoteResponse = {
  sourceCurrency: string;
  amount: number;
  rate: number;
  computedInrAmount: number;
  provider: string;
  timestamp: string;
};

const DEFAULT_PROVIDER_URL = "https://open.er-api.com/v6/latest/{base}";

function normalizeCurrency(value: string) {
  return value.trim().toUpperCase();
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function buildProviderUrl(sourceCurrency: string) {
  const configured = process.env.FX_PROVIDER_URL?.trim() || DEFAULT_PROVIDER_URL;
  const withBase = configured.includes("{base}")
    ? configured.replaceAll("{base}", encodeURIComponent(sourceCurrency))
    : `${configured.replace(/\/$/, "")}/${encodeURIComponent(sourceCurrency)}`;
  const url = new URL(withBase);
  const apiKey = process.env.FX_PROVIDER_KEY?.trim();
  if (apiKey && !url.searchParams.has("apikey")) {
    url.searchParams.set("apikey", apiKey);
  }
  return url;
}

function parseProviderResponse(
  payload: Record<string, unknown>,
  sourceCurrency: string,
  amount: number,
  provider: string,
): FxQuoteResponse {
  const rateValue = (() => {
    const rates = payload.rates;
    if (!rates || typeof rates !== "object") return Number.NaN;
    const value = (rates as Record<string, unknown>).INR;
    return typeof value === "number" ? value : Number(value);
  })();

  if (!Number.isFinite(rateValue) || rateValue <= 0) {
    throw new Error(`FX provider did not return an INR rate for ${sourceCurrency}`);
  }

  const timestamp =
    (typeof payload.time_last_update_utc === "string" && payload.time_last_update_utc) ||
    (typeof payload.time_last_update_at === "string" && payload.time_last_update_at) ||
    (typeof payload.date === "string" && payload.date) ||
    new Date().toISOString();

  return {
    sourceCurrency,
    amount,
    rate: rateValue,
    computedInrAmount: roundCurrency(amount * rateValue),
    provider,
    timestamp,
  };
}

export async function quoteCurrencyToInr(input: FxQuoteRequest): Promise<FxQuoteResponse> {
  const sourceCurrency = normalizeCurrency(input.sourceCurrency);
  if (!/^[A-Z]{3}$/.test(sourceCurrency)) {
    throw new Error("Currency must be a valid 3-letter code");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Amount must be greater than zero");
  }
  if (sourceCurrency === "INR") {
    return {
      sourceCurrency,
      amount: input.amount,
      rate: 1,
      computedInrAmount: roundCurrency(input.amount),
      provider: "internal",
      timestamp: new Date().toISOString(),
    };
  }

  const url = buildProviderUrl(sourceCurrency);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });
  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(`FX lookup failed with status ${response.status}`);
  }

  return parseProviderResponse(payload, sourceCurrency, input.amount, url.hostname);
}
