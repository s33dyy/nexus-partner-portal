import {
  buildImportValidationResult,
  type ImportValidationError,
  type ImportValidationResult,
  type TemplateColumnDefinition,
} from "@/lib/spreadsheet-import";
import { PARTNER_STATUSES, type PartnerStatus } from "@/lib/partner-status";
import type { AppRole } from "@/server/livey-service.server";

export const USER_IMPORT_TEMPLATE_COLUMNS = [
  { key: "full_name", header: "full_name" },
  { key: "email", header: "email" },
  { key: "phone", header: "phone" },
  { key: "company_name", header: "company_name" },
  { key: "password", header: "password" },
  { key: "role", header: "role" },
] as const satisfies readonly TemplateColumnDefinition[];

export const USER_IMPORT_TEMPLATE_SAMPLE = [
  {
    full_name: "Asha Mehta",
    email: "asha@example.com",
    phone: "+91 98765 43210",
    company_name: "Techilla",
    password: "TempPass123!",
    role: "partner_admin",
  },
];

const USER_IMPORT_ROLES = ["partner_admin", "partner_user"] as const satisfies readonly AppRole[];

export type ValidatedUserImportRow = {
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  password: string;
  role: (typeof USER_IMPORT_ROLES)[number];
  partner_status: PartnerStatus;
};

function normalizeString(value: unknown) {
  return String(value ?? "").trim();
}

function isImportRole(value: string): value is (typeof USER_IMPORT_ROLES)[number] {
  return USER_IMPORT_ROLES.includes(value as (typeof USER_IMPORT_ROLES)[number]);
}

function isPartnerStatus(value: string): value is PartnerStatus {
  return PARTNER_STATUSES.includes(value as PartnerStatus);
}

export function validateUserImportRows(
  rows: Array<Record<string, unknown>>,
): ImportValidationResult<ValidatedUserImportRow> {
  const normalizedRows: ValidatedUserImportRow[] = [];
  const errors: ImportValidationError[] = [];
  const duplicateEmails = new Set<string>();
  const emailCounts = new Map<string, number>();

  rows.forEach((row) => {
    const email = normalizeString(row.email).toLowerCase();
    if (!email) return;
    const nextCount = (emailCounts.get(email) ?? 0) + 1;
    emailCounts.set(email, nextCount);
    if (nextCount > 1) {
      duplicateEmails.add(email);
    }
  });

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const fullName = normalizeString(row.full_name);
    const email = normalizeString(row.email).toLowerCase();
    const phone = normalizeString(row.phone);
    const companyName = normalizeString(row.company_name);
    const password = normalizeString(row.password);
    const role = normalizeString(row.role);
    const partnerStatus =
      normalizeString(row.partner_status) ||
      (role === "partner_user" ? "approved" : "pending_partner_registration");
    const rowErrors: string[] = [];

    if (!fullName) rowErrors.push("full_name is required");
    if (!email) rowErrors.push("email is required");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email)) rowErrors.push("email must be valid");
    if (duplicateEmails.has(email)) rowErrors.push("email must be unique within the file");
    if (!password) rowErrors.push("password is required");
    if (password && password.length < 8) rowErrors.push("password must be at least 8 characters");
    if (!isImportRole(role)) rowErrors.push("role must be partner_admin or partner_user");
    if (!companyName) rowErrors.push("company_name is required");
    if (!isPartnerStatus(partnerStatus)) rowErrors.push("partner_status is invalid");

    if (rowErrors.length > 0) {
      errors.push({ rowNumber, messages: rowErrors });
      return;
    }

    const normalizedRole = role as (typeof USER_IMPORT_ROLES)[number];
    const normalizedPartnerStatus = partnerStatus as PartnerStatus;
    normalizedRows.push({
      full_name: fullName,
      email,
      phone,
      company_name: companyName || null,
      password,
      role: normalizedRole,
      partner_status: normalizedPartnerStatus,
    });
  });

  return buildImportValidationResult({ rows: normalizedRows, errors });
}
