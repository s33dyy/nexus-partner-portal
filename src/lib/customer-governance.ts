import { randomUUID } from "node:crypto";

export const CUSTOMER_DUPLICATE_FIELDS = [
  "company_name",
  "domain",
  "phone",
  "tax_registration_id",
  "provider_id",
  "country",
  "address",
] as const;

export type CustomerDuplicateField = (typeof CUSTOMER_DUPLICATE_FIELDS)[number];

export type CustomerExternalIdRecord = {
  system: string;
  value: string;
  source: string | null;
};

export type CustomerGovernanceRecord = {
  id: string;
  company_name: string;
  domain: string | null;
  phone: string | null;
  tax_registration_id: string | null;
  provider_id: string | null;
  country: string | null;
  address: string | null;
  external_ids: CustomerExternalIdRecord[];
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export type CustomerDuplicateMatch = {
  field: CustomerDuplicateField;
  normalized_value: string;
  record_ids: string[];
  records: CustomerGovernanceRecord[];
};

export type CustomerScopeRestrictionFlags = {
  restrictCustomerScope: boolean;
  restrictDealScope: boolean;
  restrictParticipantScope: boolean;
  restrictExternalSync: boolean;
};

export type CustomerMergeEvidence = {
  field: CustomerDuplicateField;
  customer_id: string;
  value: string | null;
  normalized_value: string | null;
};

export type CustomerMergePlan = {
  canonicalRecord: CustomerGovernanceRecord;
  sourceRecordIds: string[];
  redirectToCustomerId: string | null;
  mergedCustomerId: string | null;
  preservedExternalIds: CustomerExternalIdRecord[];
  beforeEvidence: CustomerMergeEvidence[];
  afterEvidence: CustomerMergeEvidence[];
  scopeRestrictionFlags: CustomerScopeRestrictionFlags;
  beforeState: {
    canonicalRecord: CustomerGovernanceSnapshot;
    mergedRecord: CustomerGovernanceSnapshot | null;
  };
  afterState: {
    canonicalRecord: CustomerGovernanceSnapshot;
    mergedRecord: CustomerGovernanceSnapshot | null;
  };
  externalIdSnapshot: {
    canonicalExternalIds: CustomerExternalIdRecord[];
    mergedExternalIds: CustomerExternalIdRecord[];
    mergedExternalIdsPreserved: boolean;
  };
  scopeRestriction: {
    restricted: boolean;
    reason: string | null;
  };
  relationMoves: {
    customerActivityRows: boolean;
    customerParticipantRows: boolean;
    dealParticipantRows: boolean;
  };
  safePreviewFields: Array<{ field: string; value: string }>;
};

export type ParticipantTagRecordBase = {
  id: string;
  participant_id: string;
  tag_key: string;
  tag_value: string | null;
  source: string;
  actor_id: string | null;
  reason: string | null;
  effective_from: string;
  effective_to: string | null;
  provenance: string;
  created_at: string;
  updated_at: string;
};

export type CustomerParticipantTagRecord = ParticipantTagRecordBase & {
  customer_id: string;
};

export type DealParticipantTagRecord = ParticipantTagRecordBase & {
  deal_id: string;
};

export type ParticipantTagHistoryRecordBase = ParticipantTagRecordBase & {
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
};

export type CustomerParticipantTagHistoryRecord = ParticipantTagHistoryRecordBase & {
  customer_id: string;
};

export type DealParticipantTagHistoryRecord = ParticipantTagHistoryRecordBase & {
  deal_id: string;
};

export type CustomerGovernanceSnapshot = {
  id: string;
  company_name: string;
  country?: string | null;
  region?: string | null;
  segment?: string | null;
  status?: string | null;
  next_step?: string | null;
  health_score?: number | null;
  mrr?: string | null;
  renewal_date?: string | null;
  last_touch?: string | null;
  partner_id?: string | null;
  user_id?: string | null;
  domain?: string | null;
  phone?: string | null;
  tax_registration_id?: string | null;
  provider_id?: string | null;
  provider_customer_id?: string | null;
  address?: string | null;
  origin?: string | null;
  duplicate_review_status?: string | null;
  master_customer_id?: string | null;
  merged_into_customer_id?: string | null;
  merged_at?: string | null;
  merge_reason?: string | null;
  external_ids?: unknown;
};

export type CustomerDuplicateGroup = {
  field: CustomerDuplicateField;
  normalizedValue: string;
  customerIds: string[];
  displayValue: string;
  scope: "global" | "same-partner" | "cross-partner";
};

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeText(value: unknown) {
  const normalized = normalizeWhitespace(String(value ?? ""));
  return normalized ? normalized.toLowerCase() : "";
}

function normalizeDomain(value: unknown) {
  return normalizeText(value)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

function normalizePhone(value: unknown) {
  const normalized = String(value ?? "").replace(/[^\d+]/g, "");
  return normalized.replace(/^(\+?0+)/, "+").replace(/\D/g, "");
}

function normalizeTaxOrRegistrationId(value: unknown) {
  return normalizeWhitespace(String(value ?? ""))
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function normalizeCountry(value: unknown) {
  return normalizeText(value);
}

function normalizeAddress(value: unknown) {
  return normalizeText(value).replace(/[^a-z0-9\s]/g, "");
}

function normalizeCustomerField(field: CustomerDuplicateField, value: unknown) {
  switch (field) {
    case "company_name":
      return normalizeText(value);
    case "domain":
      return normalizeDomain(value);
    case "phone":
      return normalizePhone(value);
    case "tax_registration_id":
    case "provider_id":
      return normalizeTaxOrRegistrationId(value);
    case "country":
      return normalizeCountry(value);
    case "address":
      return normalizeAddress(value);
  }
}

function uniqueByKey<T>(items: readonly T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  const output: T[] = [];

  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }

  return output;
}

function sortEvidence(left: CustomerMergeEvidence, right: CustomerMergeEvidence) {
  if (left.field !== right.field) {
    return (
      CUSTOMER_DUPLICATE_FIELDS.indexOf(left.field) - CUSTOMER_DUPLICATE_FIELDS.indexOf(right.field)
    );
  }
  if (left.customer_id !== right.customer_id) {
    return left.customer_id.localeCompare(right.customer_id);
  }
  return (left.normalized_value ?? "").localeCompare(right.normalized_value ?? "");
}

function asExternalIdRecord(value: unknown): CustomerExternalIdRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry) return [];
    if (typeof entry === "string") {
      const trimmed = normalizeWhitespace(entry);
      return trimmed
        ? [
            {
              system: "legacy",
              value: trimmed,
              source: null,
            },
          ]
        : [];
    }
    if (typeof entry === "object") {
      const record = entry as Partial<CustomerExternalIdRecord> & Record<string, unknown>;
      const system = normalizeWhitespace(String(record.system ?? record.source ?? "legacy"));
      const value = normalizeWhitespace(String(record.value ?? record.external_id ?? ""));
      if (!value) return [];
      return [
        {
          system: system || "legacy",
          value,
          source: record.source == null ? null : normalizeWhitespace(String(record.source)) || null,
        },
      ];
    }
    return [];
  });
}

function normalizeCustomerRecord(record: CustomerGovernanceSnapshot): CustomerGovernanceRecord {
  return {
    id: record.id,
    company_name: normalizeWhitespace(String(record.company_name ?? "")),
    domain: record.domain ? normalizeWhitespace(String(record.domain)) || null : null,
    phone: record.phone ? normalizeWhitespace(String(record.phone)) || null : null,
    tax_registration_id: record.tax_registration_id
      ? normalizeWhitespace(String(record.tax_registration_id)) || null
      : null,
    provider_id: record.provider_id
      ? normalizeWhitespace(String(record.provider_id)) || null
      : null,
    country: record.country ? normalizeWhitespace(String(record.country)) || null : null,
    address: record.address ? normalizeWhitespace(String(record.address)) || null : null,
    external_ids: asExternalIdRecord(record.external_ids),
    is_seed: false,
    created_at: "1970-01-01T00:00:00.000Z",
    updated_at: "1970-01-01T00:00:00.000Z",
  };
}

function getCustomerFieldValue(record: CustomerGovernanceRecord, field: CustomerDuplicateField) {
  return record[field];
}

function buildCustomerEvidence(
  records: readonly CustomerGovernanceRecord[],
): CustomerMergeEvidence[] {
  return records.flatMap((record) =>
    CUSTOMER_DUPLICATE_FIELDS.flatMap((field) => {
      const value = getCustomerFieldValue(record, field);
      const normalizedValue = normalizeCustomerField(field, value);
      if (!normalizedValue) return [];
      return [
        {
          field,
          customer_id: record.id,
          value: value ?? null,
          normalized_value: normalizedValue,
        },
      ];
    }),
  );
}

function mergeExternalIds(
  canonicalRecord: CustomerGovernanceRecord,
  sourceRecords: readonly CustomerGovernanceRecord[],
  preservedExternalIds: readonly CustomerExternalIdRecord[] = [],
) {
  return uniqueByKey(
    [
      ...(canonicalRecord.external_ids ?? []),
      ...sourceRecords.flatMap((record) => record.external_ids ?? []),
      ...preservedExternalIds,
    ],
    (record) =>
      `${normalizeWhitespace(record.system).toLowerCase()}::${normalizeWhitespace(record.value).toLowerCase()}`,
  );
}

export function detectCustomerDuplicateMatches(
  records: readonly CustomerGovernanceRecord[],
): CustomerDuplicateMatch[] {
  const grouped = new Map<string, CustomerDuplicateMatch>();

  for (const field of CUSTOMER_DUPLICATE_FIELDS) {
    const fieldGroups = new Map<string, CustomerGovernanceRecord[]>();

    for (const record of records) {
      const normalizedValue = normalizeCustomerField(field, getCustomerFieldValue(record, field));
      if (!normalizedValue) continue;
      const nextRecords = fieldGroups.get(normalizedValue) ?? [];
      fieldGroups.set(normalizedValue, [...nextRecords, record]);
    }

    for (const [normalizedValue, groupedRecords] of fieldGroups) {
      if (groupedRecords.length < 2) continue;
      const matchKey = `${field}:${normalizedValue}`;
      grouped.set(matchKey, {
        field,
        normalized_value: normalizedValue,
        record_ids: groupedRecords.map((record) => record.id),
        records: groupedRecords,
      });
    }
  }

  return [...grouped.values()].sort((left, right) => {
    if (left.field !== right.field) {
      return (
        CUSTOMER_DUPLICATE_FIELDS.indexOf(left.field) -
        CUSTOMER_DUPLICATE_FIELDS.indexOf(right.field)
      );
    }
    return left.normalized_value.localeCompare(right.normalized_value);
  });
}

export function detectCustomerDuplicateMatchesForRecord(
  candidate: CustomerGovernanceRecord,
  records: readonly CustomerGovernanceRecord[],
): CustomerDuplicateMatch[] {
  return detectCustomerDuplicateMatches([candidate, ...records]).filter((match) =>
    match.record_ids.includes(candidate.id),
  );
}

export function detectCustomerDuplicateGroups(
  records: readonly CustomerGovernanceSnapshot[],
): CustomerDuplicateGroup[] {
  const normalizedRecords = records.map(normalizeCustomerRecord);
  const matches = detectCustomerDuplicateMatches(normalizedRecords);
  return matches.map((match) => {
    const first = match.records[0];
    return {
      field: match.field,
      normalizedValue: match.normalized_value,
      customerIds: match.record_ids,
      displayValue:
        first && first[match.field] != null ? String(first[match.field]) : match.normalized_value,
      scope:
        records.length <= 1
          ? "global"
          : records.every(
                (record) =>
                  (record.partner_id ??
                    record.provider_id ??
                    record.provider_customer_id ??
                    null) ===
                  (records[0]?.partner_id ??
                    records[0]?.provider_id ??
                    records[0]?.provider_customer_id ??
                    null),
              )
            ? "same-partner"
            : "cross-partner",
    };
  });
}

export function buildCustomerMergePlan(input: {
  canonicalRecord: CustomerGovernanceSnapshot;
  sourceRecords?: readonly CustomerGovernanceSnapshot[];
  mergedRecord?: CustomerGovernanceSnapshot | null;
  reason?: string | null;
  redirectToCustomerId?: string | null;
  preservedExternalIds?: readonly CustomerExternalIdRecord[];
  beforeEvidence?: readonly CustomerMergeEvidence[];
  afterEvidence?: readonly CustomerMergeEvidence[];
  scopeRestrictionFlags?: Partial<CustomerScopeRestrictionFlags>;
}): CustomerMergePlan {
  const canonicalGovernance = normalizeCustomerRecord(input.canonicalRecord);
  const sourceGovernance = uniqueByKey(
    [
      ...(input.sourceRecords?.map(normalizeCustomerRecord) ?? []),
      ...(input.mergedRecord ? [normalizeCustomerRecord(input.mergedRecord)] : []),
    ],
    (record) => record.id,
  );
  const preservedExternalIds = mergeExternalIds(
    canonicalGovernance,
    sourceGovernance,
    input.preservedExternalIds,
  );
  const mergedCustomerId = input.mergedRecord?.id ?? sourceGovernance[0]?.id ?? null;
  const canonicalRecord: CustomerGovernanceRecord = {
    ...canonicalGovernance,
    external_ids: preservedExternalIds,
  };
  const beforeEvidence = [
    ...(input.beforeEvidence ?? buildCustomerEvidence([canonicalGovernance, ...sourceGovernance])),
  ].sort(sortEvidence);
  const afterEvidence = [...(input.afterEvidence ?? buildCustomerEvidence([canonicalRecord]))].sort(
    sortEvidence,
  );
  const canonicalPartner =
    input.canonicalRecord.partner_id ??
    input.canonicalRecord.provider_id ??
    input.canonicalRecord.provider_customer_id ??
    null;
  const sourcePartnerMismatch = sourceGovernance.some((record) => {
    const partner = record.provider_id ?? null;
    return canonicalPartner != null && partner != null ? partner !== canonicalPartner : false;
  });
  const scopeRestrictionFlags: CustomerScopeRestrictionFlags = {
    restrictCustomerScope:
      input.scopeRestrictionFlags?.restrictCustomerScope ?? sourcePartnerMismatch,
    restrictDealScope: input.scopeRestrictionFlags?.restrictDealScope ?? sourcePartnerMismatch,
    restrictParticipantScope:
      input.scopeRestrictionFlags?.restrictParticipantScope ?? sourcePartnerMismatch,
    restrictExternalSync:
      input.scopeRestrictionFlags?.restrictExternalSync ?? sourceGovernance.length > 1,
  };
  const scopeRestriction = {
    restricted:
      scopeRestrictionFlags.restrictCustomerScope ||
      scopeRestrictionFlags.restrictDealScope ||
      scopeRestrictionFlags.restrictParticipantScope ||
      scopeRestrictionFlags.restrictExternalSync,
    reason: sourcePartnerMismatch
      ? "Cross-partner customer merges require super-admin scope."
      : scopeRestrictionFlags.restrictExternalSync
        ? "External sync is restricted"
        : null,
  };
  const canonicalSnapshot: CustomerGovernanceSnapshot = {
    ...input.canonicalRecord,
    external_ids: preservedExternalIds,
    duplicate_review_status:
      (input.canonicalRecord.duplicate_review_status ?? "").trim() || "merged",
    merged_at: input.reason ? new Date().toISOString() : (input.canonicalRecord.merged_at ?? null),
    merge_reason: input.reason ?? input.canonicalRecord.merge_reason ?? null,
  };

  return {
    canonicalRecord,
    sourceRecordIds: sourceGovernance.map((record) => record.id),
    redirectToCustomerId: input.redirectToCustomerId ?? canonicalRecord.id,
    mergedCustomerId,
    preservedExternalIds,
    beforeEvidence,
    afterEvidence,
    scopeRestrictionFlags,
    beforeState: {
      canonicalRecord: input.canonicalRecord,
      mergedRecord: input.mergedRecord ?? null,
    },
    afterState: {
      canonicalRecord: canonicalSnapshot,
      mergedRecord:
        input.mergedRecord == null
          ? null
          : {
              ...input.mergedRecord,
              merged_into_customer_id: canonicalRecord.id,
              duplicate_review_status: "redirected",
              merge_reason: input.reason ?? input.mergedRecord.merge_reason ?? null,
            },
    },
    externalIdSnapshot: {
      canonicalExternalIds: canonicalRecord.external_ids,
      mergedExternalIds: sourceGovernance.flatMap((record) => record.external_ids ?? []),
      mergedExternalIdsPreserved: true,
    },
    scopeRestriction,
    relationMoves: {
      customerActivityRows: true,
      customerParticipantRows: true,
      dealParticipantRows: false,
    },
    safePreviewFields: CUSTOMER_DUPLICATE_FIELDS.map((field) => ({
      field,
      value: String((input.canonicalRecord as Record<string, unknown>)[field] ?? "").trim(),
    })).filter((entry) => entry.value.length > 0),
  };
}

export function buildCustomerParticipantTagRecord(input: {
  id: string;
  customer_id: string;
  participant_id: string;
  tag_key: string;
  tag_value?: string | null;
  source: string;
  actor_id?: string | null;
  reason?: string | null;
  effective_from: string;
  effective_to?: string | null;
  provenance: string;
  created_at?: string;
  updated_at?: string;
}): CustomerParticipantTagRecord {
  const createdAt = input.created_at ?? input.effective_from;
  const updatedAt = input.updated_at ?? createdAt;

  return {
    id: input.id,
    customer_id: input.customer_id,
    participant_id: input.participant_id,
    tag_key: normalizeWhitespace(input.tag_key),
    tag_value: input.tag_value ?? null,
    source: normalizeWhitespace(input.source),
    actor_id: input.actor_id ?? null,
    reason: input.reason ?? null,
    effective_from: input.effective_from,
    effective_to: input.effective_to ?? null,
    provenance: normalizeWhitespace(input.provenance),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function buildDealParticipantTagRecord(input: {
  id: string;
  deal_id: string;
  participant_id: string;
  tag_key: string;
  tag_value?: string | null;
  source: string;
  actor_id?: string | null;
  reason?: string | null;
  effective_from: string;
  effective_to?: string | null;
  provenance: string;
  created_at?: string;
  updated_at?: string;
}): DealParticipantTagRecord {
  const createdAt = input.created_at ?? input.effective_from;
  const updatedAt = input.updated_at ?? createdAt;

  return {
    id: input.id,
    deal_id: input.deal_id,
    participant_id: input.participant_id,
    tag_key: normalizeWhitespace(input.tag_key),
    tag_value: input.tag_value ?? null,
    source: normalizeWhitespace(input.source),
    actor_id: input.actor_id ?? null,
    reason: input.reason ?? null,
    effective_from: input.effective_from,
    effective_to: input.effective_to ?? null,
    provenance: normalizeWhitespace(input.provenance),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function isParticipantTagEffectiveAt(
  record: Pick<ParticipantTagRecordBase, "effective_from" | "effective_to">,
  timestamp: string,
) {
  const at = new Date(timestamp).getTime();
  const from = new Date(record.effective_from).getTime();
  const to = record.effective_to
    ? new Date(record.effective_to).getTime()
    : Number.POSITIVE_INFINITY;

  if (Number.isNaN(at) || Number.isNaN(from) || Number.isNaN(to)) {
    return false;
  }

  return from <= at && at < to;
}

export function buildCustomerParticipantTagHistoryRecord(input: {
  id: string;
  customer_id: string;
  participant_id: string;
  tag_key: string;
  tag_value?: string | null;
  source: string;
  actor_id?: string | null;
  reason?: string | null;
  effective_from: string;
  effective_to?: string | null;
  provenance: string;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}): CustomerParticipantTagHistoryRecord {
  const base = buildCustomerParticipantTagRecord(input);

  return {
    ...base,
    customer_id: input.customer_id,
    before_state: input.before_state ?? null,
    after_state: input.after_state ?? null,
  };
}

export function buildDealParticipantTagHistoryRecord(input: {
  id: string;
  deal_id: string;
  participant_id: string;
  tag_key: string;
  tag_value?: string | null;
  source: string;
  actor_id?: string | null;
  reason?: string | null;
  effective_from: string;
  effective_to?: string | null;
  provenance: string;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}): DealParticipantTagHistoryRecord {
  const base = buildDealParticipantTagRecord(input);

  return {
    ...base,
    deal_id: input.deal_id,
    before_state: input.before_state ?? null,
    after_state: input.after_state ?? null,
  };
}

export function buildParticipantPayload(input: {
  subjectType: "customer" | "deal";
  subjectId: string;
  partnerId?: string | null;
  participantType: string;
  source: string;
  actorId?: string | null;
  reason: string;
  validFrom?: string;
  validTo?: string | null;
  provenance?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const base = {
    id: randomUUID(),
    partner_id: input.partnerId ?? null,
    participant_type: normalizeWhitespace(input.participantType),
    source: normalizeWhitespace(input.source),
    actor_id: input.actorId ?? null,
    reason: normalizeWhitespace(input.reason),
    valid_from: input.validFrom ?? now,
    valid_to: input.validTo ?? null,
    provenance: input.provenance ?? {},
    is_seed: false,
    created_at: now,
    updated_at: now,
  };

  return input.subjectType === "customer"
    ? { ...base, customer_id: input.subjectId }
    : { ...base, deal_id: input.subjectId };
}

export function participantVisibilitySummary(input: {
  participantType: string;
  source: string;
  validTo: string | null;
}) {
  const openEnded = input.validTo == null || input.validTo.trim().length === 0;
  return {
    immediateAccessEligible: openEnded,
    notificationEligible: openEnded || input.source === "manual",
    openSharedWork: input.participantType !== "observer",
  };
}

export function shouldPropagateCustomerTagToDeals() {
  return false;
}

export function customerMergeRedirectPath(customerId: string) {
  return `/customers?customer=${encodeURIComponent(customerId)}`;
}
