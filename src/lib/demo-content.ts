export type DemoTone = "default" | "primary" | "success" | "warning" | "info";

export type DemoMetric = {
  id: string;
  label: string;
  value: string;
  hint: string;
  tone: DemoTone;
  sort_order: number;
  is_seed: boolean;
};

export type DemoFeedItem = {
  id: string;
  title: string;
  body: string;
  time_label: string;
  tone: DemoTone;
  sort_order: number;
  is_seed: boolean;
};

export type DemoPartnerSpotlight = {
  id: string;
  company_name: string;
  contact_name: string;
  region: string;
  tier: string;
  pipeline_value: string;
  last_activity: string;
  status: string;
  sort_order: number;
  is_seed: boolean;
};

export const DEMO_METRICS: DemoMetric[] = [
  {
    id: "a0000000-0000-4000-8000-000000000001",
    label: "Period revenue",
    value: "$148.2K",
    hint: "Up 18% vs last month",
    tone: "primary",
    sort_order: 1,
    is_seed: true,
  },
  {
    id: "a0000000-0000-4000-8000-000000000002",
    label: "Deals registered",
    value: "24",
    hint: "7 strategic, 17 standard",
    tone: "default",
    sort_order: 2,
    is_seed: true,
  },
  {
    id: "a0000000-0000-4000-8000-000000000003",
    label: "Win rate",
    value: "67%",
    hint: "16 wins from 24 deals",
    tone: "success",
    sort_order: 3,
    is_seed: true,
  },
  {
    id: "a0000000-0000-4000-8000-000000000004",
    label: "Pipeline value",
    value: "$1.9M",
    hint: "11 open opportunities",
    tone: "warning",
    sort_order: 4,
    is_seed: true,
  },
  {
    id: "a0000000-0000-4000-8000-000000000005",
    label: "Avg. deal size",
    value: "$18.4K",
    hint: "Healthy mid-market mix",
    tone: "default",
    sort_order: 5,
    is_seed: true,
  },
  {
    id: "a0000000-0000-4000-8000-000000000006",
    label: "Current tier mix",
    value: "Gold",
    hint: "3 partners are ready for Platinum",
    tone: "primary",
    sort_order: 6,
    is_seed: true,
  },
];

export const DEMO_FEED_ITEMS: DemoFeedItem[] = [
  {
    id: "b0000000-0000-4000-8000-000000000001",
    title: "Upgrade your video presence instantly",
    body: "LIVEY WC350 QHD Webcam - stunning 2K clarity, auto focus, low-light enhancement, dual mics, built-in privacy shutter, and a 360° swivel clip. Perfect for meetings and calls.",
    time_label: "Just now",
    tone: "primary",
    sort_order: 1,
    is_seed: true,
  },
  {
    id: "b0000000-0000-4000-8000-000000000002",
    title: "ACME Infra deal approved",
    body: "The $4,800 standard deal for ACME Infra has cleared partner review and is now waiting on LIVEY approval.",
    time_label: "14 min ago",
    tone: "success",
    sort_order: 2,
    is_seed: true,
  },
  {
    id: "b0000000-0000-4000-8000-000000000003",
    title: "Tier milestone reached",
    body: "North Star Systems crossed the Silver threshold after closing two deals this quarter. Margin benefits have been unlocked.",
    time_label: "1 hr ago",
    tone: "warning",
    sort_order: 3,
    is_seed: true,
  },
  {
    id: "b0000000-0000-4000-8000-000000000004",
    title: "Client lock reserved",
    body: "PartnerShield reserved Metro Health for a strategic opportunity. Discovery is now exclusively protected for 14 days.",
    time_label: "Today",
    tone: "info",
    sort_order: 4,
    is_seed: true,
  },
];

export const DEMO_PARTNER_SPOTLIGHTS: DemoPartnerSpotlight[] = [
  {
    id: "c0000000-0000-4000-8000-000000000001",
    company_name: "PartnerShield Technologies",
    contact_name: "Amit Verma",
    region: "India West",
    tier: "Gold",
    pipeline_value: "$420K",
    last_activity: "Moved to proposal",
    status: "Approved",
    sort_order: 1,
    is_seed: true,
  },
  {
    id: "c0000000-0000-4000-8000-000000000002",
    company_name: "North Star Systems",
    contact_name: "Priya Nair",
    region: "South India",
    tier: "Silver",
    pipeline_value: "$185K",
    last_activity: "Awaiting demo feedback",
    status: "Under review",
    sort_order: 2,
    is_seed: true,
  },
  {
    id: "c0000000-0000-4000-8000-000000000003",
    company_name: "Quantum Mesh Solutions",
    contact_name: "Rohit Kulkarni",
    region: "North India",
    tier: "Platinum",
    pipeline_value: "$760K",
    last_activity: "Won a strategic RFQ",
    status: "Won",
    sort_order: 3,
    is_seed: true,
  },
  {
    id: "c0000000-0000-4000-8000-000000000004",
    company_name: "BluePeak Integrators",
    contact_name: "Sneha Iyer",
    region: "West India",
    tier: "Registered",
    pipeline_value: "$64K",
    last_activity: "Submitted docs",
    status: "Submitted",
    sort_order: 4,
    is_seed: true,
  },
];
