import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { summarizeOpenPipeline } from "./pipeline-metrics";

test("open Pipeline excludes terminal stages and prefers effective DTP", () => {
  const result = summarizeOpenPipeline([
    {
      id: "a",
      stage: "sourced",
      effectiveDtpUsd: 1200,
      amountUsd: 900,
      amountValue: 900,
      currencyCode: "USD",
    },
    {
      id: "b",
      stage: "negotiation",
      effectiveDtpUsd: null,
      amountUsd: 800,
      amountValue: 800,
      currencyCode: "USD",
    },
    {
      id: "c",
      stage: "won",
      effectiveDtpUsd: 5000,
      amountUsd: 5000,
      amountValue: 5000,
      currencyCode: "USD",
    },
    {
      id: "d",
      stage: "lost",
      effectiveDtpUsd: 7000,
      amountUsd: 7000,
      amountValue: 7000,
      currencyCode: "USD",
    },
  ]);

  expect(result).toEqual({ pipelineValueUsd: 2000, openDealCount: 2, missingDtpCount: 0 });
});

test("Pipeline never parses free text and reports missing reliable DTP", () => {
  const result = summarizeOpenPipeline([
    {
      id: "a",
      stage: "proposal",
      effectiveDtpUsd: null,
      amountUsd: null,
      amountValue: 1200,
      currencyCode: "INR",
    },
    {
      id: "b",
      stage: "testing",
      effectiveDtpUsd: null,
      amountUsd: null,
      amountValue: 300,
      currencyCode: "USD",
    },
  ]);

  expect(result).toEqual({ pipelineValueUsd: 300, openDealCount: 2, missingDtpCount: 1 });
});

test("dashboard consumes governed Pipeline metrics instead of parsing Deal amount", () => {
  const source = readFileSync(
    resolve(import.meta.dir, "../../../../apps/frontend/src/routes/_authenticated/dashboard.tsx"),
    "utf8",
  );
  expect(source).toContain("loadDashboardPipeline");
  expect(source).not.toContain("function resolveUsdAmount");
  expect(source).not.toContain("parseDealAmount");
  expect(source).toContain("Open opportunities at current DTP");
});
