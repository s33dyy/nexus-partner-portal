import {
  buildImportValidationResult,
  type ImportValidationError,
  type ImportValidationResult,
  type TemplateColumnDefinition,
} from "@/lib/spreadsheet-import";

export const TEAM_IMPORT_TEMPLATE_COLUMNS = [
  { key: "full_name", header: "full_name" },
  { key: "email", header: "email" },
  { key: "phone", header: "phone" },
  { key: "password", header: "password" },
  { key: "role_title", header: "role_title" },
  { key: "portal_role", header: "portal_role" },
  { key: "responsibility", header: "responsibility" },
] as const satisfies readonly TemplateColumnDefinition[];

export const TEAM_IMPORT_TEMPLATE_SAMPLE = [
  {
    full_name: "Rohan Singh",
    email: "rohan@example.com",
    phone: "+91 99887 77665",
    password: "TempPass123!",
    role_title: "Operations Manager",
    portal_role: "partner_user",
    responsibility: "Deals and customer follow-up",
  },
];

const TEAM_PORTAL_ROLES = ["partner_admin", "partner_user"] as const;
const TEAM_STATUSES = ["invited", "active", "paused"] as const;

export type ValidatedTeamImportRow = {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  role_title: string;
  portal_role: (typeof TEAM_PORTAL_ROLES)[number];
  responsibility: string;
  status: (typeof TEAM_STATUSES)[number];
};

function normalizeString(value: unknown) {
  return String(value ?? "").trim();
}

export function resolveTeamCompanyName(value: string | null | undefined) {
  const normalized = normalizeString(value);
  return normalized.length > 0 ? normalized : null;
}

function isPortalRole(value: string): value is (typeof TEAM_PORTAL_ROLES)[number] {
  return TEAM_PORTAL_ROLES.includes(value as (typeof TEAM_PORTAL_ROLES)[number]);
}

function isStatus(value: string): value is (typeof TEAM_STATUSES)[number] {
  return TEAM_STATUSES.includes(value as (typeof TEAM_STATUSES)[number]);
}

export function validateTeamImportRows(
  rows: Array<Record<string, unknown>>,
): ImportValidationResult<ValidatedTeamImportRow> {
  const normalizedRows: ValidatedTeamImportRow[] = [];
  const errors: ImportValidationError[] = [];
  const seenEmails = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const fullName = normalizeString(row.full_name);
    const email = normalizeString(row.email).toLowerCase();
    const phone = normalizeString(row.phone);
    const password = normalizeString(row.password);
    const roleTitle = normalizeString(row.role_title);
    const portalRole = normalizeString(row.portal_role);
    const responsibility = normalizeString(row.responsibility);
    const status = normalizeString(row.status) || "invited";
    const rowErrors: string[] = [];

    if (!fullName) rowErrors.push("full_name is required");
    if (!email) rowErrors.push("email is required");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email)) rowErrors.push("email must be valid");
    if (seenEmails.has(email)) rowErrors.push("email must be unique within the file");
    if (!password) rowErrors.push("password is required");
    if (password && password.length < 8) rowErrors.push("password must be at least 8 characters");
    if (!roleTitle) rowErrors.push("role_title is required");
    if (!isPortalRole(portalRole)) rowErrors.push("portal_role must be partner_admin or partner_user");
    if (!responsibility) rowErrors.push("responsibility is required");
    if (!isStatus(status)) rowErrors.push("status must be invited, active, or paused");

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, messages: rowErrors });
      return;
    }

    const normalizedPortalRole = portalRole as (typeof TEAM_PORTAL_ROLES)[number];
    const normalizedStatus = status as (typeof TEAM_STATUSES)[number];
    seenEmails.add(email);
    normalizedRows.push({
      full_name: fullName,
      email,
      phone,
      password,
      role_title: roleTitle,
      portal_role: normalizedPortalRole,
      responsibility,
      status: normalizedStatus,
    });
  });

  return buildImportValidationResult({ rows: normalizedRows, errors });
}
