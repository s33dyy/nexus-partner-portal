import { describe, expect, test } from "bun:test";

import {
  buildTokenValues,
  composeEmail,
  handleOutreachUnsubscribe,
  renderOutreachEmailHtml,
  type DueStep,
} from "@/server/outreach-sweep.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

function buildStep(overrides: Partial<DueStep> = {}): DueStep {
  return {
    executionId: "execution-1",
    enrollmentId: "enrollment-1",
    stepIndex: 0,
    stepType: "email",
    scheduledFor: "2026-08-27T08:00:00.000Z",
    trackingToken: "tok_abc",
    subject: "Welcome to the {{country}} trends report",
    body: "Hi {{first_name}},\n\nThanks for downloading.\n\nBest,\n{{sender_name}}",
    taskTitle: "",
    taskPriority: "medium",
    sequenceId: "sequence-1",
    sequenceName: "Thank you for downloading",
    threadAsReply: true,
    unenrollOnDealCreated: true,
    ownerId: "owner-1",
    partnerId: null,
    ownerName: "Mark",
    ownerEmail: "mark@livey.com",
    ownerMeetingLink: "https://cal.example/mark",
    contactName: "Devon Sharma",
    contactEmail: "devon@acme.com",
    contactEmailNormalized: "devon@acme.com",
    personalNote: "",
    customerId: "customer-1",
    companyName: "Acme Logistics",
    customerCountry: "India",
    customerRegion: "APAC",
    customerSegment: "Enterprise",
    startDate: "2026-08-27",
    firstEmailSubject: "Welcome to the {{country}} trends report",
    ...overrides,
  };
}

test("token values are derived from the contact, the customer, and the sequence owner", () => {
  const values = buildTokenValues(buildStep());
  expect(values.first_name).toBe("Devon");
  expect(values.last_name).toBe("Sharma");
  expect(values.company).toBe("Acme Logistics");
  expect(values.segment).toBe("Enterprise");
  expect(values.sender_name).toBe("Mark");
  expect(values.meeting_link).toBe("https://cal.example/mark");
});

test("a fully-resolved email composes subject and body", () => {
  const composed = composeEmail(buildStep());
  expect(composed.ok).toBe(true);
  expect(composed.subject).toBe("Welcome to the India trends report");
  expect(composed.text).toContain("Hi Devon,");
  expect(composed.text).toContain("Best,\nMark");
});

test("an email with an unresolvable token is refused rather than sent half-rendered", () => {
  const composed = composeEmail(buildStep({ contactName: "", companyName: null }));
  expect(composed.ok).toBe(false);
  expect(composed.missing).toContain("first_name");
  expect(composed.text).toBe("");
});

test("a fallback rescues a missing token instead of blocking the send", () => {
  const composed = composeEmail(
    buildStep({ contactName: "", body: "Hi {{first_name|there}},\n\nBest,\n{{sender_name}}" }),
  );
  expect(composed.ok).toBe(true);
  expect(composed.text).toContain("Hi there,");
});

test("a later email in a threaded sequence reuses the first subject with Re:", () => {
  const composed = composeEmail(
    buildStep({
      stepIndex: 2,
      subject: "One more thing",
      firstEmailSubject: "Welcome to the {{country}} trends report",
    }),
  );
  expect(composed.subject).toBe("Re: Welcome to the India trends report");
});

test("the first email is not prefixed with Re: even when threading is on", () => {
  const composed = composeEmail(buildStep());
  expect(composed.subject).toBe("Welcome to the India trends report");
});

test("a threaded follow-up is blocked when the FIRST subject has an unresolvable token", () => {
  // The follow-up's own subject renders fine — but threading means the first
  // step's subject is what actually goes out, so that is what must be checked.
  const composed = composeEmail(
    buildStep({
      stepIndex: 2,
      subject: "One more thing",
      firstEmailSubject: "Welcome to the {{country}} trends report",
      customerCountry: null,
    }),
  );
  expect(composed.ok).toBe(false);
  expect(composed.missing).toContain("country");
});

test("threading off keeps each step's own subject", () => {
  const composed = composeEmail(
    buildStep({ stepIndex: 2, subject: "One more thing", threadAsReply: false }),
  );
  expect(composed.subject).toBe("One more thing");
});

test("the personal note rides above the body on the first email only", () => {
  const first = composeEmail(buildStep({ personalNote: "Hope the Mumbai expo went well." }));
  expect(first.text.startsWith("Hope the Mumbai expo went well.")).toBe(true);

  const later = composeEmail(
    buildStep({ stepIndex: 1, personalNote: "Hope the Mumbai expo went well." }),
  );
  expect(later.text).not.toContain("Mumbai expo");
});

test("no unsubscribe footer is appended when APP_BASE_URL is unset", () => {
  // Without a base URL there is no reachable link to offer, and a footer
  // pointing at a relative path would be dead in a mail client.
  const previous = process.env.APP_BASE_URL;
  delete process.env.APP_BASE_URL;
  try {
    const composed = composeEmail(buildStep());
    expect(composed.text).not.toContain("unsubscribe");
  } finally {
    if (previous !== undefined) process.env.APP_BASE_URL = previous;
  }
});

test("an unsubscribe link is appended once APP_BASE_URL is configured", () => {
  const previous = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://portal.example.com/";
  try {
    const composed = composeEmail(buildStep());
    expect(composed.text).toContain("https://portal.example.com/api/outreach/unsubscribe/tok_abc");
    expect(composed.html).toContain("/api/outreach/unsubscribe/tok_abc");
    expect(composed.html).toContain("/api/outreach/open/tok_abc.gif");
  } finally {
    if (previous === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previous;
  }
});

test("body text is escaped into the HTML part", () => {
  const html = renderOutreachEmailHtml({
    body: '<script>alert("x")</script>',
    unsubscribeUrl: null,
    pixelUrl: null,
  });
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

test("blank lines become paragraphs and single newlines become line breaks", () => {
  const html = renderOutreachEmailHtml({
    body: "Hi Devon,\n\nLine one\nLine two",
    unsubscribeUrl: null,
    pixelUrl: null,
  });
  expect(html.match(/<p /g)?.length).toBe(2);
  expect(html).toContain("Line one<br />Line two");
});

// ---------------------------------------------------------------------------
// Unsubscribe: only POST may mutate
// ---------------------------------------------------------------------------

const CONTACT_ROW = {
  enrollment_id: "11111111-1111-4111-8111-111111111111",
  contact_email: "devon@example.test",
  contact_email_normalized: "devon@example.test",
};

/** Records the shape of every statement the handler issues, so a test can
 * assert that a read-only path wrote nothing. */
function recordingRunner() {
  const statements: string[] = [];
  return {
    statements,
    query: async (sql: string) => {
      statements.push(sql.trim().split(/\s+/)[0]!.toUpperCase());
      return { rows: sql.includes("SELECT") ? [CONTACT_ROW] : [], rowCount: 1 };
    },
  };
}

function unsubscribeRequest(method: string): Request {
  return new Request("https://example.test/api/outreach/unsubscribe/tok", { method });
}

describe("handleOutreachUnsubscribe verb handling", () => {
  // The is-GET form of this guard was fail-OPEN: a link checker's HEAD, an
  // OPTIONS preflight, or any unrecognised verb skipped the confirmation
  // page and suppressed the address outright. Suppression has no undo in any
  // product surface, so every non-POST verb must be inert.
  for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "DELETE", "PATCH"]) {
    test(`${method} renders the confirmation page and writes nothing`, async () => {
      const runner = recordingRunner();
      const response = await handleOutreachUnsubscribe(unsubscribeRequest(method), "tok", runner);

      expect(response.status).toBe(200);
      expect(runner.statements).toEqual(["SELECT"]);
    });
  }

  test("POST is the one verb that suppresses and unenrols", async () => {
    const runner = recordingRunner();
    const response = await handleOutreachUnsubscribe(unsubscribeRequest("POST"), "tok", runner);

    expect(response.status).toBe(200);
    expect(runner.statements).toContain("INSERT");
    expect(runner.statements).toContain("UPDATE");
  });

  test("an unrecognised token never reaches a write, whatever the verb", async () => {
    const statements: string[] = [];
    const runner = {
      query: async (sql: string) => {
        statements.push(sql.trim().split(/\s+/)[0]!.toUpperCase());
        return { rows: [], rowCount: 0 };
      },
    };
    const response = await handleOutreachUnsubscribe(unsubscribeRequest("POST"), "nope", runner);

    expect(response.status).toBe(404);
    expect(statements).toEqual(["SELECT"]);
  });
});
