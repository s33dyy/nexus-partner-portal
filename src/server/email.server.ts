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

function resendApiKey(): string {
  return process.env.RESEND_API_KEY ?? "";
}

function sendgridApiKey(): string {
  return process.env.SENDGRID_API_KEY ?? "";
}

function fromAddress(): string {
  return process.env.EMAIL_FROM ?? "";
}

export function resolveEmailProvider(): EmailProvider {
  if (!fromAddress()) return "none";
  if (resendApiKey()) return "resend";
  if (sendgridApiKey()) return "sendgrid";
  return "none";
}

export function isEmailConfigured(): boolean {
  return resolveEmailProvider() !== "none";
}

let warnedUnconfigured = false;

// A very loose check — the goal is only to avoid POSTing obvious junk to the
// provider, not to validate deliverability, which no regex can do anyway.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const provider = resolveEmailProvider();
  if (provider === "none") {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "[email] no provider configured (set EMAIL_FROM plus RESEND_API_KEY or SENDGRID_API_KEY) — email delivery is disabled",
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
      ? await sendViaResend({ ...input, to })
      : await sendViaSendgrid({ ...input, to });
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

async function sendViaResend(input: SendEmailInput): Promise<SendEmailResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress(),
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

async function sendViaSendgrid(input: SendEmailInput): Promise<SendEmailResult> {
  const content = [{ type: "text/plain", value: input.text }];
  if (input.html) content.push({ type: "text/html", value: input.html });

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sendgridApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.to }] }],
      from: { email: fromAddress() },
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
