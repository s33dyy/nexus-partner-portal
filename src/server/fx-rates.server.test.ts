import { afterEach, expect, test } from "bun:test";

import { quoteCurrencyToInr } from "@/server/fx-rates.server";

const originalFetch = globalThis.fetch;
const originalProviderKey = process.env.FX_PROVIDER_KEY;
const originalProviderUrl = process.env.FX_PROVIDER_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalProviderUrl === undefined) {
    delete process.env.FX_PROVIDER_URL;
  } else {
    process.env.FX_PROVIDER_URL = originalProviderUrl;
  }
  if (originalProviderKey === undefined) {
    delete process.env.FX_PROVIDER_KEY;
  } else {
    process.env.FX_PROVIDER_KEY = originalProviderKey;
  }
});

test("quoteCurrencyToInr returns an internal identity quote for INR without calling fetch", async () => {
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  }) as unknown as typeof fetch;

  const result = await quoteCurrencyToInr({
    sourceCurrency: "inr",
    amount: 1250.5,
  });

  expect(fetchCalled).toBe(false);
  expect(result.sourceCurrency).toBe("INR");
  expect(result.rate).toBe(1);
  expect(result.computedInrAmount).toBe(1250.5);
  expect(result.provider).toBe("internal");
});

test("quoteCurrencyToInr loads the provider rate and appends an api key when configured", async () => {
  process.env.FX_PROVIDER_URL = "https://rates.example/{base}";
  process.env.FX_PROVIDER_KEY = "test-key";

  let requestedUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        rates: { INR: 83.45 },
        date: "2026-07-27",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;

  const result = await quoteCurrencyToInr({
    sourceCurrency: "usd",
    amount: 10,
  });

  expect(requestedUrl).toBe("https://rates.example/USD?apikey=test-key");
  expect(result).toEqual({
    sourceCurrency: "USD",
    amount: 10,
    rate: 83.45,
    computedInrAmount: 834.5,
    provider: "rates.example",
    timestamp: "2026-07-27",
  });
});

test("quoteCurrencyToInr rejects a provider response that does not include an INR rate", async () => {
  process.env.FX_PROVIDER_URL = "https://rates.example/{base}";

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ rates: { USD: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

  await expect(
    quoteCurrencyToInr({
      sourceCurrency: "EUR",
      amount: 25,
    }),
  ).rejects.toThrow("FX provider did not return an INR rate for EUR");
});
