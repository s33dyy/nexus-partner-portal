import { expect, test } from "bun:test";

import {
  analyzeInventoryTables,
  emptyInventorySnapshot,
  formatInventoryReport,
  listInventoryTables,
  type InventoryTables,
} from "@/server/inventory-report";
import { assertInventoryModeAllowed, parseArgs } from "../../scripts/inventory.ts";

test("inventory CLI requires an explicit safe mode", () => {
  expect(() => assertInventoryModeAllowed(parseArgs([]))).toThrow(
    "Inventory script is read-only by default; use --fixture or --live",
  );

  expect(parseArgs(["--fixture", "fixtures/inventory.json"]).fixturePath).toBe(
    "fixtures/inventory.json",
  );
});

test("inventory analyzer spots fixture issues and formats a summary", () => {
  const snapshot: InventoryTables = {
    profiles: [
      {
        id: "profile-1",
        email: "demo@example.com",
        password_hash: "hash",
        full_name: "Demo User",
        phone: null,
        company_name: "Demo Co",
        avatar_url: null,
        partner_id: null,
        partner_status: "approved",
        must_reset_password: false,
        is_seed: true,
        created_at: "2026-07-29T00:00:00Z",
        updated_at: "2026-07-29T00:00:00Z",
      },
    ],
    user_roles: [
      {
        id: "role-1",
        user_id: "profile-1",
        role: "super_admin",
        is_seed: true,
        created_at: "2026-07-29T00:00:00Z",
      },
      {
        id: "role-2",
        user_id: "profile-1",
        role: "super_admin",
        is_seed: true,
        created_at: "2026-07-29T00:01:00Z",
      },
    ],
    partners: [
      {
        id: "partner-1",
        owner_user_id: "profile-1",
        company_name: "Demo Partner",
        legal_name: null,
        gst_number: null,
        pan: null,
        cin: null,
        website: "https://example.com/public",
        business_address: "123 Demo Street",
        country: "Narnia",
        state: "Somewhere",
        business_type: "Private Limited",
        years_in_business: 2,
        annual_turnover: "$1,200",
        employee_count: "11-25",
        business_focus: ["Installations"],
        status: "approved",
        tier: "registered",
        agreement_envelope_id: null,
        agreement_sent_at: null,
        agreement_signed_at: null,
        agreement_source_doc_path: null,
        agreement_signed_doc_path: null,
        agreement_provider: "zohosign",
        is_seed: true,
        created_at: "2026-07-29T00:00:00Z",
        updated_at: "2026-07-29T00:00:00Z",
      },
    ],
    document_blobs: [
      {
        file_path: "partner-documents/demo.pdf",
        bucket: "partner-documents",
        file_name: "demo.pdf",
        mime_type: "application/pdf",
        size_bytes: 10,
        file_data: new Uint8Array(),
        is_seed: true,
        created_at: "2026-07-29T00:00:00Z",
      },
    ],
    partner_documents: [
      {
        id: "doc-1",
        partner_id: "partner-1",
        uploaded_by: "profile-1",
        doc_type: "contract",
        file_name: "demo.pdf",
        file_path: "partner-documents/missing.pdf",
        mime_type: "application/pdf",
        size_bytes: 10,
        is_seed: true,
        created_at: "2026-07-29T00:00:00Z",
      },
    ],
    portal_deals: [
      {
        id: "deal-1",
        account_name: "Demo Account",
        contact_name: "Demo Contact",
        owner_name: "Demo Owner",
        country: "India",
        region: "West",
        product: "Camera",
        stage: "demo",
        status: "demo",
        quantity: 1,
        amount: "₹1200",
        currency_code: "INR",
        amount_value: null,
        amount_usd: null,
        fx_rate: null,
        fx_provider: null,
        fx_rate_fetched_at: null,
        customer_budget: "1,200",
        probability: 25,
        possible_close_date: null,
        close_date: "2026-07-29",
        source: "demo-source",
        last_touch: "2026-07-29",
        notes: "https://example.com/public",
        is_hidden_to_team: false,
        reward_rate_percent: 5,
        is_seed: true,
        created_at: "2026-07-29T00:00:00Z",
        updated_at: "2026-07-29T00:00:00Z",
        user_id: "profile-1",
        partner_id: "partner-1",
        customer_id: null,
        poc_profile_id: null,
      },
    ],
    portal_deal_collaborators: [],
    portal_customers: [
      {
        id: "customer-1",
        company_name: "Demo Customer",
        account_owner: "Demo Owner",
        region: "West",
        segment: "Enterprise",
        health_score: 90,
        mrr: "₹1000",
        renewal_date: "2026-08-01",
        status: "active",
        next_step: "Follow up",
        last_touch: "2026-07-29",
        is_seed: true,
        created_at: "2026-07-29T00:00:00Z",
        updated_at: "2026-07-29T00:00:00Z",
        user_id: "profile-1",
        partner_id: "partner-1",
      },
    ],
    portal_catalog_items: [],
    portal_team_members: [],
    portal_audit_events: [],
    reward_catalog_items: [],
    reward_point_events: [],
    reward_redemptions: [],
    lookup_values: [
      {
        id: "lookup-1",
        field_name: "unknown.field",
        value: "Demo",
        value_key: "demo",
        domain_key: "general",
        label_snapshot: "Demo",
        value_version: 1,
        effective_from: "2026-07-29",
        effective_to: null,
        retired_at: null,
        source: "manual",
        metadata: {},
        created_by: null,
        is_seed: true,
        created_at: "2026-07-29T00:00:00Z",
      },
    ],
    feature_flags: [],
    domain_activity_events: [],
    command_outbox: [],
    command_inbox: [],
    support_tickets: [
      {
        id: "ticket-1",
        partner_id: "partner-1",
        created_by: "profile-1",
        created_by_name: "Demo User",
        subject: "Demo ticket",
        description: "Demo ticket description",
        status: "urgent",
        priority: "urgent",
        assignee_name: "Support",
        is_seed: true,
        created_at: "2026-07-29T00:00:00Z",
        updated_at: "2026-07-29T00:00:00Z",
      },
    ],
    support_ticket_comments: [],
    notifications: [],
  };

  const report = analyzeInventoryTables(snapshot, "fixture:test");

  expect(report.summary.issueCount).toBeGreaterThan(0);
  expect(report.summary.demoTestRowCount).toBeGreaterThan(0);
  expect(report.tables.find((table) => table.table === "lookup_values")?.unknownEnumValues).toEqual(
    {},
  );
  expect(
    report.issues.some(
      (issue) => issue.kind === "unknown-reference-field" && issue.table === "lookup_values",
    ),
  ).toBe(true);
  expect(
    report.issues.some(
      (issue) => issue.kind === "orphaned-relationship" && issue.table === "partner_documents",
    ),
  ).toBe(true);
  expect(
    report.issues.some((issue) => issue.kind === "string-money" && issue.table === "partners"),
  ).toBe(true);
  expect(
    report.issues.some((issue) => issue.kind === "unsafe-link" && issue.table === "partners"),
  ).toBe(true);
  expect(formatInventoryReport(report)).toContain("Inventory report for fixture:test");
});

// ---------------------------------------------------------------------------
// Distribution (DMS) coverage — product.md §24
// ---------------------------------------------------------------------------

const DMS_TABLES = [
  "stock_locations",
  "stock_requests",
  "stock_request_lines",
  "inventory_balances",
  "inventory_movements",
  "stock_request_transitions",
] as const;

test("the inventory analyzer covers every distribution table", () => {
  const covered = listInventoryTables();
  for (const table of DMS_TABLES) {
    expect(covered).toContain(table);
  }
  // An empty snapshot must still name them, so a fresh database reports
  // "0 rows" for stock rather than silently omitting the domain.
  const empty = emptyInventorySnapshot();
  for (const table of DMS_TABLES) {
    expect(empty[table]).toEqual([]);
  }
});

test("the inventory analyzer flags distribution enum, reference, and duplicate defects", () => {
  const snapshot: InventoryTables = {
    ...emptyInventorySnapshot(),
    stock_locations: [
      {
        id: "loc-1",
        location_code: "WH-MUM",
        location_name: "Mumbai Warehouse",
        // Not one of the two governed location types.
        location_type: "third_party_depot",
        tenant_id: "tenant-livey-org",
        organization_tenant_id: "tenant-livey-org",
        geography_node_id: "geo-in",
        distributor_assignment_id: null,
        custodian_assignment_id: null,
        active: true,
        version: 1,
        created_at: "2026-08-25T00:00:00Z",
        updated_at: "2026-08-25T00:00:00Z",
      },
    ],
    stock_requests: [
      {
        id: "req-1",
        human_id: "DMS-000001",
        distributor_assignment_id: "assignment-missing",
        requester_user_id: "profile-missing",
        manager_assignment_id: "assignment-missing",
        destination_location_id: "loc-1",
        deal_id: null,
        customer_id: null,
        // Not one of the eleven governed statuses.
        status: "in_limbo",
        priority: "medium",
        required_by: "2026-09-01",
        reason: "Restock",
        exception_reason: null,
        version: 1,
        idempotency_key: "key-1",
        created_at: "2026-08-25T00:00:00Z",
        updated_at: "2026-08-25T00:00:00Z",
      },
    ],
    inventory_movements: [
      {
        id: "mv-1",
        movement_type: "teleportation",
        product_sku_id: "sku-missing",
        source_location_id: null,
        destination_location_id: "loc-1",
        quantity: 5,
        request_line_id: null,
        actor_user_id: null,
        assignment_id: null,
        reason: "Opening",
        correlation_id: "corr-1",
        idempotency_key: "mv-key-1",
        created_at: "2026-08-25T00:00:00Z",
      },
    ],
    inventory_balances: [
      {
        id: "bal-1",
        product_sku_id: "sku-1",
        location_id: "loc-1",
        on_hand_quantity: 10,
        reserved_quantity: 0,
        damaged_quantity: 0,
        version: 1,
        created_at: "2026-08-25T00:00:00Z",
        updated_at: "2026-08-25T00:00:00Z",
      },
      {
        // Same (SKU, location) pair twice — the projection must be unique.
        id: "bal-2",
        product_sku_id: "sku-1",
        location_id: "loc-1",
        on_hand_quantity: 4,
        reserved_quantity: 0,
        damaged_quantity: 0,
        version: 1,
        created_at: "2026-08-25T00:00:00Z",
        updated_at: "2026-08-25T00:00:00Z",
      },
    ],
  };

  const report = analyzeInventoryTables(snapshot, "fixture:distribution");

  expect(
    report.issues.some(
      (issue) => issue.kind === "invalid-enum" && issue.table === "stock_locations",
    ),
  ).toBe(true);
  expect(
    report.issues.some(
      (issue) => issue.kind === "invalid-enum" && issue.table === "stock_requests",
    ),
  ).toBe(true);
  expect(
    report.issues.some(
      (issue) => issue.kind === "invalid-enum" && issue.table === "inventory_movements",
    ),
  ).toBe(true);
  expect(
    report.issues.some(
      (issue) => issue.kind === "orphaned-relationship" && issue.table === "stock_requests",
    ),
  ).toBe(true);
  expect(
    report.issues.some(
      (issue) => issue.kind === "duplicate" && issue.table === "inventory_balances",
    ),
  ).toBe(true);
});
