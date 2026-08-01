import { expect, test } from "bun:test";

import { parseIntent } from "@/server/assistant.server";

process.env.DATABASE_URL ??= "postgres://localhost/test";

test("parseIntent classifies list_deals with stage/status", () => {
  const intent = parseIntent(
    '{"type":"list_deals","reply":"Here you go","stage":"Negotiation","status":"submitted","draft":null}',
  );
  expect(intent.type).toBe("list_deals");
  if (intent.type === "list_deals") {
    expect(intent.stage).toBe("negotiation");
    expect(intent.status).toBe("submitted");
  }
});

test("parseIntent classifies create_deal_draft and only keeps fields the model actually gave", () => {
  const intent = parseIntent(
    '{"type":"create_deal_draft","reply":"Need an amount","draft":{"accountName":"Acme Corp","contactName":null,"product":"WC350","quantity":10,"amount":null,"currencyCode":null,"country":null,"notes":null}}',
  );
  expect(intent.type).toBe("create_deal_draft");
  if (intent.type === "create_deal_draft") {
    expect(intent.draft.accountName).toBe("Acme Corp");
    expect(intent.draft.contactName).toBeNull();
    expect(intent.draft.quantity).toBe(10);
    // The model never resolves these — only sendAssistantMessage's
    // resolveDraftLinks does, after parseIntent returns.
    expect(intent.draft.partnerId).toBeNull();
    expect(intent.draft.customerId).toBeNull();
  }
});

const LIST_INTENT_CASES = [
  { type: "list_partners", query: "Acme" },
  { type: "list_customers", query: null },
  { type: "list_tasks", query: "renewal" },
  { type: "list_tickets", query: null },
  { type: "list_users", query: "Priya" },
  { type: "list_learning", query: null },
] as const;

for (const testCase of LIST_INTENT_CASES) {
  test(`parseIntent classifies ${testCase.type} with its query`, () => {
    const intent = parseIntent(
      JSON.stringify({
        type: testCase.type,
        reply: "Searching now",
        query: testCase.query,
      }),
    );
    expect(intent.type).toBe(testCase.type);
    expect("query" in intent ? intent.query : undefined).toBe(testCase.query);
  });
}

test("parseIntent treats an empty query string as null", () => {
  const intent = parseIntent('{"type":"list_partners","reply":"ok","query":"   "}');
  expect(intent.type).toBe("list_partners");
  if (intent.type === "list_partners") {
    expect(intent.query).toBeNull();
  }
});

test("parseIntent falls back to none for an unrecognised type", () => {
  const intent = parseIntent('{"type":"delete_everything","reply":"nope"}');
  expect(intent.type).toBe("none");
});

test("parseIntent falls back to none for unparseable model output without dropping the raw text", () => {
  const intent = parseIntent("I'm not sure what you mean by that.");
  expect(intent.type).toBe("none");
  if (intent.type === "none") {
    expect(intent.reply).toContain("not sure what you mean");
  }
});

test("parseIntent strips markdown code fences around the JSON object", () => {
  const intent = parseIntent('```json\n{"type":"list_tickets","reply":"ok","query":"urgent"}\n```');
  expect(intent.type).toBe("list_tickets");
  if (intent.type === "list_tickets") {
    expect(intent.query).toBe("urgent");
  }
});
