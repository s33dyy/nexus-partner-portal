import {
  GOVERNANCE_GEOGRAPHY_NODE_IDS,
  GOVERNANCE_TENANT_IDS,
  buildGovernanceSeedRows,
  issueActiveContextFromAssignment,
  type ActiveContextRecord,
  type AssignmentRecord,
  type GovernanceSeedRows,
} from "@/domain/contracts/governance";
import type { PartnerStatus } from "@livey/shared/lib/partner-status";
import type { AppRole } from "../src/server/livey-service.server";

const FIXTURE_TIMESTAMP = "2026-07-30T00:00:00.000Z";

function makeUuid(group: number, index: number) {
  return `${String(group).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

type SeedProfile = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  company_name: string | null;
  password: string;
  partner_id: string | null;
  partner_status: PartnerStatus;
  roles: AppRole[];
};

type PartnerGroup = {
  partner_id: string;
  company_name: string;
  legal_name: string;
  gst_number: string;
  pan: string;
  cin: string;
  website: string;
  business_address: string;
  country: string;
  state: string;
  business_type: string;
  years_in_business: number;
  annual_turnover: string;
  employee_count: string;
  business_focus: string[];
  status: PartnerStatus;
  tier: "registered" | "silver" | "gold" | "platinum";
  admin: Omit<SeedProfile, "partner_id" | "partner_status" | "roles" | "company_name">;
  user: Omit<SeedProfile, "partner_id" | "partner_status" | "roles" | "company_name">;
  customer: {
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
  };
  deal: {
    account_name: string;
    contact_name: string;
    owner_name: string;
    region: string;
    product: string;
    stage: string;
    status: string;
    quantity: number;
    amount: string;
    amount_value: number;
    amount_usd: number;
    customer_budget: string;
    probability: number;
    possible_close_date: string;
    close_date: string;
    source: string;
    last_touch: string;
    notes: string;
  };
};

const SUPER_ADMIN_PROFILES: SeedProfile[] = [
  {
    id: makeUuid(1, 1),
    email: "maya.admin@livey.tech",
    full_name: "Maya Iyer",
    phone: null,
    company_name: "LIVEY Technologies",
    password: "Livey-Super-1!",
    partner_id: null,
    partner_status: "approved",
    roles: ["super_admin"],
  },
  {
    id: makeUuid(1, 2),
    email: "arjun.admin@livey.tech",
    full_name: "Arjun Rao",
    phone: null,
    company_name: "LIVEY Technologies",
    password: "Livey-Super-2!",
    partner_id: null,
    partner_status: "approved",
    roles: ["super_admin"],
  },
  {
    id: makeUuid(1, 3),
    email: "nisha.admin@livey.tech",
    full_name: "Nisha Menon",
    phone: null,
    company_name: "LIVEY Technologies",
    password: "Livey-Super-3!",
    partner_id: null,
    partner_status: "approved",
    roles: ["super_admin"],
  },
  {
    id: makeUuid(1, 4),
    email: "kabir.admin@livey.tech",
    full_name: "Kabir Shah",
    phone: null,
    company_name: "LIVEY Technologies",
    password: "Livey-Super-4!",
    partner_id: null,
    partner_status: "approved",
    roles: ["super_admin"],
  },
  {
    id: makeUuid(1, 5),
    email: "sanya.admin@livey.tech",
    full_name: "Sanya Desai",
    phone: null,
    company_name: "LIVEY Technologies",
    password: "Livey-Super-5!",
    partner_id: null,
    partner_status: "approved",
    roles: ["super_admin"],
  },
];

const PARTNER_GROUPS: PartnerGroup[] = [
  {
    partner_id: makeUuid(4, 1),
    company_name: "Northstar Systems",
    legal_name: "Northstar Systems Private Limited",
    gst_number: "27AABCN1234F1Z5",
    pan: "AABCN1234F",
    cin: "U72900MH2024PTC123456",
    website: "https://northstar.example.com",
    business_address: "12 Innovation Park, Pune, Maharashtra",
    country: "India",
    state: "Maharashtra",
    business_type: "Software and Services",
    years_in_business: 8,
    annual_turnover: "₹25 Cr - ₹50 Cr",
    employee_count: "100-250",
    business_focus: ["Channel Enablement", "Recurring Revenue", "Enterprise Sales"],
    status: "approved",
    tier: "gold",
    admin: {
      id: makeUuid(2, 1),
      email: "northstar.admin@livey.tech",
      full_name: "Asha Mehta",
      phone: "+91 98765 43210",
      password: "Northstar-Admin-1!",
    },
    user: {
      id: makeUuid(3, 1),
      email: "northstar.user@livey.tech",
      full_name: "Karan Mehta",
      phone: "+91 98765 43211",
      password: "Northstar-User-1!",
    },
    customer: {
      company_name: "Northstar Retail Pvt Ltd",
      account_owner: "Asha Mehta",
      region: "West",
      segment: "Enterprise",
      health_score: 92,
      mrr: "₹4.2L",
      renewal_date: "2026-12-18",
      status: "healthy",
      next_step: "Expand the rollout to the APAC support team",
      last_touch: "Reviewed in weekly QBR",
    },
    deal: {
      account_name: "Northstar Cloud Suite",
      contact_name: "Priya Nair",
      owner_name: "Asha Mehta",
      region: "West",
      product: "Cloud Suite",
      stage: "approved",
      status: "approved",
      quantity: 4,
      amount: "$4,250",
      amount_value: 4250,
      amount_usd: 4250,
      customer_budget: "$4,500",
      probability: 100,
      possible_close_date: "2026-07-29",
      close_date: "2026-07-28",
      source: "Referral",
      last_touch: "Auto-approved after review",
      notes: "Low-risk expansion opportunity for the Northstar account.",
    },
  },
  {
    partner_id: makeUuid(4, 2),
    company_name: "Harbor Logistics",
    legal_name: "Harbor Logistics LLP",
    gst_number: "29AABCH5678Q1Z2",
    pan: "AABCH5678Q",
    cin: "U63030KA2025PTC654321",
    website: "https://harbor.example.com",
    business_address: "88 Harbour Road, Bengaluru, Karnataka",
    country: "India",
    state: "Karnataka",
    business_type: "Logistics",
    years_in_business: 5,
    annual_turnover: "₹10 Cr - ₹25 Cr",
    employee_count: "50-100",
    business_focus: ["Supply Chain", "Cross-Border Freight"],
    status: "approved",
    tier: "silver",
    admin: {
      id: makeUuid(2, 2),
      email: "harbor.admin@livey.tech",
      full_name: "Ananya Rao",
      phone: "+91 98765 43212",
      password: "Harbor-Admin-1!",
    },
    user: {
      id: makeUuid(3, 2),
      email: "harbor.user@livey.tech",
      full_name: "Rhea Menon",
      phone: "+91 98765 43215",
      password: "Harbor-User-1!",
    },
    customer: {
      company_name: "Harbor Imports",
      account_owner: "Ananya Rao",
      region: "South",
      segment: "SMB",
      health_score: 65,
      mrr: "₹1.4L",
      renewal_date: "2026-08-12",
      status: "risk",
      next_step: "Collect missing compliance documents",
      last_touch: "Waiting on finance approval",
    },
    deal: {
      account_name: "Harbor Onboarding Package",
      contact_name: "Rhea Menon",
      owner_name: "Ananya Rao",
      region: "South",
      product: "Onboarding Services",
      stage: "demo",
      status: "submitted",
      quantity: 1,
      amount: "$5,600",
      amount_value: 5600,
      amount_usd: 5600,
      customer_budget: "$6,000",
      probability: 58,
      possible_close_date: "2026-08-05",
      close_date: "2026-08-07",
      source: "Partner referral",
      last_touch: "Submitted for review",
      notes: "Submitted partner account used for review screens.",
    },
  },
  {
    partner_id: makeUuid(4, 3),
    company_name: "Quantum Mesh Solutions",
    legal_name: "Quantum Mesh Solutions Private Limited",
    gst_number: "24AAACQ8888L1Z7",
    pan: "AAACQ8888L",
    cin: "U62012GJ2025PTC777777",
    website: "https://quantummesh.example.com",
    business_address: "42 Silicon Avenue, Ahmedabad, Gujarat",
    country: "India",
    state: "Gujarat",
    business_type: "Technology Services",
    years_in_business: 11,
    annual_turnover: "₹50 Cr - ₹100 Cr",
    employee_count: "250-500",
    business_focus: ["Cloud Migration", "Data Platforms", "Enterprise Services"],
    status: "partial_approval",
    tier: "platinum",
    admin: {
      id: makeUuid(2, 3),
      email: "quantum.admin@livey.tech",
      full_name: "Priya Deshmukh",
      phone: "+91 98765 43213",
      password: "Quantum-Admin-1!",
    },
    user: {
      id: makeUuid(3, 3),
      email: "quantum.user@livey.tech",
      full_name: "Rohit Kulkarni",
      phone: "+91 98765 43214",
      password: "Quantum-User-1!",
    },
    customer: {
      company_name: "Quantum Infrastructure",
      account_owner: "Priya Deshmukh",
      region: "West",
      segment: "Enterprise",
      health_score: 84,
      mrr: "₹3.6L",
      renewal_date: "2027-01-19",
      status: "healthy",
      next_step: "Finalize the rollout scope for finance",
      last_touch: "Technical review completed",
    },
    deal: {
      account_name: "Quantum Data Platform",
      contact_name: "Meera Joshi",
      owner_name: "Priya Deshmukh",
      region: "West",
      product: "Data Platform",
      stage: "proposal",
      status: "submitted",
      quantity: 2,
      amount: "$7,800",
      amount_value: 7800,
      amount_usd: 7800,
      customer_budget: "$8,000",
      probability: 64,
      possible_close_date: "2026-08-20",
      close_date: "2026-08-22",
      source: "Outbound",
      last_touch: "Queued for super admin approval",
      notes: "Requires explicit approval because the deal is above the threshold.",
    },
  },
  {
    partner_id: makeUuid(4, 4),
    company_name: "BluePeak Integrators",
    legal_name: "BluePeak Integrators Private Limited",
    gst_number: "29AABCB9999K1Z8",
    pan: "AABCB9999K",
    cin: "U72200KA2024PTC654987",
    website: "https://bluepeak.example.com",
    business_address: "9 Lakeview Plaza, Mysuru, Karnataka",
    country: "India",
    state: "Karnataka",
    business_type: "Systems Integration",
    years_in_business: 6,
    annual_turnover: "₹5 Cr - ₹10 Cr",
    employee_count: "25-50",
    business_focus: ["Implementation", "Device Rollout", "Training"],
    status: "pending_agreement",
    tier: "registered",
    admin: {
      id: makeUuid(2, 4),
      email: "bluepeak.admin@livey.tech",
      full_name: "Sneha Iyer",
      phone: "+91 98765 43216",
      password: "BluePeak-Admin-1!",
    },
    user: {
      id: makeUuid(3, 4),
      email: "bluepeak.user@livey.tech",
      full_name: "Omar Ali",
      phone: "+91 98765 43217",
      password: "BluePeak-User-1!",
    },
    customer: {
      company_name: "BluePeak Retail",
      account_owner: "Sneha Iyer",
      region: "South",
      segment: "Growth",
      health_score: 71,
      mrr: "₹1.9L",
      renewal_date: "2026-10-05",
      status: "watch",
      next_step: "Confirm procurement for the next phase",
      last_touch: "Customer success handoff completed",
    },
    deal: {
      account_name: "BluePeak Device Rollout",
      contact_name: "Sneha Iyer",
      owner_name: "Sneha Iyer",
      region: "South",
      product: "Rollout Services",
      stage: "negotiation",
      status: "submitted",
      quantity: 1,
      amount: "$4,900",
      amount_value: 4900,
      amount_usd: 4900,
      customer_budget: "$5,000",
      probability: 72,
      possible_close_date: "2026-08-14",
      close_date: "2026-08-16",
      source: "Partner referral",
      last_touch: "Agreement sent for signature",
      notes: "Useful for exercising the agreement-pending flow.",
    },
  },
  {
    partner_id: makeUuid(4, 5),
    company_name: "SummitFlow Commerce",
    legal_name: "SummitFlow Commerce Private Limited",
    gst_number: "27AAACS1111J1Z9",
    pan: "AAACS1111J",
    cin: "U51909MH2025PTC111222",
    website: "https://summitflow.example.com",
    business_address: "101 Trade Tower, Mumbai, Maharashtra",
    country: "India",
    state: "Maharashtra",
    business_type: "Commerce",
    years_in_business: 9,
    annual_turnover: "₹100 Cr+",
    employee_count: "500+",
    business_focus: ["Retail Expansion", "Digital Commerce", "Channel Sales"],
    status: "signed_pending_review",
    tier: "gold",
    admin: {
      id: makeUuid(2, 5),
      email: "summitflow.admin@livey.tech",
      full_name: "Vedant Kulkarni",
      phone: "+91 98765 43218",
      password: "SummitFlow-Admin-1!",
    },
    user: {
      id: makeUuid(3, 5),
      email: "summitflow.user@livey.tech",
      full_name: "Aarav Joshi",
      phone: "+91 98765 43219",
      password: "SummitFlow-User-1!",
    },
    customer: {
      company_name: "SummitFlow Retail",
      account_owner: "Vedant Kulkarni",
      region: "West",
      segment: "Enterprise",
      health_score: 88,
      mrr: "₹5.1L",
      renewal_date: "2027-03-02",
      status: "healthy",
      next_step: "Review the signed agreement and activate onboarding",
      last_touch: "Awaiting review signoff",
    },
    deal: {
      account_name: "SummitFlow Expansion",
      contact_name: "Anjali Nair",
      owner_name: "Vedant Kulkarni",
      region: "West",
      product: "Commerce Suite",
      stage: "won",
      status: "approved",
      quantity: 6,
      amount: "$9,500",
      amount_value: 9500,
      amount_usd: 9500,
      customer_budget: "$10,000",
      probability: 100,
      possible_close_date: "2026-07-30",
      close_date: "2026-07-30",
      source: "Expansion",
      last_touch: "Signed and ready for review",
      notes: "Provides a clean approved deal for the final partner account.",
    },
  },
];

export const PROD_DEMO_PROFILES: SeedProfile[] = [
  ...SUPER_ADMIN_PROFILES,
  ...PARTNER_GROUPS.flatMap((group) => [
    {
      ...group.admin,
      company_name: group.company_name,
      partner_id: group.partner_id,
      partner_status: group.status,
      roles: ["partner_admin"] as AppRole[],
    },
    {
      ...group.user,
      company_name: group.company_name,
      partner_id: group.partner_id,
      partner_status: group.status,
      roles: ["partner_user"] as AppRole[],
    },
  ]),
];

export const PROD_DEMO_USER_ROLES = PROD_DEMO_PROFILES.flatMap((profile) =>
  profile.roles.map((role) => ({
    user_id: profile.id,
    role,
    is_seed: true,
  })),
);

export const PROD_DEMO_PARTNERS = PARTNER_GROUPS.map((group) => ({
  id: group.partner_id,
  owner_user_id: group.admin.id,
  company_name: group.company_name,
  legal_name: group.legal_name,
  gst_number: group.gst_number,
  pan: group.pan,
  cin: group.cin,
  website: group.website,
  business_address: group.business_address,
  country: group.country,
  state: group.state,
  business_type: group.business_type,
  years_in_business: group.years_in_business,
  annual_turnover: group.annual_turnover,
  employee_count: group.employee_count,
  business_focus: group.business_focus,
  status: group.status,
  tier: group.tier,
  is_seed: true,
}));

export const PROD_DEMO_CUSTOMERS = PARTNER_GROUPS.map((group) => {
  const userId = group.user.id;
  return {
    id: makeUuid(5, Number(group.partner_id.slice(-1))),
    company_name: group.customer.company_name,
    account_owner: group.customer.account_owner,
    region: group.customer.region,
    segment: group.customer.segment,
    health_score: group.customer.health_score,
    mrr: group.customer.mrr,
    renewal_date: group.customer.renewal_date,
    status: group.customer.status,
    next_step: group.customer.next_step,
    last_touch: group.customer.last_touch,
    user_id: userId,
    partner_id: group.partner_id,
    is_seed: true,
  };
});

export const PROD_DEMO_DEALS = PARTNER_GROUPS.map((group) => {
  const ownerId = group.admin.id;
  const viewerId = group.user.id;
  return {
    id: makeUuid(6, Number(group.partner_id.slice(-1))),
    account_name: group.deal.account_name,
    customer_id: PROD_DEMO_CUSTOMERS.find((customer) => customer.partner_id === group.partner_id)
      ?.id,
    contact_name: group.deal.contact_name,
    poc_profile_id: viewerId,
    owner_name: group.deal.owner_name,
    country: "India",
    region: group.deal.region,
    product: group.deal.product,
    stage: group.deal.stage,
    status: group.deal.status,
    quantity: group.deal.quantity,
    amount: group.deal.amount,
    currency_code: "USD",
    amount_value: group.deal.amount_value,
    amount_usd: group.deal.amount_usd,
    fx_rate: 1,
    fx_provider: "manual",
    fx_rate_fetched_at: FIXTURE_TIMESTAMP,
    customer_budget: group.deal.customer_budget,
    probability: group.deal.probability,
    possible_close_date: group.deal.possible_close_date,
    close_date: group.deal.close_date,
    source: group.deal.source,
    last_touch: group.deal.last_touch,
    notes: group.deal.notes,
    user_id: ownerId,
    partner_id: group.partner_id,
    is_hidden_to_team: false,
    reward_rate_percent: 5,
    is_seed: true,
  };
});

export const PROD_DEMO_TEAM_MEMBERS = PARTNER_GROUPS.flatMap((group, index) => [
  {
    id: makeUuid(7, index * 2 + 1),
    company_name: group.company_name,
    full_name: group.admin.full_name,
    email: group.admin.email,
    role_title: "Partner Admin",
    portal_role: "partner_admin",
    responsibility: "Owns approvals and workspace governance",
    status: "active",
    last_active: "5 minutes ago",
    phone: group.admin.phone,
    permissions: ["deals", "documents", "team"],
    is_seed: true,
  },
  {
    id: makeUuid(7, index * 2 + 2),
    company_name: group.company_name,
    full_name: group.user.full_name,
    email: group.user.email,
    role_title: "Partner User",
    portal_role: "partner_user",
    responsibility: "Works the day-to-day account queue",
    status: "active",
    last_active: "18 minutes ago",
    phone: group.user.phone,
    permissions: ["documents"],
    is_seed: true,
  },
]);

export function buildProdDemoGovernanceSeedRows(input: {
  superAdminUserIds: string[];
  issuedAt?: string;
  expiresAt?: string;
  correlationId?: string;
}): GovernanceSeedRows {
  if (input.superAdminUserIds.length < 5) {
    throw new Error("Expected five super admin user IDs");
  }

  const base = buildGovernanceSeedRows({
    superAdminUserId: input.superAdminUserIds[0],
    issuedAt: input.issuedAt ?? FIXTURE_TIMESTAMP,
    expiresAt: input.expiresAt ?? "2026-07-30T08:00:00.000Z",
    correlationId: input.correlationId ?? "prod-demo-seed",
  });

  const assignments: AssignmentRecord[] = [...base.assignments];
  const activeContexts: ActiveContextRecord[] = [...base.activeContexts];
  const assignmentEvents = [...base.assignmentEvents];
  const issuedAt = input.issuedAt ?? FIXTURE_TIMESTAMP;
  const expiresAt = input.expiresAt ?? "2026-07-30T08:00:00.000Z";
  const approverUserId = input.superAdminUserIds[0];

  const allProfilesById = new Map(PROD_DEMO_PROFILES.map((profile) => [profile.id, profile]));

  const extraSuperAdmins = PROD_DEMO_PROFILES.filter((profile) =>
    profile.roles.includes("super_admin"),
  ).slice(1);
  extraSuperAdmins.forEach((profile, index) => {
    const assignmentId = `assignment-prod-super-admin-${index + 2}`;
    const assignment: AssignmentRecord = {
      assignmentId,
      userId: profile.id,
      tenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
      organizationTenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
      roleKey: "super_admin",
      teamDomain: "identity",
      geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
      partnerId: null,
      accountId: null,
      portfolioId: null,
      queueId: null,
      status: "active",
      validFrom: issuedAt,
      validTo: null,
      managerAssignmentId: null,
      source: "prod-demo-seed",
      approverUserId,
      predecessorAssignmentId: null,
      successorAssignmentId: null,
      revokedAt: null,
      revocationReason: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
      version: 1,
      isSeed: true,
    };
    assignments.push(assignment);
    activeContexts.push(
      issueActiveContextFromAssignment({
        assignment,
        issuedAt,
        expiresAt,
        correlationId: `prod-demo-super-admin-${index + 2}`,
        contextId: `context-prod-super-admin-${index + 2}`,
      }),
    );
    assignmentEvents.push({
      eventId: `assignment-event-prod-super-admin-${index + 2}`,
      assignmentId: assignment.assignmentId,
      actorUserId: approverUserId,
      actorAssignmentId: base.assignments[0]?.assignmentId ?? assignment.assignmentId,
      action: "assignment.bootstrap",
      reason: "Seeded demo super admin access",
      beforeState: null,
      afterState: {
        assignmentId: assignment.assignmentId,
        roleKey: assignment.roleKey,
        status: assignment.status,
      },
      effectiveAt: issuedAt,
      predecessorAssignmentId: null,
      successorAssignmentId: null,
      sessionRevocationResult: null,
      correlationId: `prod-demo-super-admin-${index + 2}`,
      createdAt: issuedAt,
    });
  });

  PARTNER_GROUPS.forEach((group, index) => {
    const adminProfile = allProfilesById.get(group.admin.id);
    const userProfile = allProfilesById.get(group.user.id);
    if (!adminProfile || !userProfile) {
      throw new Error(`Missing demo profiles for partner ${group.company_name}`);
    }

    const partnerAssignment = (
      profileId: string,
      roleKey: "partner_admin" | "partner_user",
      teamDomain: "partner_success" | "sales" | "support",
      suffix: string,
    ): AssignmentRecord => ({
      assignmentId: `assignment-prod-${suffix}-${index + 1}`,
      userId: profileId,
      tenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
      organizationTenantId: GOVERNANCE_TENANT_IDS.liveyOrganization,
      roleKey,
      teamDomain,
      geographyCeilingNodeId: GOVERNANCE_GEOGRAPHY_NODE_IDS.global,
      partnerId: group.partner_id,
      accountId: null,
      portfolioId: null,
      queueId: null,
      status: "active",
      validFrom: issuedAt,
      validTo: null,
      managerAssignmentId: null,
      source: "prod-demo-seed",
      approverUserId,
      predecessorAssignmentId: null,
      successorAssignmentId: null,
      revokedAt: null,
      revocationReason: null,
      createdAt: issuedAt,
      updatedAt: issuedAt,
      version: 1,
      isSeed: true,
    });

    const adminAssignment = partnerAssignment(
      group.admin.id,
      "partner_admin",
      "partner_success",
      "partner-admin",
    );
    const userAssignment = partnerAssignment(
      group.user.id,
      "partner_user",
      "support",
      "partner-user",
    );

    assignments.push(adminAssignment, userAssignment);
    activeContexts.push(
      issueActiveContextFromAssignment({
        assignment: adminAssignment,
        issuedAt,
        expiresAt,
        correlationId: `prod-demo-partner-admin-${index + 1}`,
        contextId: `context-prod-partner-admin-${index + 1}`,
      }),
      issueActiveContextFromAssignment({
        assignment: userAssignment,
        issuedAt,
        expiresAt,
        correlationId: `prod-demo-partner-user-${index + 1}`,
        contextId: `context-prod-partner-user-${index + 1}`,
      }),
    );
    assignmentEvents.push(
      {
        eventId: `assignment-event-prod-partner-admin-${index + 1}`,
        assignmentId: adminAssignment.assignmentId,
        actorUserId: approverUserId,
        actorAssignmentId: base.assignments[0]?.assignmentId ?? adminAssignment.assignmentId,
        action: "assignment.bootstrap",
        reason: `Seeded partner admin access for ${group.company_name}`,
        beforeState: null,
        afterState: {
          assignmentId: adminAssignment.assignmentId,
          roleKey: adminAssignment.roleKey,
          status: adminAssignment.status,
        },
        effectiveAt: issuedAt,
        predecessorAssignmentId: null,
        successorAssignmentId: null,
        sessionRevocationResult: null,
        correlationId: `prod-demo-partner-admin-${index + 1}`,
        createdAt: issuedAt,
      },
      {
        eventId: `assignment-event-prod-partner-user-${index + 1}`,
        assignmentId: userAssignment.assignmentId,
        actorUserId: approverUserId,
        actorAssignmentId: base.assignments[0]?.assignmentId ?? userAssignment.assignmentId,
        action: "assignment.bootstrap",
        reason: `Seeded partner user access for ${group.company_name}`,
        beforeState: null,
        afterState: {
          assignmentId: userAssignment.assignmentId,
          roleKey: userAssignment.roleKey,
          status: userAssignment.status,
        },
        effectiveAt: issuedAt,
        predecessorAssignmentId: null,
        successorAssignmentId: null,
        sessionRevocationResult: null,
        correlationId: `prod-demo-partner-user-${index + 1}`,
        createdAt: issuedAt,
      },
    );
  });

  return {
    ...base,
    assignments,
    activeContexts,
    assignmentEvents,
  };
}
