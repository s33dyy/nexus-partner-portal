export const DEAL_STAGE_ORDER = [
  "sourced",
  "qualified",
  "proposal",
  "negotiation",
  "approved",
  "won",
  "lost",
] as const;

export type DealStage = (typeof DEAL_STAGE_ORDER)[number];

export type DealRecord = {
  id: string;
  account_name: string;
  contact_name: string;
  owner_name: string;
  region: string;
  product: string;
  stage: DealStage;
  status: string;
  amount: string;
  probability: number;
  close_date: string;
  source: string;
  last_touch: string;
  notes: string;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export type CustomerRecord = {
  id: string;
  company_name: string;
  account_owner: string;
  region: string;
  segment: string;
  health_score: number;
  mrr: string;
  renewal_date: string;
  status: string;
  next_step: string;
  last_touch: string;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export type CatalogItemRecord = {
  id: string;
  sku: string;
  product_name: string;
  category: string;
  partner_tier: string;
  list_price: string;
  margin: string;
  stock: number;
  availability: string;
  benefits: string;
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export type AuditEventRecord = {
  id: string;
  actor_name: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_name: string;
  outcome: string;
  details: string;
  severity: string;
  created_at: string;
  is_seed: boolean;
};

export type TeamMemberRecord = {
  id: string;
  company_name: string;
  full_name: string;
  email: string;
  role_title: string;
  portal_role: string;
  responsibility: string;
  status: string;
  last_active: string;
  phone: string;
  permissions: string[];
  is_seed: boolean;
  created_at: string;
  updated_at: string;
};

export const DEMO_CREDENTIALS = [
  { email: "admin@livey.test", password: "Admin123!" },
  { email: "priya@northstar.test", password: "Partner123!" },
  { email: "amit@partnershield.test", password: "Partner123!" },
  { email: "sneha@quantummesh.test", password: "Partner123!" },
  { email: "rohit@bluepeak.test", password: "Partner123!" },
] as const;

export const DEMO_DEALS: DealRecord[] = [
  {
    id: "d0000000-0000-4000-8000-000000000001",
    account_name: "ACME Infra",
    contact_name: "Raman Sethi",
    owner_name: "Amit Verma",
    region: "India West",
    product: "LIVEY WC350 QHD Webcam",
    stage: "proposal",
    status: "review_pending",
    amount: "$4,800",
    probability: 62,
    close_date: "2026-07-29",
    source: "Partner referral",
    last_touch: "Partner review sent",
    notes: "Strategic deployment for a 48-seat operations team.",
    is_seed: true,
    created_at: "2026-07-12T08:30:00Z",
    updated_at: "2026-07-20T09:15:00Z",
  },
  {
    id: "d0000000-0000-4000-8000-000000000002",
    account_name: "Metro Health",
    contact_name: "Neha Kulkarni",
    owner_name: "Priya Nair",
    region: "India South",
    product: "LIVEY Conference Kit",
    stage: "negotiation",
    status: "approved",
    amount: "$18,500",
    probability: 78,
    close_date: "2026-08-08",
    source: "Customer expansion",
    last_touch: "Pricing reviewed",
    notes: "Multi-site rollout with video rooms and desk kits.",
    is_seed: true,
    created_at: "2026-07-14T10:10:00Z",
    updated_at: "2026-07-20T15:00:00Z",
  },
  {
    id: "d0000000-0000-4000-8000-000000000003",
    account_name: "BluePeak Academy",
    contact_name: "Sneha Iyer",
    owner_name: "Kavya Shah",
    region: "India South",
    product: "LIVEY Desk Kit",
    stage: "qualified",
    status: "submitted",
    amount: "$9,200",
    probability: 41,
    close_date: "2026-08-12",
    source: "Outbound",
    last_touch: "Discovery completed",
    notes: "Education rollout with 120 faculty desks.",
    is_seed: true,
    created_at: "2026-07-09T07:50:00Z",
    updated_at: "2026-07-18T11:22:00Z",
  },
  {
    id: "d0000000-0000-4000-8000-000000000004",
    account_name: "Quantum Mesh Solutions",
    contact_name: "Rohit Kulkarni",
    owner_name: "Amit Verma",
    region: "India North",
    product: "LIVEY Creator Bundle",
    stage: "won",
    status: "won",
    amount: "$27,000",
    probability: 100,
    close_date: "2026-07-18",
    source: "Strategic partner",
    last_touch: "Order placed",
    notes: "Deal closed after executive demo and security review.",
    is_seed: true,
    created_at: "2026-07-03T09:05:00Z",
    updated_at: "2026-07-18T16:40:00Z",
  },
  {
    id: "d0000000-0000-4000-8000-000000000005",
    account_name: "North Star Systems",
    contact_name: "Priya Nair",
    owner_name: "Sneha Iyer",
    region: "India West",
    product: "LIVEY Collaboration Suite",
    stage: "proposal",
    status: "need_more_info",
    amount: "$13,750",
    probability: 55,
    close_date: "2026-08-01",
    source: "Partner referral",
    last_touch: "Missing billing address",
    notes: "Commercial review paused until the customer map is updated.",
    is_seed: true,
    created_at: "2026-07-11T12:00:00Z",
    updated_at: "2026-07-19T08:25:00Z",
  },
  {
    id: "d0000000-0000-4000-8000-000000000006",
    account_name: "Vertex Retail",
    contact_name: "Arjun Das",
    owner_name: "Rohit Kulkarni",
    region: "India East",
    product: "LIVEY Storefront Kit",
    stage: "sourced",
    status: "draft",
    amount: "$6,300",
    probability: 24,
    close_date: "2026-08-21",
    source: "Trade show",
    last_touch: "Intro call scheduled",
    notes: "New logo opportunity with 18 branch locations.",
    is_seed: true,
    created_at: "2026-07-20T10:20:00Z",
    updated_at: "2026-07-20T10:20:00Z",
  },
];

export const DEMO_CUSTOMERS: CustomerRecord[] = [
  {
    id: "c1000000-0000-4000-8000-000000000001",
    company_name: "Metro Health",
    account_owner: "Priya Nair",
    region: "India South",
    segment: "Enterprise",
    health_score: 92,
    mrr: "$22K",
    renewal_date: "2026-11-14",
    status: "active",
    next_step: "Quarterly business review",
    last_touch: "2 days ago",
    is_seed: true,
    created_at: "2026-06-15T11:00:00Z",
    updated_at: "2026-07-20T13:00:00Z",
  },
  {
    id: "c1000000-0000-4000-8000-000000000002",
    company_name: "ACME Infra",
    account_owner: "Amit Verma",
    region: "India West",
    segment: "Mid-market",
    health_score: 78,
    mrr: "$8.4K",
    renewal_date: "2026-10-03",
    status: "expansion",
    next_step: "Finalize rollout plan",
    last_touch: "Yesterday",
    is_seed: true,
    created_at: "2026-06-28T14:35:00Z",
    updated_at: "2026-07-20T12:00:00Z",
  },
  {
    id: "c1000000-0000-4000-8000-000000000003",
    company_name: "BluePeak Academy",
    account_owner: "Kavya Shah",
    region: "India South",
    segment: "Education",
    health_score: 64,
    mrr: "$4.1K",
    renewal_date: "2026-09-19",
    status: "watchlist",
    next_step: "Confirm procurement timeline",
    last_touch: "3 days ago",
    is_seed: true,
    created_at: "2026-07-01T09:10:00Z",
    updated_at: "2026-07-19T18:45:00Z",
  },
  {
    id: "c1000000-0000-4000-8000-000000000004",
    company_name: "Quantum Mesh Solutions",
    account_owner: "Amit Verma",
    region: "India North",
    segment: "Technology",
    health_score: 96,
    mrr: "$33K",
    renewal_date: "2027-01-07",
    status: "champion",
    next_step: "Upsell advanced bundle",
    last_touch: "Today",
    is_seed: true,
    created_at: "2026-05-19T08:30:00Z",
    updated_at: "2026-07-20T15:25:00Z",
  },
  {
    id: "c1000000-0000-4000-8000-000000000005",
    company_name: "North Star Systems",
    account_owner: "Sneha Iyer",
    region: "India West",
    segment: "Services",
    health_score: 71,
    mrr: "$11.8K",
    renewal_date: "2026-12-03",
    status: "growth",
    next_step: "Collect stakeholder feedback",
    last_touch: "5 days ago",
    is_seed: true,
    created_at: "2026-06-22T13:20:00Z",
    updated_at: "2026-07-18T09:40:00Z",
  },
];

export const DEMO_CATALOG_ITEMS: CatalogItemRecord[] = [
  {
    id: "e2000000-0000-4000-8000-000000000001",
    sku: "LIVEY-WC350",
    product_name: "WC350 QHD Webcam",
    category: "Hardware",
    partner_tier: "Gold",
    list_price: "$79",
    margin: "28%",
    stock: 82,
    availability: "In stock",
    benefits: "2K sensor, privacy shutter, dual mic array",
    is_seed: true,
    created_at: "2026-05-01T09:00:00Z",
    updated_at: "2026-07-20T09:00:00Z",
  },
  {
    id: "e2000000-0000-4000-8000-000000000002",
    sku: "LIVEY-CK100",
    product_name: "Conference Kit",
    category: "Bundle",
    partner_tier: "Platinum",
    list_price: "$229",
    margin: "34%",
    stock: 41,
    availability: "In stock",
    benefits: "Camera, speakerphone, and cable pack",
    is_seed: true,
    created_at: "2026-05-05T09:00:00Z",
    updated_at: "2026-07-19T14:00:00Z",
  },
  {
    id: "e2000000-0000-4000-8000-000000000003",
    sku: "LIVEY-DK010",
    product_name: "Desk Kit",
    category: "Hardware",
    partner_tier: "Silver",
    list_price: "$59",
    margin: "22%",
    stock: 138,
    availability: "In stock",
    benefits: "Ergonomic USB hub, lighting, and mount",
    is_seed: true,
    created_at: "2026-05-09T09:00:00Z",
    updated_at: "2026-07-17T11:30:00Z",
  },
  {
    id: "e2000000-0000-4000-8000-000000000004",
    sku: "LIVEY-CB900",
    product_name: "Creator Bundle",
    category: "Bundle",
    partner_tier: "Gold",
    list_price: "$319",
    margin: "31%",
    stock: 19,
    availability: "Low stock",
    benefits: "Webcam, ring light, and desk mic",
    is_seed: true,
    created_at: "2026-05-14T09:00:00Z",
    updated_at: "2026-07-20T10:00:00Z",
  },
  {
    id: "e2000000-0000-4000-8000-000000000005",
    sku: "LIVEY-SS300",
    product_name: "Support Services",
    category: "Services",
    partner_tier: "Registered",
    list_price: "$149",
    margin: "40%",
    stock: 999,
    availability: "Always on",
    benefits: "Deployment support and onboarding office hours",
    is_seed: true,
    created_at: "2026-05-20T09:00:00Z",
    updated_at: "2026-07-18T10:00:00Z",
  },
];

export const DEMO_AUDIT_EVENTS: AuditEventRecord[] = [
  {
    id: "a3000000-0000-4000-8000-000000000001",
    actor_name: "Asha Mehta",
    actor_role: "Super Admin",
    action: "Approved deal",
    target_type: "Deal",
    target_name: "ACME Infra",
    outcome: "Success",
    details: "Cleared partner review and moved to approved status.",
    severity: "medium",
    created_at: "2026-07-21T07:18:00Z",
    is_seed: true,
  },
  {
    id: "a3000000-0000-4000-8000-000000000002",
    actor_name: "Priya Nair",
    actor_role: "Partner Admin",
    action: "Updated profile",
    target_type: "Partner",
    target_name: "North Star Systems",
    outcome: "Success",
    details: "Changed company address and added finance contact.",
    severity: "low",
    created_at: "2026-07-20T15:42:00Z",
    is_seed: true,
  },
  {
    id: "a3000000-0000-4000-8000-000000000003",
    actor_name: "System",
    actor_role: "Automation",
    action: "Seeded demo data",
    target_type: "Workspace",
    target_name: "LIVEY portal",
    outcome: "Success",
    details: "Loaded demo metrics, partner records, and test credentials.",
    severity: "low",
    created_at: "2026-07-20T06:10:00Z",
    is_seed: true,
  },
  {
    id: "a3000000-0000-4000-8000-000000000004",
    actor_name: "Rohit Kulkarni",
    actor_role: "Partner User",
    action: "Uploaded document",
    target_type: "Document",
    target_name: "BluePeak GST certificate",
    outcome: "Success",
    details: "Uploaded the latest GST certificate for review.",
    severity: "low",
    created_at: "2026-07-19T13:55:00Z",
    is_seed: true,
  },
  {
    id: "a3000000-0000-4000-8000-000000000005",
    actor_name: "Asha Mehta",
    actor_role: "Super Admin",
    action: "Revoked stale access",
    target_type: "User",
    target_name: "Legacy Trial Account",
    outcome: "Success",
    details: "Removed the last seed-only session before the new rollout.",
    severity: "medium",
    created_at: "2026-07-18T11:05:00Z",
    is_seed: true,
  },
];

export const DEMO_TEAM_MEMBERS: TeamMemberRecord[] = [
  {
    id: "e4000000-0000-4000-8000-000000000001",
    company_name: "PartnerShield Technologies",
    full_name: "Amit Verma",
    email: "amit@partnershield.test",
    role_title: "Channel Lead",
    portal_role: "partner_admin",
    responsibility: "Deals and approvals",
    status: "active",
    last_active: "5 min ago",
    phone: "+91 98765 00003",
    permissions: ["deals", "documents", "team"],
    is_seed: true,
    created_at: "2026-06-12T09:20:00Z",
    updated_at: "2026-07-20T12:00:00Z",
  },
  {
    id: "e4000000-0000-4000-8000-000000000002",
    company_name: "PartnerShield Technologies",
    full_name: "Kavya Shah",
    email: "kavya@partnershield.test",
    role_title: "Operations Manager",
    portal_role: "partner_user",
    responsibility: "Documents and onboarding",
    status: "active",
    last_active: "18 min ago",
    phone: "+91 98765 00031",
    permissions: ["documents", "onboarding"],
    is_seed: true,
    created_at: "2026-06-16T09:20:00Z",
    updated_at: "2026-07-20T11:00:00Z",
  },
  {
    id: "e4000000-0000-4000-8000-000000000003",
    company_name: "North Star Systems",
    full_name: "Priya Nair",
    email: "priya@northstar.test",
    role_title: "Partner Principal",
    portal_role: "partner_admin",
    responsibility: "Executive approvals",
    status: "active",
    last_active: "Today",
    phone: "+91 98765 00002",
    permissions: ["deals", "reports", "team"],
    is_seed: true,
    created_at: "2026-06-10T09:20:00Z",
    updated_at: "2026-07-19T18:00:00Z",
  },
  {
    id: "e4000000-0000-4000-8000-000000000004",
    company_name: "BluePeak Integrators",
    full_name: "Sneha Iyer",
    email: "sneha@bluepeak.test",
    role_title: "Solutions Architect",
    portal_role: "partner_user",
    responsibility: "Pipeline and demos",
    status: "invited",
    last_active: "Not yet signed in",
    phone: "+91 98765 00041",
    permissions: ["pipeline", "documents"],
    is_seed: true,
    created_at: "2026-07-08T09:20:00Z",
    updated_at: "2026-07-20T09:30:00Z",
  },
];

export function nextDealStage(stage: DealStage): DealStage {
  const index = DEAL_STAGE_ORDER.indexOf(stage);
  return index >= 0 && index < DEAL_STAGE_ORDER.length - 1 ? DEAL_STAGE_ORDER[index + 1] : stage;
}

export function nextDealStatus(currentStatus: string, stage: DealStage): string {
  if (stage === "won" || stage === "lost") {
    return stage;
  }
  return currentStatus;
}
