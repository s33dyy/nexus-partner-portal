export const TRAINING_ACCOUNTS = {
  superAdmin: {
    email: "admin@livey.tech",
    password: process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD ?? "LIVEY-Admin-2026!",
  },
  partnerAdmin: {
    email: "northstar.admin@livey.tech",
    password: "Northstar-Admin-2026!",
  },
  partnerUser: {
    email: "northstar.user@livey.tech",
    password: "Northstar-User-2026!",
  },
} as const;

export const TRAINING_VIDEO_APPROVAL_THRESHOLD = 5000;

export const TRAINING_PROFILE_IDS = {
  superAdmin: "11111111-1111-4111-8111-111111111111",
  partnerAdmin: "22222222-2222-4222-8222-222222222222",
  partnerUser: "33333333-3333-4333-8333-333333333333",
  submittedPartnerOwner: "44444444-4444-4444-8444-444444444444",
} as const;

export const TRAINING_PARTNER_IDS = {
  approved: "55555555-5555-4555-8555-555555555555",
  submitted: "66666666-6666-4666-8666-666666666666",
} as const;

export const TRAINING_DEAL_IDS = {
  underThreshold: "77777777-7777-4777-8777-777777777777",
  overThreshold: "88888888-8888-4888-8888-888888888888",
  submittedPartner: "99999999-9999-4999-8999-999999999999",
} as const;

export const TRAINING_CUSTOMER_IDS = {
  northstarEnterprise: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  northstarGrowth: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  harborImport: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;

export const TRAINING_TEAM_MEMBER_IDS = {
  opsLead: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  salesLead: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  accountManager: "ffffffff-ffff-4fff-8fff-ffffffffffff",
} as const;

export const TRAINING_REWARD_IDS = {
  headset: "12121212-1212-4212-8212-121212121212",
  travel: "13131313-1313-4313-8313-131313131313",
} as const;

export const TRAINING_REDEMPTION_IDS = {
  headsetRequest: "14141414-1414-4414-8414-141414141414",
} as const;

export const TRAINING_NEWS_POST_IDS = {
  partnerApproved: "15151515-1515-4515-8515-151515151515",
  pipelineMilestone: "16161616-1616-4616-8616-161616161616",
  rewardsLaunch: "17171717-1717-4717-8717-171717171717",
} as const;

export const TRAINING_AUDIT_EVENT_IDS = {
  partnerApproved: "18181818-1818-4818-8818-181818181818",
  dealCreated: "19191919-1919-4919-8919-191919191919",
  redemptionRequested: "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
} as const;

export const TRAINING_PARTNERS = {
  approved: {
    id: TRAINING_PARTNER_IDS.approved,
    owner_user_id: TRAINING_PROFILE_IDS.partnerAdmin,
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
    is_seed: true,
  },
  submitted: {
    id: TRAINING_PARTNER_IDS.submitted,
    owner_user_id: TRAINING_PROFILE_IDS.submittedPartnerOwner,
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
    status: "submitted",
    tier: "registered",
    is_seed: true,
  },
} as const;

export const TRAINING_PROFILES = [
  {
    id: TRAINING_PROFILE_IDS.superAdmin,
    email: TRAINING_ACCOUNTS.superAdmin.email,
    password: TRAINING_ACCOUNTS.superAdmin.password,
    full_name: "LIVEY Super Admin",
    phone: null,
    company_name: "LIVEY Technologies",
    partner_id: null,
    partner_status: "approved",
    is_seed: true,
  },
  {
    id: TRAINING_PROFILE_IDS.partnerAdmin,
    email: TRAINING_ACCOUNTS.partnerAdmin.email,
    password: TRAINING_ACCOUNTS.partnerAdmin.password,
    full_name: "Maya Chen",
    phone: "+91 98765 43210",
    company_name: "Northstar Systems",
    partner_id: TRAINING_PARTNER_IDS.approved,
    partner_status: "approved",
    is_seed: true,
  },
  {
    id: TRAINING_PROFILE_IDS.partnerUser,
    email: TRAINING_ACCOUNTS.partnerUser.email,
    password: TRAINING_ACCOUNTS.partnerUser.password,
    full_name: "Noah Patel",
    phone: "+91 98765 43211",
    company_name: "Northstar Systems",
    partner_id: TRAINING_PARTNER_IDS.approved,
    partner_status: "approved",
    is_seed: true,
  },
  {
    id: TRAINING_PROFILE_IDS.submittedPartnerOwner,
    email: "harbor.admin@livey.tech",
    password: "Harbor-Admin-2026!",
    full_name: "Ananya Rao",
    phone: "+91 98765 43212",
    company_name: "Harbor Logistics",
    partner_id: TRAINING_PARTNER_IDS.submitted,
    partner_status: "submitted",
    is_seed: true,
  },
] as const;

export const TRAINING_USER_ROLES = [
  { user_id: TRAINING_PROFILE_IDS.superAdmin, role: "super_admin", is_seed: true },
  { user_id: TRAINING_PROFILE_IDS.partnerAdmin, role: "partner_admin", is_seed: true },
  { user_id: TRAINING_PROFILE_IDS.partnerUser, role: "partner_user", is_seed: true },
  { user_id: TRAINING_PROFILE_IDS.submittedPartnerOwner, role: "partner_admin", is_seed: true },
] as const;

export const TRAINING_USER_ROLE_IDS = {
  superAdmin: "21212121-2121-4212-8212-212121212121",
  partnerAdmin: "31313131-3131-4313-8313-313131313131",
  partnerUser: "41414141-4141-4414-8414-414141414141",
  submittedPartnerOwner: "51515151-5151-4515-8515-515151515151",
} as const;

export const TRAINING_PARTNER_DOCUMENTS = [
  {
    id: "22222222-2222-5222-8222-222222222222",
    partner_id: TRAINING_PARTNER_IDS.approved,
    uploaded_by: TRAINING_PROFILE_IDS.partnerAdmin,
    doc_type: "gst_certificate",
    file_name: "GST Certificate.pdf",
    file_path: `${TRAINING_PARTNER_IDS.approved}/gst-certificate.pdf`,
    mime_type: "application/pdf",
    size_bytes: 0,
    is_seed: true,
  },
  {
    id: "33333333-3333-5333-8333-333333333333",
    partner_id: TRAINING_PARTNER_IDS.submitted,
    uploaded_by: TRAINING_PROFILE_IDS.submittedPartnerOwner,
    doc_type: "gst_certificate",
    file_name: "GST Certificate.pdf",
    file_path: `${TRAINING_PARTNER_IDS.submitted}/gst-certificate.pdf`,
    mime_type: "application/pdf",
    size_bytes: 0,
    is_seed: true,
  },
] as const;

export const TRAINING_CUSTOMERS = [
  {
    id: TRAINING_CUSTOMER_IDS.northstarEnterprise,
    company_name: "Northstar Retail Pvt Ltd",
    account_owner: "Maya Chen",
    region: "West",
    segment: "Enterprise",
    health_score: 92,
    mrr: "₹4.2L",
    renewal_date: "2026-12-18",
    status: "healthy",
    next_step: "Expand the rollout to the APAC support team",
    last_touch: "Reviewed in weekly QBR",
    user_id: TRAINING_PROFILE_IDS.partnerAdmin,
    partner_id: TRAINING_PARTNER_IDS.approved,
    is_seed: true,
  },
  {
    id: TRAINING_CUSTOMER_IDS.northstarGrowth,
    company_name: "Northstar Mobility",
    account_owner: "Noah Patel",
    region: "South",
    segment: "Growth",
    health_score: 78,
    mrr: "₹2.1L",
    renewal_date: "2026-10-05",
    status: "watch",
    next_step: "Confirm procurement for the next phase",
    last_touch: "Customer success handoff completed",
    user_id: TRAINING_PROFILE_IDS.partnerUser,
    partner_id: TRAINING_PARTNER_IDS.approved,
    is_seed: true,
  },
  {
    id: TRAINING_CUSTOMER_IDS.harborImport,
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
    user_id: TRAINING_PROFILE_IDS.submittedPartnerOwner,
    partner_id: TRAINING_PARTNER_IDS.submitted,
    is_seed: true,
  },
] as const;

export const TRAINING_DEALS = [
  {
    id: TRAINING_DEAL_IDS.underThreshold,
    account_name: "Northstar Cloud Suite",
    customer_id: TRAINING_CUSTOMER_IDS.northstarEnterprise,
    contact_name: "Priya Nair",
    poc_profile_id: TRAINING_PROFILE_IDS.partnerAdmin,
    owner_name: "Maya Chen",
    country: "India",
    region: "West",
    product: "Cloud Suite",
    stage: "approved",
    status: "approved",
    quantity: 4,
    amount: "$4,250",
    customer_budget: "$4,500",
    probability: 100,
    possible_close_date: "2026-07-29",
    close_date: "2026-07-28",
    source: "Referral",
    last_touch: "Auto-approved after review",
    notes: "Low-risk expansion opportunity for the Northstar account.",
    user_id: TRAINING_PROFILE_IDS.partnerAdmin,
    partner_id: TRAINING_PARTNER_IDS.approved,
    is_seed: true,
  },
  {
    id: TRAINING_DEAL_IDS.overThreshold,
    account_name: "Northstar Security Expansion",
    customer_id: TRAINING_CUSTOMER_IDS.northstarGrowth,
    contact_name: "Amit Shah",
    poc_profile_id: TRAINING_PROFILE_IDS.partnerUser,
    owner_name: "Noah Patel",
    country: "India",
    region: "South",
    product: "Security Bundle",
    stage: "proposal",
    status: "submitted",
    quantity: 2,
    amount: "$7,800",
    customer_budget: "$8,000",
    probability: 64,
    possible_close_date: "2026-08-20",
    close_date: "2026-08-22",
    source: "Outbound",
    last_touch: "Queued for super admin approval",
    notes: "Requires explicit approval because the deal is above the threshold.",
    user_id: TRAINING_PROFILE_IDS.partnerUser,
    partner_id: TRAINING_PARTNER_IDS.approved,
    is_seed: true,
  },
  {
    id: TRAINING_DEAL_IDS.submittedPartner,
    account_name: "Harbor Onboarding Package",
    customer_id: TRAINING_CUSTOMER_IDS.harborImport,
    contact_name: "Rhea Menon",
    poc_profile_id: TRAINING_PROFILE_IDS.submittedPartnerOwner,
    owner_name: "Ananya Rao",
    country: "India",
    region: "South",
    product: "Onboarding Services",
    stage: "demo",
    status: "submitted",
    quantity: 1,
    amount: "$5,600",
    customer_budget: "$6,000",
    probability: 58,
    possible_close_date: "2026-08-05",
    close_date: "2026-08-07",
    source: "Partner referral",
    last_touch: "Submitted for review",
    notes: "Submitted partner account used for review screens.",
    user_id: TRAINING_PROFILE_IDS.submittedPartnerOwner,
    partner_id: TRAINING_PARTNER_IDS.submitted,
    is_seed: true,
  },
] as const;

export const TRAINING_TEAM_MEMBERS = [
  {
    id: TRAINING_TEAM_MEMBER_IDS.opsLead,
    company_name: "Northstar Systems",
    full_name: "Maya Chen",
    email: TRAINING_ACCOUNTS.partnerAdmin.email,
    role_title: "Operations Lead",
    portal_role: "partner_admin",
    responsibility: "Owns the partner workspace and approvals",
    status: "active",
    last_active: "2 hours ago",
    phone: "+91 98765 43210",
    permissions: ["deals", "documents", "team"],
    is_seed: true,
  },
  {
    id: TRAINING_TEAM_MEMBER_IDS.salesLead,
    company_name: "Northstar Systems",
    full_name: "Noah Patel",
    email: TRAINING_ACCOUNTS.partnerUser.email,
    role_title: "Sales Lead",
    portal_role: "partner_user",
    responsibility: "Manages active opportunities and customer follow-ups",
    status: "active",
    last_active: "18 minutes ago",
    phone: "+91 98765 43211",
    permissions: ["documents"],
    is_seed: true,
  },
  {
    id: TRAINING_TEAM_MEMBER_IDS.accountManager,
    company_name: "Northstar Systems",
    full_name: "Isha Verma",
    email: "isha.verma@northstar.example.com",
    role_title: "Account Manager",
    portal_role: "partner_user",
    responsibility: "Keeps onboarding paperwork moving",
    status: "paused",
    last_active: "Yesterday",
    phone: "+91 98765 43213",
    permissions: ["documents"],
    is_seed: true,
  },
] as const;

export const TRAINING_REWARD_CATALOG_ITEMS = [
  {
    id: TRAINING_REWARD_IDS.headset,
    title: "LIVEY Noise-Canceling Headset",
    description: "A premium headset for partner teams that close deals consistently.",
    image_path: "/rewards/livey-headset.png",
    category: "Merchandise",
    points_cost: 500,
    stock: 12,
    availability: "available",
    is_seed: true,
  },
  {
    id: TRAINING_REWARD_IDS.travel,
    title: "Executive Travel Voucher",
    description: "A higher-value reward reserved for top-performing partners.",
    image_path: "/rewards/livey-travel-voucher.png",
    category: "Experience",
    points_cost: 1200,
    stock: 4,
    availability: "available",
    is_seed: true,
  },
] as const;

export const TRAINING_REWARD_POINT_EVENTS = [
  {
    id: "32323232-3232-4232-8232-323232323232",
    user_id: TRAINING_PROFILE_IDS.partnerUser,
    partner_id: TRAINING_PARTNER_IDS.approved,
    source_type: "deal_win",
    source_id: TRAINING_DEAL_IDS.underThreshold,
    points_delta: 500,
    reason: "Northstar Cloud Suite closed won",
    approved_by: TRAINING_PROFILE_IDS.superAdmin,
    approved_at: "2026-07-20T09:00:00.000Z",
    is_seed: true,
  },
  {
    id: "42424242-4242-4242-8242-424242424242",
    user_id: TRAINING_PROFILE_IDS.partnerUser,
    partner_id: TRAINING_PARTNER_IDS.approved,
    source_type: "manual_adjustment",
    source_id: null,
    points_delta: 250,
    reason: "Training bonus for completing the onboarding workflow",
    approved_by: TRAINING_PROFILE_IDS.superAdmin,
    approved_at: "2026-07-20T09:30:00.000Z",
    is_seed: true,
  },
] as const;

export const TRAINING_REWARD_REDEMPTIONS = [
  {
    id: TRAINING_REDEMPTION_IDS.headsetRequest,
    reward_id: TRAINING_REWARD_IDS.headset,
    user_id: TRAINING_PROFILE_IDS.partnerUser,
    partner_id: TRAINING_PARTNER_IDS.approved,
    points_cost: 500,
    status: "requested",
    shipping_name: "Noah Patel",
    shipping_address: "Northstar Systems, Pune, Maharashtra",
    notes: "Please ship to the main office after approval.",
    approved_by: null,
    approved_at: null,
    is_seed: true,
  },
] as const;

export const TRAINING_NEWS_POSTS = [
  {
    id: TRAINING_NEWS_POST_IDS.partnerApproved,
    title: "Northstar Systems approved for the LIVEY partner portal",
    caption: "The approved training partner now has full access to the partner dashboard.",
    image_path: "/news/livey-wc350-qhd.png",
    image_alt: "LIVEY partner approval banner",
    posted_by_name: "LIVEY Super Admin",
    posted_by_role: "super_admin",
    is_seed: true,
  },
  {
    id: TRAINING_NEWS_POST_IDS.pipelineMilestone,
    title: "Northstar Cloud Suite cleared the approval threshold",
    caption: "The training dataset includes a deal that is both under and over the approval line.",
    image_path: "/news/livey-wc350-qhd.png",
    image_alt: "Pipeline milestone banner",
    posted_by_name: "LIVEY Super Admin",
    posted_by_role: "super_admin",
    is_seed: true,
  },
  {
    id: TRAINING_NEWS_POST_IDS.rewardsLaunch,
    title: "Reward catalog and redemption requests are now seeded",
    caption: "Partner users can browse rewards, request redemptions, and review point activity.",
    image_path: "/news/livey-wc350-qhd.png",
    image_alt: "Rewards banner",
    posted_by_name: "LIVEY Super Admin",
    posted_by_role: "super_admin",
    is_seed: true,
  },
] as const;

export const TRAINING_AUDIT_EVENTS = [
  {
    id: TRAINING_AUDIT_EVENT_IDS.partnerApproved,
    actor_name: "LIVEY Super Admin",
    actor_role: "super_admin",
    action: "partner_approved",
    target_type: "partner",
    target_name: TRAINING_PARTNERS.approved.company_name,
    outcome: "approved",
    details: "Approved Northstar Systems after reviewing the submitted training record.",
    severity: "medium",
    is_seed: true,
  },
  {
    id: TRAINING_AUDIT_EVENT_IDS.dealCreated,
    actor_name: "Maya Chen",
    actor_role: "partner_admin",
    action: "deal_created",
    target_type: "deal",
    target_name: "Northstar Security Expansion",
    outcome: "submitted",
    details: "Created a deal above the approval threshold for admin review.",
    severity: "low",
    is_seed: true,
  },
  {
    id: TRAINING_AUDIT_EVENT_IDS.redemptionRequested,
    actor_name: "Noah Patel",
    actor_role: "partner_user",
    action: "reward_redemption_request",
    target_type: "reward",
    target_name: "LIVEY Noise-Canceling Headset",
    outcome: "requested",
    details: "Requested a training redemption from the seeded reward catalog.",
    severity: "low",
    is_seed: true,
  },
] as const;

export type TrainingCountAssertion = {
  key: string;
  label: string;
  sql: string;
  params?: ReadonlyArray<unknown>;
  min: number;
};

export const TRAINING_VIDEO_ASSERTIONS: TrainingCountAssertion[] = [
  {
    key: "profiles",
    label: "seed profiles",
    sql: `SELECT count(*)::int AS count FROM profiles WHERE is_seed = true`,
    min: 4,
  },
  {
    key: "user_roles",
    label: "seed roles",
    sql: `SELECT count(*)::int AS count FROM user_roles WHERE is_seed = true`,
    min: 4,
  },
  {
    key: "partners-submitted",
    label: "submitted partners",
    sql: `SELECT count(*)::int AS count FROM partners WHERE is_seed = true AND status = 'submitted'`,
    min: 1,
  },
  {
    key: "partners-approved",
    label: "approved partners",
    sql: `SELECT count(*)::int AS count FROM partners WHERE is_seed = true AND status = 'approved'`,
    min: 1,
  },
  {
    key: "deals-below-threshold",
    label: "deals below the approval threshold",
    sql: `SELECT count(*)::int AS count FROM portal_deals
          WHERE is_seed = true
            AND replace(replace(amount, '$', ''), ',', '')::numeric < $1`,
    params: [TRAINING_VIDEO_APPROVAL_THRESHOLD],
    min: 1,
  },
  {
    key: "deals-above-threshold",
    label: "deals at or above the approval threshold",
    sql: `SELECT count(*)::int AS count FROM portal_deals
          WHERE is_seed = true
            AND replace(replace(amount, '$', ''), ',', '')::numeric >= $1`,
    params: [TRAINING_VIDEO_APPROVAL_THRESHOLD],
    min: 1,
  },
  {
    key: "customers",
    label: "customer rows",
    sql: `SELECT count(*)::int AS count FROM portal_customers WHERE is_seed = true`,
    min: 3,
  },
  {
    key: "team-members",
    label: "portal team members",
    sql: `SELECT count(*)::int AS count FROM portal_team_members WHERE is_seed = true`,
    min: 3,
  },
  {
    key: "reward-catalog",
    label: "reward catalog items",
    sql: `SELECT count(*)::int AS count FROM reward_catalog_items WHERE is_seed = true`,
    min: 2,
  },
  {
    key: "redemptions",
    label: "requested redemptions",
    sql: `SELECT count(*)::int AS count FROM reward_redemptions WHERE is_seed = true AND status = 'requested'`,
    min: 1,
  },
  {
    key: "news",
    label: "news feed rows",
    sql: `SELECT count(*)::int AS count FROM portal_news_posts WHERE is_seed = true`,
    min: 3,
  },
  {
    key: "audit",
    label: "audit events",
    sql: `SELECT count(*)::int AS count FROM portal_audit_events WHERE is_seed = true`,
    min: 3,
  },
  {
    key: "document-blobs",
    label: "previewable document blobs",
    sql: `SELECT count(*)::int AS count FROM document_blobs WHERE is_seed = true`,
    min: 2,
  },
  {
    key: "partner-documents",
    label: "partner document rows",
    sql: `SELECT count(*)::int AS count FROM partner_documents WHERE is_seed = true`,
    min: 2,
  },
];
