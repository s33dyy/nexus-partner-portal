import { afterEach, describe, expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgres://localhost/test";
process.env.APP_TIMEZONE = "UTC";

import { describeDigestEmailSweep, renderDigestText } from "@/server/digest-email.server";
import type { UserDigest } from "@/domain/contracts/digest";

const ENV_KEYS = [
  "EMAIL_FROM",
  "RESEND_API_KEY",
  "DIGEST_EMAIL_ENABLED",
  "DIGEST_EMAIL_HOUR",
  "APP_BASE_URL",
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function digest(overrides: Partial<UserDigest> = {}): UserDigest {
  return {
    available: true,
    mode: "morning",
    greeting: "Good morning, Ananya",
    narrative: "Good morning, Ananya. You have 2 open deals worth $9,000 in your pipeline.",
    generatedAt: "2026-08-12T03:00:00.000Z",
    news: [],
    pipeline: { openDealCount: 2, pipelineValueUsd: 9000 },
    deals: [],
    tasks: [],
    tickets: [],
    unreadNotificationCount: 0,
    learning: [],
    completedToday: [],
    tomorrow: [],
    ...overrides,
  };
}

describe("renderDigestText", () => {
  // The narrative is already a complete, deterministic paragraph built from
  // the structured fields — the email must not paraphrase it into a second,
  // subtly different account of the same day.
  test("leads with the digest's own narrative verbatim", () => {
    const body = renderDigestText(digest());
    expect(body.startsWith("Good morning, Ananya. You have 2 open deals")).toBe(true);
  });

  test("lists the sections that have content and omits the ones that don't", () => {
    const body = renderDigestText(
      digest({
        tasks: [
          { id: "t1", title: "Ship pricing sheet", status: "to_do", priority: "high", dueAt: null },
        ],
        tickets: [{ id: "k1", subject: "Login loop", status: "open", priority: "high" }],
      }),
    );
    expect(body).toContain("Due soon:");
    expect(body).toContain("Ship pricing sheet");
    expect(body).toContain("Open tickets:");
    expect(body).toContain("Login loop");
    // No deals in this fixture, so that heading must not appear at all.
    expect(body).not.toContain("Open deals:");
  });

  test("includes a portal link only when APP_BASE_URL is set", () => {
    delete process.env.APP_BASE_URL;
    expect(renderDigestText(digest())).not.toContain("Open the portal");

    process.env.APP_BASE_URL = "https://portal.livey.test/";
    const body = renderDigestText(digest());
    // Trailing slash on the env var must not produce a double slash.
    expect(body).toContain("https://portal.livey.test/dashboard");
    expect(body).not.toContain("livey.test//dashboard");
  });
});

describe("describeDigestEmailSweep", () => {
  test("an idle sweep says why, so a silent day is distinguishable from a broken one", () => {
    const line = describeDigestEmailSweep({
      ranAt: "2026-08-12T03:00:00.000Z",
      today: "2026-08-12",
      sendHour: 8,
      eligible: 0,
      claimed: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      idleReason: "Before the 8:00 send hour",
    });
    expect(line).toContain("idle");
    expect(line).toContain("Before the 8:00 send hour");
  });

  test("a working sweep reports every outcome bucket", () => {
    const line = describeDigestEmailSweep({
      ranAt: "2026-08-12T09:00:00.000Z",
      today: "2026-08-12",
      sendHour: 8,
      eligible: 12,
      claimed: 12,
      sent: 10,
      skipped: 1,
      failed: 1,
    });
    expect(line).toContain("12 eligible");
    expect(line).toContain("12 claimed");
    expect(line).toContain("sent=10");
    expect(line).toContain("skipped=1");
    expect(line).toContain("failed=1");
  });
});
