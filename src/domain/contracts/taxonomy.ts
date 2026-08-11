export const ROLE_KEYS = [
  "super_admin",
  "rm",
  "pam",
  "kam",
  "isr",
  "livey_support",
  "restricted_distributor",
  "partner_admin",
  "partner_user",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const TEAM_DOMAINS = [
  "identity",
  "governance",
  "partner_success",
  "sales",
  "support",
  "learning",
  "rewards",
  "logistics",
  "integrations",
  "analytics",
] as const;

export type TeamDomainKey = (typeof TEAM_DOMAINS)[number];

export const GEOGRAPHY_NODE_TYPES = [
  "global",
  "sales_region",
  "country",
  "province_state",
] as const;

export type GeographyNodeType = (typeof GEOGRAPHY_NODE_TYPES)[number];

export const ASSIGNMENT_STATUSES = [
  "scheduled",
  "active",
  "suspended",
  "ended",
  "revoked",
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const PARTNER_LIFECYCLE_STATUSES = [
  "pending_partner_registration",
  "submitted",
  "under_review",
  "need_more_info",
  "partial_approval",
  "pending_agreement",
  "signed_pending_review",
  "approved",
  "rejected",
] as const;

export type PartnerLifecycleStatus = (typeof PARTNER_LIFECYCLE_STATUSES)[number];

export const DEAL_STAGES = [
  "sourced",
  "demo",
  "testing",
  "qualified",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export const REGISTRATION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "need_more_info",
] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const DISCOUNT_REVIEW_STATUSES = [
  "not_requested",
  "pending_review",
  "approved",
  "rejected",
  "expired",
] as const;

export type DiscountReviewStatus = (typeof DISCOUNT_REVIEW_STATUSES)[number];

export const PO_REVIEW_STATUSES = [
  "not_required",
  "requested",
  "received",
  "verified",
  "rejected",
  "closed",
] as const;

export type PoReviewStatus = (typeof PO_REVIEW_STATUSES)[number];

// §23.4's Coverage Exception workflow dictionary (open/in_remediation/
// resolved/cancelled) — previously absent from this file entirely (§2's
// §23a/§23b findings). coverage_exceptions.status (db/schema.sql, added
// 2026-08-06 alongside the 9g Testing->Qualified handoff fix) uses these
// exact keys; only "open" is ever written by that fix today — the
// remediation workflow that would transition through the rest isn't built.
export const COVERAGE_EXCEPTION_STATUSES = [
  "open",
  "in_remediation",
  "resolved",
  "cancelled",
] as const;

export type CoverageExceptionStatus = (typeof COVERAGE_EXCEPTION_STATUSES)[number];

export const TASK_STATUSES = [
  "draft",
  "queued",
  "open",
  "in_progress",
  "blocked",
  "waiting",
  "done",
  "canceled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TICKET_STATUSES = [
  "open",
  "triaged",
  "waiting_on_partner",
  "waiting_on_livey",
  "resolved",
  "closed",
  "reopened",
  "canceled",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "converted",
  "disqualified",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEARNING_STATUSES = ["draft", "published", "archived"] as const;
export type LearningStatus = (typeof LEARNING_STATUSES)[number];

export const REWARD_STATUSES = [
  "requested",
  "approved",
  "fulfilled",
  "rejected",
  "canceled",
] as const;

export type RewardStatus = (typeof REWARD_STATUSES)[number];

export const SHIPMENT_STATUSES = [
  "pending",
  "packed",
  "shipped",
  "delivered",
  "returned",
  "lost",
  "canceled",
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const AGREEMENT_STATUSES = [
  "draft",
  "sent",
  "signed",
  "pending_review",
  "active",
  "expired",
  "canceled",
] as const;

export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const PROVIDER_CONNECTION_STATUSES = ["pending", "connected", "failed", "revoked"] as const;

export type ProviderConnectionStatus = (typeof PROVIDER_CONNECTION_STATUSES)[number];

export const FULFILLMENT_STATUSES = [
  "queued",
  "in_progress",
  "fulfilled",
  "failed",
  "canceled",
] as const;

export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export const PARTICIPANT_TYPES = [
  "primary_owner",
  "collaborator",
  "approver",
  "observer",
  "support_contact",
] as const;

export type ParticipantType = (typeof PARTICIPANT_TYPES)[number];

export const TAG_TYPES = [
  "governance",
  "commercial",
  "support",
  "learning",
  "reward",
  "integration",
  "geography",
  "risk",
] as const;

export type TagType = (typeof TAG_TYPES)[number];

export const DOCUMENT_VISIBILITY_CLASSES = [
  "public",
  "internal",
  "partner",
  "account",
  "private",
] as const;

export type DocumentVisibilityClass = (typeof DOCUMENT_VISIBILITY_CLASSES)[number];

export const DOCUMENT_PURPOSE_CATEGORIES = [
  "contract",
  "identity",
  "tax",
  "support",
  "sales",
  "training",
  "reward",
  "integration",
] as const;

export type DocumentPurposeCategory = (typeof DOCUMENT_PURPOSE_CATEGORIES)[number];

export const HUMAN_READABLE_ID_NAMESPACES = [
  "assignment",
  "partner",
  "deal",
  "task",
  "ticket",
  "lead",
  "reward",
  "shipment",
  "agreement",
  "provider",
  "document",
  "context",
  "command",
  "event",
] as const;

export type HumanReadableIdNamespace = (typeof HUMAN_READABLE_ID_NAMESPACES)[number];

export const CURRENCY_CODES = ["USD", "INR"] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export const EVENT_SCHEMA_VERSIONS = {
  assignment: 1,
  partner: 1,
  deal: 1,
  registration: 1,
  discount: 1,
  po_review: 1,
  task: 1,
  ticket: 1,
  lead: 1,
  learning: 1,
  reward: 1,
  shipment: 1,
  agreement: 1,
  provider_connection: 1,
  fulfillment: 1,
  document: 1,
  command: 1,
  outbox: 1,
  inbox: 1,
  activity: 1,
  audit: 1,
  telemetry: 1,
} as const;

export type EventFamilyKey = keyof typeof EVENT_SCHEMA_VERSIONS;

export const DOMAIN_TERMS_VERSION = 1 as const;

export type StableContractVersion = typeof DOMAIN_TERMS_VERSION;
