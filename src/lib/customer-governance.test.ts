import { expect, test } from "bun:test";

import {
  buildCustomerMergePlan,
  buildCustomerParticipantTagHistoryRecord,
  buildDealParticipantTagHistoryRecord,
  buildCustomerParticipantTagRecord,
  buildDealParticipantTagRecord,
  detectCustomerDuplicateMatches,
  detectCustomerDuplicateMatchesForRecord,
  isParticipantTagEffectiveAt,
} from "@/lib/customer-governance";

test("detectCustomerDuplicateMatches normalizes name, domain, phone, ids, country, and address", () => {
  const records = [
    {
      id: "customer-1",
      company_name: "Acme Labs",
      domain: "https://www.acme.com/",
      phone: "+91 (987) 654-3210",
      tax_registration_id: "GSTIN-1234",
      provider_id: "PROV-001",
      country: "India",
      address: "12, Main Street, Mumbai",
      external_ids: [],
      is_seed: false,
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-29T00:00:00.000Z",
    },
    {
      id: "customer-2",
      company_name: " acme   labs ",
      domain: "acme.com",
      phone: "91 9876543210",
      tax_registration_id: "gstin1234",
      provider_id: "prov 001",
      country: " india ",
      address: "12 main street mumbai",
      external_ids: [],
      is_seed: false,
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-29T00:00:00.000Z",
    },
    {
      id: "customer-3",
      company_name: "Beta Works",
      domain: "beta.example",
      phone: "555-0100",
      tax_registration_id: "GSTIN-9999",
      provider_id: "PROV-999",
      country: "Singapore",
      address: "8 Ocean Road",
      external_ids: [],
      is_seed: false,
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-29T00:00:00.000Z",
    },
  ];

  const matches = detectCustomerDuplicateMatches(records);

  expect(matches).toHaveLength(7);
  expect(matches.map((match) => match.field)).toEqual([
    "company_name",
    "domain",
    "phone",
    "tax_registration_id",
    "provider_id",
    "country",
    "address",
  ]);
  expect(matches.every((match) => match.record_ids.includes("customer-1"))).toBe(true);
  expect(matches.every((match) => match.record_ids.includes("customer-2"))).toBe(true);
  expect(
    detectCustomerDuplicateMatchesForRecord(records[0]!, records).every((match) =>
      match.record_ids.includes("customer-1"),
    ),
  ).toBe(true);
});

test("buildCustomerMergePlan preserves external ids and keeps the canonical record clean", () => {
  const canonicalRecord = {
    id: "customer-1",
    company_name: "Acme Labs",
    domain: "acme.com",
    phone: "+91 9876543210",
    tax_registration_id: "GSTIN-1234",
    provider_id: "PROV-001",
    country: "India",
    address: "12 Main Street",
    external_ids: [{ system: "crm", value: "A-1", source: "zoho" }],
    is_seed: false,
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
  };
  const sourceRecords = [
    {
      id: "customer-2",
      company_name: " acme labs ",
      domain: "https://www.acme.com/",
      phone: "91-987-654-3210",
      tax_registration_id: "gstin1234",
      provider_id: "PROV-001",
      country: " india ",
      address: "12 Main Street",
      external_ids: [
        { system: "crm", value: "A-1", source: "zoho" },
        { system: "erp", value: "E-2", source: "sap" },
      ],
      is_seed: false,
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-29T00:00:00.000Z",
    },
  ];

  const originalCanonical = structuredClone(canonicalRecord);
  const plan = buildCustomerMergePlan({
    canonicalRecord,
    sourceRecords,
    scopeRestrictionFlags: {
      restrictCustomerScope: true,
      restrictDealScope: false,
      restrictParticipantScope: true,
      restrictExternalSync: true,
    },
  });

  expect(canonicalRecord).toEqual(originalCanonical);
  expect(plan.canonicalRecord.external_ids).toEqual([
    { system: "crm", value: "A-1", source: "zoho" },
    { system: "erp", value: "E-2", source: "sap" },
  ]);
  expect(plan.redirectToCustomerId).toBe("customer-1");
  expect(plan.sourceRecordIds).toEqual(["customer-2"]);
  expect(plan.scopeRestrictionFlags).toEqual({
    restrictCustomerScope: true,
    restrictDealScope: false,
    restrictParticipantScope: true,
    restrictExternalSync: true,
  });
  expect(plan.beforeEvidence.some((entry) => entry.customer_id === "customer-2")).toBe(true);
  expect(plan.afterEvidence.every((entry) => entry.customer_id === "customer-1")).toBe(true);
});

test("participant tag helpers preserve source, actor, reason, provenance, and effective intervals", () => {
  const customerTag = buildCustomerParticipantTagRecord({
    id: "customer-tag-1",
    customer_id: "customer-1",
    participant_id: "participant-1",
    tag_key: "priority",
    tag_value: "gold",
    source: "manual",
    actor_id: "user-1",
    reason: "VIP account",
    effective_from: "2026-07-29T00:00:00.000Z",
    effective_to: "2026-08-29T00:00:00.000Z",
    provenance: "customer-portal",
  });
  const dealTag = buildDealParticipantTagRecord({
    id: "deal-tag-1",
    deal_id: "deal-1",
    participant_id: "participant-1",
    tag_key: "role",
    tag_value: "approver",
    source: "sync",
    actor_id: "user-2",
    reason: "Deal owner approved",
    effective_from: "2026-07-29T00:00:00.000Z",
    provenance: "crm-sync",
  });

  expect(isParticipantTagEffectiveAt(customerTag, "2026-08-01T00:00:00.000Z")).toBe(true);
  expect(isParticipantTagEffectiveAt(customerTag, "2026-09-01T00:00:00.000Z")).toBe(false);
  expect(customerTag.source).toBe("manual");
  expect(customerTag.actor_id).toBe("user-1");
  expect(customerTag.reason).toBe("VIP account");
  expect(customerTag.provenance).toBe("customer-portal");

  const customerHistory = buildCustomerParticipantTagHistoryRecord({
    ...customerTag,
    before_state: null,
    after_state: { tag_value: "gold" },
  });
  const dealHistory = buildDealParticipantTagHistoryRecord({
    ...dealTag,
    before_state: { tag_value: null },
    after_state: { tag_value: "approver" },
  });

  expect(customerHistory.customer_id).toBe("customer-1");
  expect(customerHistory.before_state).toBeNull();
  expect(customerHistory.after_state).toEqual({ tag_value: "gold" });
  expect(dealHistory.deal_id).toBe("deal-1");
  expect(dealHistory.source).toBe("sync");
  expect(dealHistory.reason).toBe("Deal owner approved");
  expect(dealHistory.provenance).toBe("crm-sync");
});
