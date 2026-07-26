import { TRAINING_ACCOUNTS } from "../../scripts/training-video-fixtures";

export type CaptureRole = "super_admin" | "partner_admin" | "partner_user";

export type CaptureAction =
  | "none"
  | "admin-partners-approved"
  | "reward-catalog-section"
  | "reward-request-dialog"
  | "admin-rewards-redemptions";

export type CaptureTarget = {
  id: string;
  role: CaptureRole;
  path: string;
  fileName: string;
  heading: string;
  action?: CaptureAction;
  waitMs?: number;
};

export const CAPTURE_ACCOUNTS = {
  super_admin: TRAINING_ACCOUNTS.superAdmin,
  partner_admin: TRAINING_ACCOUNTS.partnerAdmin,
  partner_user: TRAINING_ACCOUNTS.partnerUser,
} as const;

export const CAPTURE_TARGETS: CaptureTarget[] = [
  {
    id: "super-admin-dashboard",
    role: "super_admin",
    path: "/dashboard",
    fileName: "super-admin/dashboard.png",
    heading: "Dashboard",
  },
  {
    id: "super-admin-partners-submitted",
    role: "super_admin",
    path: "/admin/partners",
    fileName: "super-admin/partners-submitted.png",
    heading: "Partner approvals",
    waitMs: 500,
  },
  {
    id: "super-admin-partners-approved",
    role: "super_admin",
    path: "/admin/partners",
    fileName: "super-admin/partners-approved.png",
    heading: "Partner approvals",
    action: "admin-partners-approved",
    waitMs: 500,
  },
  {
    id: "super-admin-deals",
    role: "super_admin",
    path: "/admin/deals",
    fileName: "super-admin/deals.png",
    heading: "Deal approvals",
  },
  {
    id: "super-admin-users",
    role: "super_admin",
    path: "/admin/users",
    fileName: "super-admin/users.png",
    heading: "Users & roles",
  },
  {
    id: "super-admin-catalog",
    role: "super_admin",
    path: "/admin/catalog",
    fileName: "super-admin/catalog.png",
    heading: "Tiers & products",
  },
  {
    id: "super-admin-rewards",
    role: "super_admin",
    path: "/admin/rewards",
    fileName: "super-admin/rewards.png",
    heading: "Rewards",
  },
  {
    id: "super-admin-news",
    role: "super_admin",
    path: "/admin/news",
    fileName: "super-admin/news.png",
    heading: "News feed",
  },
  {
    id: "super-admin-audit",
    role: "super_admin",
    path: "/admin/audit",
    fileName: "super-admin/audit.png",
    heading: "Audit logs",
  },
  {
    id: "partner-admin-onboarding",
    role: "partner_admin",
    path: "/partner/onboarding",
    fileName: "partner-admin/onboarding.png",
    heading: "Partner onboarding",
  },
  {
    id: "partner-admin-dashboard",
    role: "partner_admin",
    path: "/dashboard",
    fileName: "partner-admin/dashboard.png",
    heading: "Dashboard",
  },
  {
    id: "partner-admin-team",
    role: "partner_admin",
    path: "/partner/team",
    fileName: "partner-admin/team.png",
    heading: "Team",
  },
  {
    id: "partner-admin-deals",
    role: "partner_admin",
    path: "/deals",
    fileName: "partner-admin/deals.png",
    heading: "Deals",
  },
  {
    id: "partner-admin-customers",
    role: "partner_admin",
    path: "/customers",
    fileName: "partner-admin/customers.png",
    heading: "Customers",
  },
  {
    id: "partner-admin-documents",
    role: "partner_admin",
    path: "/documents",
    fileName: "partner-admin/documents.png",
    heading: "Documents",
  },
  {
    id: "partner-admin-analytics",
    role: "partner_admin",
    path: "/analytics",
    fileName: "partner-admin/analytics.png",
    heading: "Analytics",
  },
  {
    id: "partner-user-dashboard",
    role: "partner_user",
    path: "/dashboard",
    fileName: "partner-user/dashboard.png",
    heading: "Dashboard",
  },
  {
    id: "partner-user-deals",
    role: "partner_user",
    path: "/deals",
    fileName: "partner-user/deals.png",
    heading: "Deals",
  },
  {
    id: "partner-user-pipeline",
    role: "partner_user",
    path: "/pipeline",
    fileName: "partner-user/pipeline.png",
    heading: "Pipeline",
  },
  {
    id: "partner-user-customers",
    role: "partner_user",
    path: "/customers",
    fileName: "partner-user/customers.png",
    heading: "Customers",
  },
  {
    id: "partner-user-analytics",
    role: "partner_user",
    path: "/analytics",
    fileName: "partner-user/analytics.png",
    heading: "Analytics",
  },
  {
    id: "partner-user-documents",
    role: "partner_user",
    path: "/documents",
    fileName: "partner-user/documents.png",
    heading: "Documents",
  },
  {
    id: "partner-user-rewards",
    role: "partner_user",
    path: "/rewards",
    fileName: "partner-user/rewards.png",
    heading: "Rewards",
  },
  {
    id: "rewards-catalog",
    role: "partner_user",
    path: "/rewards",
    fileName: "rewards/catalog.png",
    heading: "Rewards",
    action: "reward-catalog-section",
  },
  {
    id: "rewards-redemption-request",
    role: "partner_user",
    path: "/rewards",
    fileName: "rewards/redemption-request.png",
    heading: "Request redemption",
    action: "reward-request-dialog",
    waitMs: 500,
  },
  {
    id: "rewards-admin-rewards",
    role: "super_admin",
    path: "/admin/rewards",
    fileName: "rewards/admin-rewards.png",
    heading: "Rewards",
    action: "admin-rewards-redemptions",
    waitMs: 500,
  },
] as const;
