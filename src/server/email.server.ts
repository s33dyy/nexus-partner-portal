// Transactional email sender.
//
// Nothing in this project sent email before this module existed (password
// reset issues a token row and a link, it never mails anything), so this is
// deliberately the smallest thing that can work in production without adding
// a dependency: a direct HTTPS call to a provider's REST API. No SMTP
// client, no nodemailer, no queue.
//
// Two providers are supported because they are the two that need only an API
// key and a single POST — Resend and SendGrid. Which one is used is decided
// entirely by which env vars are present, so switching providers is a
// deployment change, not a code change.
//
// IMPORTANT: when no provider is configured, sendEmail() does NOT throw. It
// returns { ok: false, skipped: true } and logs once. The reminder sweep runs
// unattended on a schedule and fans out to three channels; an unconfigured
// email provider must degrade to "in-app and WhatsApp still worked", never to
// a crashed sweep that silently stops reminding anyone about anything.

import {
  resolveEmailCredentials,
  type EmailSettingsDeps,
  type ResolvedEmailCredentials,
} from "@/server/email-settings.server";

type EmailProvider = "resend" | "sendgrid" | "none";

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type SendEmailResult =
  | { ok: true; provider: EmailProvider; id: string | null }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; reason: string };

/**
 * Which provider will actually be used, and with what credentials.
 *
 * Async because the credentials are no longer environment-only: an admin can
 * save them from Settings (see email-settings.server.ts), and a saved key
 * takes precedence over the environment variable. The lookup is cached there,
 * so this stays cheap enough to call per message.
 */
export async function resolveEmailDelivery(
  deps?: EmailSettingsDeps,
): Promise<ResolvedEmailCredentials> {
  const credentials = await resolveEmailCredentials(deps);
  // A provider with no from-address cannot send, whichever source it came
  // from — the providers reject the POST outright.
  if (!credentials.fromAddress) {
    return { ...credentials, provider: "none" };
  }
  return credentials;
}

export async function resolveEmailProvider(deps?: EmailSettingsDeps): Promise<EmailProvider> {
  return (await resolveEmailDelivery(deps)).provider;
}

export async function isEmailConfigured(deps?: EmailSettingsDeps): Promise<boolean> {
  return (await resolveEmailProvider(deps)) !== "none";
}

let warnedUnconfigured = false;

// A very loose check — the goal is only to avoid POSTing obvious junk to the
// provider, not to validate deliverability, which no regex can do anyway.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export async function sendEmail(
  input: SendEmailInput,
  deps?: EmailSettingsDeps,
): Promise<SendEmailResult> {
  const delivery = await resolveEmailDelivery(deps);
  const provider = delivery.provider;
  if (provider === "none") {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "[email] no provider configured (save one in Settings, or set EMAIL_FROM plus RESEND_API_KEY or SENDGRID_API_KEY) — email delivery is disabled",
      );
    }
    return { ok: false, skipped: true, reason: "Email provider is not configured" };
  }

  const to = input.to.trim();
  if (!isPlausibleEmail(to)) {
    return { ok: false, skipped: true, reason: "Recipient address is not a valid email" };
  }

  try {
    return provider === "resend"
      ? await sendViaResend({ ...input, to }, delivery)
      : await sendViaSendgrid({ ...input, to }, delivery);
  } catch (error) {
    // Network-level failure. Callers record this as a failed dispatch and
    // move on to the next recipient rather than aborting the whole sweep.
    return {
      ok: false,
      skipped: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sendViaResend(
  input: SendEmailInput,
  delivery: ResolvedEmailCredentials,
): Promise<SendEmailResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${delivery.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: delivery.fromAddress,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      skipped: false,
      reason: `Resend responded ${response.status}: ${await safeBody(response)}`,
    };
  }

  const payload = (await response.json().catch(() => null)) as { id?: string } | null;
  return { ok: true, provider: "resend", id: payload?.id ?? null };
}

async function sendViaSendgrid(
  input: SendEmailInput,
  delivery: ResolvedEmailCredentials,
): Promise<SendEmailResult> {
  const content = [{ type: "text/plain", value: input.text }];
  if (input.html) content.push({ type: "text/html", value: input.html });

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${delivery.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.to }] }],
      from: { email: delivery.fromAddress },
      subject: input.subject,
      content,
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      skipped: false,
      reason: `SendGrid responded ${response.status}: ${await safeBody(response)}`,
    };
  }

  // SendGrid returns 202 with an empty body; the message id is in a header.
  return { ok: true, provider: "sendgrid", id: response.headers.get("x-message-id") };
}

async function safeBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "(unreadable body)";
  }
}

/**
 * Minimal, dependency-free HTML wrapper for a plain-text transactional
 * message. Deliberately inline-styled and table-free: this is a one-paragraph
 * reminder, not a marketing template, and inline styles are the only thing
 * every mail client agrees on.
 */
export function renderSimpleEmailHtml(input: {
  title: string;
  body: string;
  actionLabel?: string;
  actionUrl?: string;
  footer?: string;
}): string {
  const action =
    input.actionLabel && input.actionUrl
      ? `<p style="margin:24px 0 0"><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;background:#3730a3;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escapeHtml(input.actionLabel)}</a></p>`
      : "";
  const footer = input.footer
    ? `<p style="margin:28px 0 0;color:#6b7280;font-size:12px">${escapeHtml(input.footer)}</p>`
    : "";

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.55;color:#111827;max-width:560px;margin:0 auto;padding:24px">
  <h1 style="margin:0 0 12px;font-size:18px;font-weight:600">${escapeHtml(input.title)}</h1>
  <p style="margin:0;color:#374151;font-size:14px">${escapeHtml(input.body)}</p>
  ${action}
  ${footer}
</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
