import { expect, test } from "bun:test";

import {
  validateCustomerImportRows,
  CUSTOMER_IMPORT_TEMPLATE_COLUMNS,
} from "@/lib/customer-import";
import { buildCsv } from "@/lib/csv-export";
import { DEAL_IMPORT_TEMPLATE_COLUMNS, DEAL_IMPORT_TEMPLATE_SAMPLE, validateDealImportRows } from "@/lib/deal-import";
import { validateImportTemplate } from "@/lib/spreadsheet-import";
import { REWARD_CATALOG_IMPORT_TEMPLATE_COLUMNS as REWARD_TEMPLATE_COLUMNS } from "@/lib/reward-admin";
import {
  resolveTeamCompanyName,
  TEAM_IMPORT_TEMPLATE_COLUMNS,
  validateTeamImportRows,
} from "@/lib/team-import";
import { USER_IMPORT_TEMPLATE_COLUMNS, validateUserImportRows } from "@/lib/user-import";
import { parseSpreadsheetFile } from "@/lib/spreadsheet-import";

test("validateUserImportRows normalizes valid rows and keeps template columns stable", () => {
  const result = validateUserImportRows([
    {
      full_name: " Asha Mehta ",
      email: " ASHA@example.com ",
      phone: " +91 98765 43210 ",
      company_name: " Techilla ",
      password: "TempPass123!",
      role: "partner_admin",
    },
  ]);

  expect(USER_IMPORT_TEMPLATE_COLUMNS.map((column) => column.key)).toEqual([
    "full_name",
    "email",
    "phone",
    "company_name",
    "password",
    "role",
  ]);
  expect(result.errors).toEqual([]);
  expect(result.rows).toEqual([
    {
      full_name: "Asha Mehta",
      email: "asha@example.com",
      phone: "+91 98765 43210",
      company_name: "Techilla",
      password: "TempPass123!",
      role: "partner_admin",
      partner_status: "pending_partner_registration",
    },
  ]);
});

test("validateUserImportRows rejects duplicates and weak rows without partial success", () => {
  const result = validateUserImportRows([
    {
      full_name: "",
      email: "asha@example.com",
      phone: "",
      company_name: "",
      password: "short",
      role: "partner_admin",
      partner_status: "approved",
    },
    {
      full_name: "Asha",
      email: "asha@example.com",
      phone: "",
      company_name: "Techilla",
      password: "TempPass123!",
      role: "partner_user",
      partner_status: "approved",
    },
  ]);

  expect(result.successCount).toBe(0);
  expect(result.rows).toEqual([]);
  expect(result.errors).toHaveLength(2);
});

test("validateCustomerImportRows normalizes valid rows and keeps template columns stable", () => {
  const result = validateCustomerImportRows([
    {
      company_name: " Acme Infra ",
      account_owner: " Asha Mehta ",
      region: " India West ",
      segment: " Mid-market ",
      health_score: "75",
      mrr: " $5K ",
      renewal_date: "2026-09-15",
      status: " active ",
      next_step: " Schedule QBR ",
    },
  ]);

  expect(CUSTOMER_IMPORT_TEMPLATE_COLUMNS.map((column) => column.key)).toEqual([
    "company_name",
    "account_owner",
    "region",
    "segment",
    "health_score",
    "mrr",
    "renewal_date",
    "status",
    "next_step",
  ]);
  expect(result.errors).toEqual([]);
  expect(result.rows[0]).toEqual({
    company_name: "Acme Infra",
    account_owner: "Asha Mehta",
    region: "India West",
    segment: "Mid-market",
    health_score: 75,
    mrr: "$5K",
    renewal_date: "2026-09-15",
    status: "active",
    next_step: "Schedule QBR",
    last_touch: "Today",
  });
});

test("validateTeamImportRows rejects invalid rows without partial success", () => {
  const result = validateTeamImportRows([
    {
      full_name: "Rohan Singh",
      email: "rohan@example.com",
      phone: "",
      password: "TempPass123!",
      role_title: "Ops Manager",
      portal_role: "partner_user",
      responsibility: "Deals",
    },
    {
      full_name: "",
      email: "bad-email",
      phone: "",
      password: "123",
      role_title: "",
      portal_role: "invalid",
      responsibility: "",
      status: "invalid",
    },
  ]);

  expect(TEAM_IMPORT_TEMPLATE_COLUMNS.map((column) => column.key)).toEqual([
    "full_name",
    "email",
    "phone",
    "password",
    "role_title",
    "portal_role",
    "responsibility",
  ]);
  expect(result.successCount).toBe(0);
  expect(result.rows).toEqual([]);
  expect(result.errors).toHaveLength(1);
});

test("validateImportTemplate rejects files missing required template columns", () => {
  expect(
    validateImportTemplate(
      {
        headers: ["full_name", "email"],
        rows: [{ full_name: "Asha Mehta", email: "asha@example.com" }],
      },
      USER_IMPORT_TEMPLATE_COLUMNS,
    ),
  ).toEqual([
    {
      rowNumber: 1,
      messages: ["Missing required columns: phone, company_name, password, role"],
    },
  ]);

  expect(
    validateImportTemplate(
      {
        headers: ["company_name", "account_owner", "region", "segment"],
        rows: [{ company_name: "Acme Infra", account_owner: "Asha Mehta" }],
      },
      CUSTOMER_IMPORT_TEMPLATE_COLUMNS,
    ),
  ).toEqual([
    {
      rowNumber: 1,
      messages: ["Missing required columns: health_score, mrr, renewal_date, status, next_step"],
    },
  ]);

  expect(
    validateImportTemplate(
      {
        headers: ["title", "description"],
        rows: [{ title: "LIVEY Hoodie", description: "Warm merch" }],
      },
      REWARD_TEMPLATE_COLUMNS,
    ),
  ).toEqual([
    {
      rowNumber: 1,
      messages: ["Missing required columns: Image Path, Category, Points Cost, Stock, Availability"],
    },
  ]);
});

test("validateImportTemplate rejects empty imports even when template headers are present", () => {
  expect(
    validateImportTemplate(
      {
        headers: TEAM_IMPORT_TEMPLATE_COLUMNS.map((column) => column.header),
        rows: [],
      },
      TEAM_IMPORT_TEMPLATE_COLUMNS,
    ),
  ).toEqual([
    {
      rowNumber: 2,
      messages: ["Add at least one data row before importing this file."],
    },
  ]);
});

test("deal template CSV round-trips through the spreadsheet parser", () => {
  const csv = buildCsv(
    DEAL_IMPORT_TEMPLATE_COLUMNS.map((column) => ({ key: column.key, header: column.header })),
    DEAL_IMPORT_TEMPLATE_SAMPLE,
  );
  const parsed = parseSpreadsheetFile(new TextEncoder().encode(csv).buffer, "deal-template.csv");
  const result = validateDealImportRows(parsed.rows);

  expect(parsed.headers[0]).toBe("account_name");
  expect(result.errors).toEqual([]);
  expect(result.rows).toHaveLength(1);
});

test("resolveTeamCompanyName rejects placeholder or blank company labels", () => {
  expect(resolveTeamCompanyName("  Techilla  ")).toBe("Techilla");
  expect(resolveTeamCompanyName("")).toBeNull();
  expect(resolveTeamCompanyName("   ")).toBeNull();
  expect(resolveTeamCompanyName(null)).toBeNull();
});
