import { expect, test } from "bun:test";

import { createCommandEnvelope, createOutboxEnvelope } from "./commands";
import { assertFeatureFlagEnabled, FEATURE_FLAG_REGISTRY } from "./feature-flags";
import { parseMoneyInput } from "./money";
import {
  buildLookupValueSeedRows,
  listGovernedLookupFields,
} from "./reference-data";
import { CANONICAL_STATE_MACHINES, createStateMachine } from "./state-machine";

test("governed reference seeds are stable and keyed by approved fields", () => {
  const rows = buildLookupValueSeedRows();
  const allowedFields = new Set(listGovernedLookupFields());

  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => allowedFields.has(row.field_name))).toBe(true);

  const keys = new Set(rows.map((row) => `${row.field_name}:${row.value_key}`));
  expect(keys.size).toBe(rows.length);
  expect(buildLookupValueSeedRows()).toEqual(rows);
});

test("money parsing rejects floating and ambiguous input", () => {
  expect(() => parseMoneyInput(12.34 as never)).toThrow("Money value must be an object");
  expect(() => parseMoneyInput("1,200.00")).toThrow(
    "Money string must be a plain decimal without separators or symbols",
  );
  expect(() => parseMoneyInput("₹1200")).toThrow(
    "Money string must be a plain decimal without separators or symbols",
  );
  expect(
    parseMoneyInput({
      currencyCode: "USD",
      amount: "1200.5",
      scale: 2,
    }),
  ).toEqual({ currencyCode: "USD", amount: "1200.50", scale: 2 });
});

test("command envelopes require version and context", () => {
  expect(() =>
    createCommandEnvelope({
      commandName: "deal.win",
      subjectId: "deal-1",
      expectedVersion: -1,
      actorUserId: "user-1",
      assignmentId: "assignment-1",
      activeContextId: "context-1",
      tenantId: "tenant-1",
      organizationTenantId: "tenant-1",
      workingScope: null,
      channel: "ui",
      source: "server",
      idempotencyKey: null,
      reason: null,
      payload: {},
    }),
  ).toThrow("Command envelope requires a non-negative expectedVersion");

  expect(() =>
    createCommandEnvelope({
      commandName: "deal.win",
      subjectId: "deal-1",
      expectedVersion: 1,
      actorUserId: "user-1",
      assignmentId: "",
      activeContextId: "context-1",
      tenantId: "tenant-1",
      organizationTenantId: "tenant-1",
      workingScope: null,
      channel: "ui",
      source: "server",
      idempotencyKey: null,
      reason: null,
      payload: {},
    } as never),
  ).toThrow("Command envelope requires user, assignment, and context");

  const envelope = createCommandEnvelope({
    commandName: "deal.win",
    subjectId: "deal-1",
    expectedVersion: 2,
    actorUserId: "user-1",
    assignmentId: "assignment-1",
    activeContextId: "context-1",
    tenantId: "tenant-1",
    organizationTenantId: "tenant-1",
    workingScope: null,
    channel: "ui",
    source: "server",
    idempotencyKey: "idem-1",
    reason: "test",
    correlationId: "3b2fef1e-20b8-4f0d-9c3e-0f8cf44b5678",
    payload: { hello: "world" },
  });

  expect(envelope.expectedVersion).toBe(2);
  expect(envelope.correlationId).toBe("3b2fef1e-20b8-4f0d-9c3e-0f8cf44b5678");
});

// Object.values(CANONICAL_STATE_MACHINES) widens to a union of differently-
// parameterised StateMachine<State> instances, so TS can no longer prove a
// given machine's own `from`/`to` literal union is what its methods expect.
// Erase to the shared string-keyed shape once per machine instead of `any`
// per call — the implementation only does Set/record lookups by value, so
// this is a type-only widening with no behavioural change.
type AnyStateMachine = ReturnType<typeof createStateMachine<string>>;

test("canonical state machines reject unlisted pairs", () => {
  for (const rawMachine of Object.values(CANONICAL_STATE_MACHINES)) {
    const machine = rawMachine as AnyStateMachine;
    for (const from of machine.states) {
      const allowed = new Set(machine.listAllowedTransitions(from));
      for (const to of machine.states) {
        const result = machine.checkTransition(from, to);
        const shouldAllow = allowed.has(to) && from !== to;
        expect(result.allowed).toBe(shouldAllow);
        if (shouldAllow) {
          expect(() => machine.assertTransition(from, to)).not.toThrow();
        } else {
          expect(() => machine.assertTransition(from, to)).toThrow(
            `Transition ${from} -> ${to} is not permitted`,
          );
        }
      }
    }
  }
});

test("feature flags fail closed on server-side denial", () => {
  const flag = FEATURE_FLAG_REGISTRY.find((entry) => entry.key === "active-context-switch");
  expect(flag?.enabledByDefault).toBe(false);
  expect(() =>
    assertFeatureFlagEnabled(
      "active-context-switch",
      {
        role: "partner_user",
        tenantId: "tenant-1",
        isSuperAdmin: false,
        environment: "development",
      },
      {},
    ),
  ).toThrow("Feature flag disabled: active-context-switch");
});

test("canonical machine helper rejects unknown states", () => {
  const machine = createStateMachine({
    name: "toy",
    states: ["open", "closed"] as const,
    transitions: { open: ["closed"], closed: [] },
    metadata: {},
  });

  expect(machine.checkTransition("open", "unknown" as never).allowed).toBe(false);
});
