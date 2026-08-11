import { afterEach, expect, test } from "bun:test";

import { quoteCurrencyToUsd } from "@/server/fx-rates.server";

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

test("quoteCurrencyToUsd returns an internal identity quote for USD without calling fetch", async () => {
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  }) as unknown as typeof fetch;

  const result = await quoteCurrencyToUsd({
    sourceCurrency: "usd",
    amount: 1250.5,
  });

  expect(fetchCalled).toBe(false);
  expect(result.sourceCurrency).toBe("USD");
  expect(result.rate).toBe(1);
  expect(result.computedUsdAmount).toBe(1250.5);
  expect(result.provider).toBe("internal");
});

test("quoteCurrencyToUsd loads the provider rate and appends an api key when configured", async () => {
  process.env.FX_PROVIDER_URL = "https://rates.example/{base}";
  process.env.FX_PROVIDER_KEY = "test-key";

  let requestedUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        rates: { USD: 83.45 },
        date: "2026-07-27",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;

  const result = await quoteCurrencyToUsd({
    sourceCurrency: "inr",
    amount: 10,
  });

  expect(requestedUrl).toBe("https://rates.example/INR?apikey=test-key");
  expect(result).toEqual({
    sourceCurrency: "INR",
    amount: 10,
    rate: 83.45,
    computedUsdAmount: 834.5,
    provider: "rates.example",
    timestamp: "2026-07-27",
  });
});

test("quoteCurrencyToUsd rejects a provider response that does not include a USD rate", async () => {
  process.env.FX_PROVIDER_URL = "https://rates.example/{base}";

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ rates: { INR: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

  await expect(
    quoteCurrencyToUsd({
      sourceCurrency: "EUR",
      amount: 25,
    }),
  ).rejects.toThrow("FX provider did not return a USD rate for EUR");
});
