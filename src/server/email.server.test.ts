import { afterEach, describe, expect, test } from "bun:test";

import {
  isEmailConfigured,
  isPlausibleEmail,
  renderSimpleEmailHtml,
  resolveEmailProvider,
  sendEmail,
} from "@/server/email.server";

const ENV_KEYS = ["EMAIL_FROM", "RESEND_API_KEY", "SENDGRID_API_KEY"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("resolveEmailProvider", () => {
  test("is 'none' until both a from-address and an API key exist", () => {
    clearEnv();
    expect(resolveEmailProvider()).toBe("none");

    process.env.EMAIL_FROM = "portal@livey.test";
    expect(resolveEmailProvider()).toBe("none");

    process.env.RESEND_API_KEY = "re_test";
    expect(resolveEmailProvider()).toBe("resend");
  });

  test("an API key without a from-address is still 'none'", () => {
    clearEnv();
    process.env.SENDGRID_API_KEY = "SG.test";
    expect(resolveEmailProvider()).toBe("none");
    expect(isEmailConfigured()).toBe(false);
  });

  test("prefers Resend when both providers are configured", () => {
    clearEnv();
    process.env.EMAIL_FROM = "portal@livey.test";
    process.env.RESEND_API_KEY = "re_test";
    process.env.SENDGRID_API_KEY = "SG.test";
    expect(resolveEmailProvider()).toBe("resend");
  });
});

describe("sendEmail", () => {
  // The reminder sweep fans out to three channels unattended. An
  // unconfigured email provider has to degrade to "the other two still
  // worked", never to a thrown error that aborts the sweep mid-run.
  test("skips instead of throwing when no provider is configured", async () => {
    clearEnv();
    const result = await sendEmail({
      to: "someone@livey.test",
      subject: "Due today",
      text: "body",
    });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ skipped: true });
  });

  test("skips an implausible recipient address without calling the provider", async () => {
    clearEnv();
    process.env.EMAIL_FROM = "portal@livey.test";
    process.env.RESEND_API_KEY = "re_test";

    const result = await sendEmail({ to: "not-an-address", subject: "s", text: "t" });
    expect(result).toMatchObject({ ok: false, skipped: true });
  });
});

describe("isPlausibleEmail", () => {
  test("accepts ordinary addresses and rejects obvious junk", () => {
    expect(isPlausibleEmail("someone@livey.test")).toBe(true);
    expect(isPlausibleEmail("  spaced@livey.test  ")).toBe(true);
    expect(isPlausibleEmail("no-at-sign")).toBe(false);
    expect(isPlausibleEmail("missing@tld")).toBe(false);
    expect(isPlausibleEmail("")).toBe(false);
  });
});

describe("renderSimpleEmailHtml", () => {
  test("escapes untrusted record titles so a deal name can't inject markup", () => {
    const html = renderSimpleEmailHtml({
      title: `Due today: <script>alert("x")</script>`,
      body: "Body & more",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Body &amp; more");
  });

  test("omits the action button when no URL is available", () => {
    const html = renderSimpleEmailHtml({ title: "T", body: "B" });
    expect(html).not.toContain("<a href");
  });

  test("renders the action button when a URL is supplied", () => {
    const html = renderSimpleEmailHtml({
      title: "T",
      body: "B",
      actionLabel: "Open tasks",
      actionUrl: "https://portal.livey.test/tasks",
    });
    expect(html).toContain("https://portal.livey.test/tasks");
    expect(html).toContain("Open tasks");
  });
});
