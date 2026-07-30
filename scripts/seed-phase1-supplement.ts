import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

import type { PoolClient } from "pg";

import { createPool } from "./db";

// Deterministic, idempotent supplemental seed data for every table that the
// existing prod-demo seed (scripts/prod-demo-seed.ts, 5-partner fixture) and
// the organically-grown dev database (10 partners as of this run) leave
// empty. Reads whatever partners/customers/deals/profiles already exist —
// it does not assume a specific count or exact fixture — and populates
// catalogue, pricing, participants, discount workflow, tasks, tickets,
// learning content + enrollments + certificates, rewards, news,
// notifications, documents (backed by real PDFs already in the repo), and
// audit events. Safe to re-run: every row uses a deterministic UUID (derived
// from a stable namespace + key) and every INSERT is an upsert.

function deterministicUuid(namespace: string, key: string): string {
  const hash = createHash("sha256").update(`${namespace}:${key}`).digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    "4" + hash.slice(13, 16),
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join("-");
}

async function upsert(
  client: PoolClient,
  table: string,
  row: Record<string, unknown>,
  conflictColumn = "id",
) {
  const columns = Object.keys(row);
  const values = columns.map((c) => row[c]);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
  const updates = columns
    .filter((c) => c !== conflictColumn)
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(", ");
  await client.query(
    `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")})
     VALUES (${placeholders})
     ON CONFLICT (${conflictColumn}) DO UPDATE SET ${updates || `"${conflictColumn}" = EXCLUDED."${conflictColumn}"`}`,
    values,
  );
}

type Partner = { id: string; company_name: string; status: string; tier: string };
type Profile = {
  id: string;
  email: string;
  full_name: string;
  partner_id: string | null;
  partner_status: string;
};
type Customer = { id: string; company_name: string; partner_id: string; user_id: string };
type Deal = {
  id: string;
  account_name: string;
  partner_id: string;
  customer_id: string;
  user_id: string;
  stage: string;
  status: string;
  amount: string;
  amount_usd: string;
  version: number;
  product: string;
};

async function loadLiveState(client: PoolClient) {
  const partners = (
    await client.query<Partner>(
      `SELECT id, company_name, status, tier FROM partners ORDER BY created_at`,
    )
  ).rows;
  const profiles = (
    await client.query<Profile>(
      `SELECT id, email, full_name, partner_id, partner_status FROM profiles ORDER BY created_at`,
    )
  ).rows;
  const customers = (
    await client.query<Customer>(
      `SELECT id, company_name, partner_id, user_id FROM portal_customers ORDER BY created_at`,
    )
  ).rows;
  const deals = (
    await client.query<Deal>(
      `SELECT id, account_name, partner_id, customer_id, user_id, stage, status, amount, amount_usd, version, product FROM portal_deals ORDER BY created_at`,
    )
  ).rows;
  return { partners, profiles, customers, deals };
}

// ---------------------------------------------------------------------------
// 0. Data-hygiene fix: no seeded deal may sit on the retired "approved"
//    pipeline stage (product.md §9.2/§23.4 — "Approved is never a pipeline
//    stage"; DEAL_STAGE_ORDER no longer contains it, so a row stuck there is
//    invisible on the pipeline board, which the deal-commands.server.ts/
//    pipeline.tsx fix in this session's Work Package B does not retroactively
//    migrate). Map it to the last open stage before Won.
// ---------------------------------------------------------------------------
async function fixLegacyApprovedStage(client: PoolClient) {
  const { rowCount } = await client.query(
    `UPDATE portal_deals SET stage = 'negotiation', updated_at = now() WHERE stage = 'approved'`,
  );
  if (rowCount) console.log(`Migrated ${rowCount} deal(s) off the retired "approved" stage`);
}

// ---------------------------------------------------------------------------
// 1. Catalogue: portal_catalog_items (what admin.catalog.tsx / customers read)
// ---------------------------------------------------------------------------
const CATALOG_NS = "catalog-v1";

type CatalogSeed = {
  sku: string;
  product_name: string;
  category: string;
  partner_tier: string;
  list_price: string;
  margin: string;
  stock: number;
  availability: string;
  benefits: string;
};

const CATALOG_ITEMS: CatalogSeed[] = [
  {
    sku: "LIV-CLD-100",
    product_name: "Cloud Suite",
    category: "Software",
    partner_tier: "gold",
    list_price: "$1,200.00",
    margin: "22%",
    stock: 500,
    availability: "in_stock",
    benefits: "Full workspace licence, priority support, quarterly business reviews.",
  },
  {
    sku: "LIV-ONB-200",
    product_name: "Onboarding Services",
    category: "Services",
    partner_tier: "silver",
    list_price: "$5,600.00",
    margin: "18%",
    stock: 9999,
    availability: "in_stock",
    benefits: "Guided setup, data migration, and go-live support.",
  },
  {
    sku: "LIV-DAT-300",
    product_name: "Data Platform",
    category: "Software",
    partner_tier: "platinum",
    list_price: "$3,900.00",
    margin: "25%",
    stock: 200,
    availability: "in_stock",
    benefits: "Managed pipelines, warehouse connectors, and role-based access.",
  },
  {
    sku: "LIV-ROL-400",
    product_name: "Rollout Services",
    category: "Services",
    partner_tier: "registered",
    list_price: "$4,900.00",
    margin: "15%",
    stock: 9999,
    availability: "in_stock",
    benefits: "Device provisioning and staged rollout management.",
  },
  {
    sku: "LIV-COM-500",
    product_name: "Commerce Suite",
    category: "Software",
    partner_tier: "gold",
    list_price: "$1,583.00",
    margin: "24%",
    stock: 300,
    availability: "in_stock",
    benefits: "Storefront, checkout, and inventory sync across channels.",
  },
  {
    sku: "LIV-AUT-600",
    product_name: "Automation Suite",
    category: "Software",
    partner_tier: "registered",
    list_price: "$3,400.00",
    margin: "20%",
    stock: 150,
    availability: "limited",
    benefits: "Workflow automation for manufacturing floor operations.",
  },
  {
    sku: "LIV-BOK-700",
    product_name: "Booking Platform",
    category: "Software",
    partner_tier: "registered",
    list_price: "$3,200.00",
    margin: "19%",
    stock: 400,
    availability: "in_stock",
    benefits: "Reservation management with channel-manager integration.",
  },
  {
    sku: "LIV-SUR-800",
    product_name: "Surveillance Rollout",
    category: "Hardware",
    partner_tier: "registered",
    list_price: "$5,400.00",
    margin: "12%",
    stock: 60,
    availability: "out_of_stock",
    benefits: "Camera hardware bundle with monitoring dashboard licence.",
  },
  {
    sku: "LIV-MON-900",
    product_name: "Remote Monitoring",
    category: "Hardware",
    partner_tier: "silver",
    list_price: "$5,600.00",
    margin: "21%",
    stock: 120,
    availability: "in_stock",
    benefits: "Remote diagnostic devices with cloud telemetry.",
  },
  {
    sku: "LIV-STO-1000",
    product_name: "Storage Expansion",
    category: "Hardware",
    partner_tier: "gold",
    list_price: "$1,500.00",
    margin: "17%",
    stock: 250,
    availability: "in_stock",
    benefits: "Modular storage arrays with hot-swap support.",
  },
];

async function seedCatalog(client: PoolClient) {
  for (const item of CATALOG_ITEMS) {
    await upsert(client, "portal_catalog_items", {
      id: deterministicUuid(CATALOG_NS, item.sku),
      sku: item.sku,
      product_name: item.product_name,
      category: item.category,
      partner_tier: item.partner_tier,
      list_price: item.list_price,
      margin: item.margin,
      stock: item.stock,
      availability: item.availability,
      benefits: item.benefits,
      catalog_kind: "product",
      currency_code: "USD",
      product_status: "active",
      is_seed: true,
      updated_at: new Date().toISOString(),
    });
  }
  console.log(`Seeded ${CATALOG_ITEMS.length} catalog items`);
}

function catalogUnitUsd(sku: string): number {
  const raw = CATALOG_ITEMS.find((c) => c.sku === sku)?.list_price ?? "$0";
  return Number(raw.replace(/[^0-9.]/g, "")) || 0;
}

// Map each existing deal's free-text `product` label to a catalogue SKU.
const PRODUCT_TO_SKU: Record<string, string> = {
  "Cloud Suite": "LIV-CLD-100",
  "Onboarding Services": "LIV-ONB-200",
  "Data Platform": "LIV-DAT-300",
  "Rollout Services": "LIV-ROL-400",
  "Commerce Suite": "LIV-COM-500",
  "Automation Suite": "LIV-AUT-600",
  "Booking Platform": "LIV-BOK-700",
  "Surveillance Rollout": "LIV-SUR-800",
  "Remote Monitoring": "LIV-MON-900",
  "Storage Expansion": "LIV-STO-1000",
};

// ---------------------------------------------------------------------------
// 2. deal_line_items + pricing_revisions per existing deal
// ---------------------------------------------------------------------------
async function seedDealPricing(client: PoolClient, deals: Deal[]) {
  for (const deal of deals) {
    const sku = PRODUCT_TO_SKU[deal.product] ?? "LIV-CLD-100";
    const unitUsd = catalogUnitUsd(sku) || Number(deal.amount_usd) || 1000;
    const isPastProposal = ["proposal", "negotiation", "won", "lost"].includes(deal.stage);
    const discountPct = isPastProposal && deal.stage !== "won" ? 8 : 0;
    const msrp = Math.round(unitUsd * 1.15 * 100) / 100;
    const ptp = unitUsd;
    const dtp = Math.round(ptp * (1 - discountPct / 100) * 100) / 100;
    const proposedSelling = Math.round(msrp * 0.95 * 100) / 100;

    const lineItemId = deterministicUuid("line-item-v1", deal.id);
    await upsert(client, "deal_line_items", {
      id: lineItemId,
      deal_id: deal.id,
      product_id: sku,
      quantity: 1,
      msrp_usd: msrp,
      ptp_usd: ptp,
      discount_pct: discountPct,
      dtp_usd: dtp,
      proposed_selling_price_usd: proposedSelling,
      reward_eligible: true,
      snapshot_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const revisionId = deterministicUuid("pricing-revision-v1", deal.id);
    await upsert(client, "pricing_revisions", {
      id: revisionId,
      deal_id: deal.id,
      revision_number: 1,
      total_ptp_usd: ptp,
      total_dtp_usd: dtp,
      is_final: deal.stage === "won" || deal.stage === "lost",
      created_by: deal.user_id,
      approved_by: deal.stage === "won" ? deal.user_id : null,
    });
  }
  console.log(`Seeded line items and pricing revisions for ${deals.length} deals`);
}

// ---------------------------------------------------------------------------
// 3. deal_outcome_reviews for Won deals (matches deal-outcome-review.tsx's
//    actual local vocabulary: not_applicable/requested/received/approved/
//    rejected, not the canonical blueprint keys — see outcome-review-
//    commands.server.ts).
// ---------------------------------------------------------------------------
async function seedOutcomeReviews(client: PoolClient, deals: Deal[]) {
  let count = 0;
  for (const deal of deals) {
    if (deal.stage !== "won") continue;
    await upsert(client, "deal_outcome_reviews", {
      id: deterministicUuid("outcome-review-v1", deal.id),
      deal_id: deal.id,
      status: "approved",
      po_document_url: null,
      po_number: `PO-${deal.id.slice(0, 8).toUpperCase()}`,
      po_date: new Date().toISOString().slice(0, 10),
      po_amount: Number(deal.amount_usd),
      currency_code: "USD",
      reason: "Purchase order verified against final line items",
      actor_id: deal.user_id,
      version: 1,
      is_seed: true,
      updated_at: new Date().toISOString(),
    });
    count += 1;
  }
  console.log(`Seeded ${count} outcome review(s) for Won deals`);
}

// ---------------------------------------------------------------------------
// 4. deal_participants + customer_participants (RM/ISR/PAM/KAM style tags)
// ---------------------------------------------------------------------------
async function seedParticipants(
  client: PoolClient,
  deals: Deal[],
  customers: Customer[],
  liveyInternal: Profile[],
) {
  const rm = liveyInternal[0];
  const isr = liveyInternal[1] ?? liveyInternal[0];
  if (!rm) return;

  for (const deal of deals) {
    await upsert(client, "deal_participants", {
      id: deterministicUuid("deal-participant-rm", deal.id),
      deal_id: deal.id,
      partner_id: deal.partner_id,
      participant_type: "rm",
      source: "automatic",
      actor_id: rm.id,
      reason: "Automatic RM tag for the deal's region",
      valid_from: new Date().toISOString(),
      valid_to: null,
      provenance: JSON.stringify({ userId: rm.id }),
      is_seed: true,
      updated_at: new Date().toISOString(),
    });
    if (["qualified", "proposal", "negotiation", "won", "lost"].includes(deal.stage)) {
      await upsert(client, "deal_participants", {
        id: deterministicUuid("deal-participant-isr", deal.id),
        deal_id: deal.id,
        partner_id: deal.partner_id,
        participant_type: "isr",
        source: "automatic",
        actor_id: isr.id,
        reason: "Tagged from Sourced, retained through closure",
        valid_from: new Date().toISOString(),
        valid_to: null,
        provenance: JSON.stringify({ userId: isr.id }),
        is_seed: true,
        updated_at: new Date().toISOString(),
      });
    }
  }

  for (const customer of customers) {
    await upsert(client, "customer_participants", {
      id: deterministicUuid("customer-participant-kam", customer.id),
      customer_id: customer.id,
      partner_id: customer.partner_id,
      participant_type: "kam",
      source: "automatic",
      actor_id: rm.id,
      reason: "Assigned KAM for the account",
      valid_from: new Date().toISOString(),
      valid_to: null,
      provenance: JSON.stringify({ userId: rm.id }),
      is_seed: true,
      updated_at: new Date().toISOString(),
    });
  }
  console.log(`Seeded participants for ${deals.length} deals and ${customers.length} customers`);
}

// ---------------------------------------------------------------------------
// 5. discount_requests for deals at/after Proposal
// ---------------------------------------------------------------------------
async function seedDiscountRequests(client: PoolClient, deals: Deal[]) {
  let count = 0;
  for (const deal of deals) {
    if (!["proposal", "negotiation"].includes(deal.stage)) continue;
    const lineItemId = deterministicUuid("line-item-v1", deal.id);
    await upsert(client, "discount_requests", {
      id: deterministicUuid("discount-request-v1", deal.id),
      deal_id: deal.id,
      line_item_id: lineItemId,
      requested_discount_pct: 8,
      status: deal.stage === "negotiation" ? "approved" : "pending",
      reason: "Competitive pricing match requested by the partner",
      approver_id: deal.stage === "negotiation" ? deal.user_id : null,
      requester_id: deal.user_id,
      updated_at: new Date().toISOString(),
    });
    count += 1;
  }
  console.log(`Seeded ${count} discount request(s)`);
}

// ---------------------------------------------------------------------------
// 6. Tasks — a handful per deal across different statuses
// ---------------------------------------------------------------------------
const TASK_STATUS_CYCLE = ["to_do", "in_progress", "blocked", "completed", "cancelled"] as const;

async function seedTasks(client: PoolClient, deals: Deal[], profiles: Profile[]) {
  const created: { id: string; status: string }[] = [];
  for (const [index, deal] of deals.entries()) {
    const status = TASK_STATUS_CYCLE[index % TASK_STATUS_CYCLE.length];
    const assignee = profiles.find((p) => p.id === deal.user_id) ?? profiles[0];
    const taskId = deterministicUuid("task-v1", deal.id);
    const dueAt = new Date(Date.now() + (index - 2) * 86_400_000).toISOString();
    await upsert(client, "tasks", {
      id: taskId,
      title: `Follow up on ${deal.account_name}`,
      description: `Confirm next steps for ${deal.account_name} (${deal.stage}).`,
      status,
      priority: index % 3 === 0 ? "high" : "medium",
      related_type: "deal",
      related_id: deal.id,
      assignee_id: assignee?.id ?? null,
      creator_id: assignee?.id ?? null,
      partner_id: deal.partner_id,
      due_at: dueAt,
      blocked_reason: status === "blocked" ? "Waiting on customer procurement sign-off" : null,
      completed_at: status === "completed" ? new Date().toISOString() : null,
      cancelled_at: status === "cancelled" ? new Date().toISOString() : null,
      version: 1,
      is_seed: true,
      updated_at: new Date().toISOString(),
    });
    created.push({ id: taskId, status });
  }
  console.log(`Seeded ${created.length} tasks`);
  return created;
}

// ---------------------------------------------------------------------------
// 7. support_tickets + support_ticket_comments
// ---------------------------------------------------------------------------
const TICKET_STATUS_CYCLE = [
  "open",
  "in_progress",
  "waiting_on_partner",
  "closed",
  "reopen_requested",
] as const;

async function seedTickets(client: PoolClient, partners: Partner[], profiles: Profile[]) {
  let count = 0;
  for (const [index, partner] of partners.entries()) {
    const requester = profiles.find((p) => p.partner_id === partner.id) ?? profiles[0];
    if (!requester) continue;
    const status = TICKET_STATUS_CYCLE[index % TICKET_STATUS_CYCLE.length];
    const ticketId = deterministicUuid("ticket-v1", partner.id);
    await upsert(client, "support_tickets", {
      id: ticketId,
      partner_id: partner.id,
      created_by: requester.id,
      created_by_name: requester.full_name,
      subject: `${partner.company_name}: device setup question`,
      description: `${partner.company_name} needs help configuring their LIVEY deployment.`,
      status,
      priority: index % 2 === 0 ? "medium" : "high",
      assignee_name: "LIVEY Support",
      is_seed: true,
      updated_at: new Date().toISOString(),
    });

    await upsert(client, "support_ticket_comments", {
      id: deterministicUuid("ticket-comment-1", partner.id),
      ticket_id: ticketId,
      author_id: requester.id,
      author_name: requester.full_name,
      author_role: "partner_user",
      body: "Could you confirm the recommended configuration for our region?",
      is_seed: true,
    });
    if (status !== "open") {
      await upsert(client, "support_ticket_comments", {
        id: deterministicUuid("ticket-comment-2", partner.id),
        ticket_id: ticketId,
        author_id: null,
        author_name: "LIVEY Support",
        author_role: "livey_support",
        body: "Thanks for reaching out — here is the recommended setup guide.",
        is_seed: true,
      });
    }
    count += 1;
  }
  console.log(`Seeded ${count} tickets with comments`);
}

// ---------------------------------------------------------------------------
// 8. Learning: tracks/subjects/lessons/assessments + enrollments + attempts
// ---------------------------------------------------------------------------
const LEARNING_NS = "learning-v1";

async function seedLearning(client: PoolClient, profiles: Profile[]) {
  const tracks = [
    {
      key: "sales",
      title: "Sales Track",
      description: "Brand and product knowledge for LIVEY partner sales teams.",
      tier: null as string | null,
    },
    {
      key: "technical",
      title: "Technical Track",
      description:
        "Installation, configuration, and troubleshooting for each LIVEY product series.",
      tier: null as string | null,
    },
    {
      key: "solution",
      title: "Solution Track",
      description: "LIVEY Solution Design for multi-product architectures.",
      tier: "Gold" as string | null,
    },
  ];

  const trackIds: Record<string, string> = {};
  for (const track of tracks) {
    const id = deterministicUuid(LEARNING_NS, `track:${track.key}`);
    trackIds[track.key] = id;
    await upsert(client, "learning_tracks", {
      id,
      title: track.title,
      description: track.description,
      status: "published",
      is_published: true,
      tier_requirement: track.tier,
      updated_at: new Date().toISOString(),
    });
  }

  const subjects = [
    { key: "sales:brand", track: "sales", title: "Audixa & Realsight Brand Knowledge", order: 0 },
    { key: "sales:process", track: "sales", title: "Qualification & Proposal Guidance", order: 1 },
    { key: "technical:cloud", track: "technical", title: "Cloud Suite (Product Series)", order: 0 },
    {
      key: "technical:data",
      track: "technical",
      title: "Data Platform (Product Series)",
      order: 1,
    },
    { key: "solution:design", track: "solution", title: "LIVEY Solution Design", order: 0 },
  ];

  const subjectIds: Record<string, string> = {};
  for (const subject of subjects) {
    const id = deterministicUuid(LEARNING_NS, `subject:${subject.key}`);
    subjectIds[subject.key] = id;
    await upsert(client, "learning_subjects", {
      id,
      track_id: trackIds[subject.track],
      title: subject.title,
      description: `${subject.title} — required reading and practical resources.`,
      status: "published",
      sort_order: subject.order,
      order_index: subject.order,
      updated_at: new Date().toISOString(),
    });
  }

  const lessons = [
    {
      key: "sales:brand:1",
      subject: "sales:brand",
      title: "LIVEY & Brand Positioning",
      type: "text",
      order: 0,
      required: true,
    },
    {
      key: "sales:brand:2",
      subject: "sales:brand",
      title: "Audixa Product Overview",
      order: 1,
      type: "video",
      required: true,
    },
    {
      key: "sales:process:1",
      subject: "sales:process",
      title: "Discovery & Qualification",
      order: 0,
      type: "video",
      required: true,
    },
    {
      key: "technical:cloud:1",
      subject: "technical:cloud",
      title: "Cloud Suite — Installation",
      order: 0,
      type: "video",
      required: true,
    },
    {
      key: "technical:cloud:2",
      subject: "technical:cloud",
      title: "Cloud Suite — Troubleshooting",
      order: 1,
      type: "text",
      required: false,
    },
    {
      key: "technical:data:1",
      subject: "technical:data",
      title: "Data Platform — Architecture",
      order: 0,
      type: "video",
      required: true,
    },
    {
      key: "solution:design:1",
      subject: "solution:design",
      title: "Multi-Product Sizing & Validation",
      order: 0,
      type: "text",
      required: true,
    },
  ];

  for (const lesson of lessons) {
    const id = deterministicUuid(LEARNING_NS, `lesson:${lesson.key}`);
    await upsert(client, "learning_lessons", {
      id,
      course_id: null,
      subject_id: subjectIds[lesson.subject],
      title: lesson.title,
      content_url: null,
      content_type: lesson.type,
      duration_minutes: lesson.type === "video" ? 12 : 6,
      status: "published",
      sort_order: lesson.order,
      order_index: lesson.order,
      is_required: lesson.required,
      updated_at: new Date().toISOString(),
    });
  }

  const assessments: Record<string, string> = {};
  for (const subjectKey of ["sales:brand", "technical:cloud", "solution:design"]) {
    const id = deterministicUuid(LEARNING_NS, `assessment:${subjectKey}`);
    assessments[subjectKey] = id;
    await upsert(client, "learning_assessments", {
      id,
      subject_id: subjectIds[subjectKey],
      title: `${subjects.find((s) => s.key === subjectKey)?.title} Assessment`,
      passing_score: 80,
      updated_at: new Date().toISOString(),
    });
  }

  // Enroll partner users: cycle through enrolled/completed/not-enrolled so
  // the Insight Hub page shows every visible state.
  const partnerUsers = profiles.filter((p) => p.partner_id);
  let enrollCount = 0;
  let certCount = 0;
  for (const [index, user] of partnerUsers.entries()) {
    const trackKey = ["sales", "technical", "solution"][index % 3];
    const trackId = trackIds[trackKey];
    const completed = index % 2 === 0;
    const enrollmentId = deterministicUuid(LEARNING_NS, `enrollment:${user.id}:${trackKey}`);
    const certificateToken = completed
      ? deterministicUuid(LEARNING_NS, `cert:${user.id}:${trackKey}`)
      : null;
    await upsert(
      client,
      "learning_enrollments",
      {
        id: enrollmentId,
        user_id: user.id,
        track_id: trackId,
        status: completed ? "completed" : "in_progress",
        score_percent: completed ? 92 : null,
        progress_percent: completed ? 100 : 45,
        completed_at: completed ? new Date().toISOString() : null,
        certificate_token: certificateToken,
        is_certified: completed,
        updated_at: new Date().toISOString(),
      },
      "id",
    );
    enrollCount += 1;

    if (completed) {
      const assessmentId =
        assessments[
          trackKey === "sales"
            ? "sales:brand"
            : trackKey === "technical"
              ? "technical:cloud"
              : "solution:design"
        ];
      await upsert(client, "learning_assessment_attempts", {
        id: deterministicUuid(LEARNING_NS, `attempt:${user.id}:${trackKey}`),
        assessment_id: assessmentId,
        user_id: user.id,
        score: 92,
        is_passed: true,
      });
      certCount += 1;
    }
  }
  console.log(
    `Seeded ${tracks.length} tracks, ${subjects.length} subjects, ${lessons.length} lessons, ${enrollCount} enrollments (${certCount} certified)`,
  );
}

// ---------------------------------------------------------------------------
// 9. Rewards: catalogue items + point events (Won deals) + redemptions
// ---------------------------------------------------------------------------
const REWARDS_NS = "rewards-v1";

const REWARD_CATALOG: Array<{
  key: string;
  title: string;
  description: string;
  category: string;
  points: number;
  stock: number;
  availability: string;
}> = [
  {
    key: "wireless-earbuds",
    title: "LIVEY Wireless Earbuds",
    description: "Branded noise-cancelling earbuds.",
    category: "Gadgets",
    points: 4000,
    stock: 25,
    availability: "available",
  },
  {
    key: "smart-speaker",
    title: "Smart Speaker",
    description: "Voice-assistant speaker for the office.",
    category: "Gadgets",
    points: 6000,
    stock: 10,
    availability: "available",
  },
  {
    key: "gift-card-2000",
    title: "₹2,000 Gift Card",
    description: "Digital gift card via GyFTR/QuickSilver.",
    category: "Gift Cards",
    points: 2000,
    stock: 9999,
    availability: "available",
  },
  {
    key: "gift-card-5000",
    title: "₹5,000 Gift Card",
    description: "Digital gift card via GyFTR/QuickSilver.",
    category: "Gift Cards",
    points: 5000,
    stock: 9999,
    availability: "available",
  },
  {
    key: "backpack",
    title: "LIVEY Travel Backpack",
    description: "Weatherproof laptop backpack.",
    category: "Merchandise",
    points: 1500,
    stock: 0,
    availability: "out_of_stock",
  },
];

async function seedRewards(client: PoolClient, deals: Deal[], profiles: Profile[]) {
  const itemIds: Record<string, string> = {};
  for (const item of REWARD_CATALOG) {
    const id = deterministicUuid(REWARDS_NS, item.key);
    itemIds[item.key] = id;
    await upsert(client, "reward_catalog_items", {
      id,
      title: item.title,
      description: item.description,
      image_path: null,
      category: item.category,
      points_cost: item.points,
      stock: item.stock,
      availability: item.availability,
      is_seed: true,
      updated_at: new Date().toISOString(),
    });
  }

  let awardCount = 0;
  for (const deal of deals) {
    if (deal.stage !== "won") continue;
    const rewardBasis = Number(deal.amount_usd) || 0;
    const points = Math.round(rewardBasis * 0.05 * 10); // 5% reward, ~10 pts/USD for a visible balance
    await upsert(client, "reward_point_events", {
      id: deterministicUuid(REWARDS_NS, `award:${deal.id}`),
      user_id: deal.user_id,
      partner_id: deal.partner_id,
      source_type: "deal_win",
      source_id: deal.id,
      points_delta: points,
      reason: `${deal.account_name} closed won`,
      approved_by: deal.user_id,
      approved_at: new Date().toISOString(),
      is_seed: true,
    });
    awardCount += 1;

    const redemptionOwner = profiles.find((p) => p.id === deal.user_id);
    if (redemptionOwner) {
      await upsert(client, "reward_redemptions", {
        id: deterministicUuid(REWARDS_NS, `redemption:${deal.id}`),
        reward_id: itemIds["gift-card-2000"],
        user_id: redemptionOwner.id,
        partner_id: deal.partner_id,
        points_cost: REWARD_CATALOG.find((r) => r.key === "gift-card-2000")!.points,
        status: "requested",
        shipping_name: redemptionOwner.full_name,
        shipping_address: "On file with Partner Admin",
        notes: "Redeemed against the reward balance from the recent Won deal.",
        approved_by: null,
        approved_at: null,
        is_seed: true,
        updated_at: new Date().toISOString(),
      });
    }
  }
  console.log(`Seeded ${REWARD_CATALOG.length} reward catalog items, ${awardCount} award(s)`);
}

// ---------------------------------------------------------------------------
// 10. News posts (text-only cards — no image dependency)
// ---------------------------------------------------------------------------
const NEWS_NS = "news-v1";

async function seedNews(client: PoolClient, superAdmin: Profile) {
  const posts = [
    {
      key: "q3-kickoff",
      title: "Q3 Partner Kickoff",
      caption:
        "Welcome to Q3 — new pricing tiers and the refreshed Reward Store are now live for all approved partners.",
    },
    {
      key: "insight-hub-launch",
      title: "Insight Hub Certifications Are Live",
      caption:
        "Complete the Sales, Technical, or Solution track to earn your LIVEY certification and unlock partner rewards.",
    },
    {
      key: "zoho-books-sync",
      title: "Zoho Books Sync Update",
      caption:
        "Approved Won deals now sync automatically to Zoho Books for accounting once outcome review is approved.",
    },
  ];
  for (const post of posts) {
    await upsert(client, "portal_news_posts", {
      id: deterministicUuid(NEWS_NS, post.key),
      title: post.title,
      caption: post.caption,
      image_path: "",
      image_alt: "",
      posted_by_name: superAdmin.full_name,
      posted_by_role: "super_admin",
      updated_at: new Date().toISOString(),
      is_seed: true,
    });
  }
  console.log(`Seeded ${posts.length} news posts`);
}

// ---------------------------------------------------------------------------
// 11. Notifications
// ---------------------------------------------------------------------------
async function seedNotifications(client: PoolClient, deals: Deal[], profiles: Profile[]) {
  let count = 0;
  for (const deal of deals) {
    const owner = profiles.find((p) => p.id === deal.user_id);
    if (!owner) continue;
    await upsert(client, "notifications", {
      id: deterministicUuid("notification-v1", deal.id),
      user_id: owner.id,
      partner_id: deal.partner_id,
      title: `${deal.account_name} — stage update`,
      message: `${deal.account_name} is currently at ${deal.stage}.`,
      type: "deal_stage_change",
      read: deal.stage === "won" || deal.stage === "lost",
    });
    count += 1;
  }
  console.log(`Seeded ${count} notifications`);
}

// ---------------------------------------------------------------------------
// 12. Documents: real dummy PDFs already in the repo, loaded into
//     document_blobs, referenced from partner_documents / deal_documents.
// ---------------------------------------------------------------------------
const DUMMY_PDFS = [
  { path: "tmp/dummy-docs/gst-certificate-june-13.pdf", docType: "GST Certificate" },
  { path: "tmp/dummy-docs/pan-card-june-16.pdf", docType: "PAN Card" },
  { path: "tmp/dummy-docs/cin-incorporation-june-17.pdf", docType: "CIN / Incorporation" },
];

async function seedDocuments(
  client: PoolClient,
  partners: Partner[],
  deals: Deal[],
  profiles: Profile[],
) {
  const blobFilePaths: string[] = [];
  for (const pdf of DUMMY_PDFS) {
    const bytes = readFileSync(resolve(pdf.path));
    const blobPath = `partner-documents/seed/${pdf.docType.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
    blobFilePaths.push(blobPath);
    await upsert(
      client,
      "document_blobs",
      {
        file_path: blobPath,
        bucket: "partner-documents",
        file_name: pdf.path.split("/").pop(),
        mime_type: "application/pdf",
        size_bytes: bytes.length,
        file_data: bytes,
        is_seed: true,
      },
      "file_path",
    );
  }

  let partnerDocCount = 0;
  for (const partner of partners) {
    const admin = profiles.find((p) => p.partner_id === partner.id);
    if (!admin) continue;
    for (const [index, pdf] of DUMMY_PDFS.entries()) {
      await upsert(client, "partner_documents", {
        id: deterministicUuid("partner-doc-v1", `${partner.id}:${pdf.docType}`),
        partner_id: partner.id,
        uploaded_by: admin.id,
        doc_type: pdf.docType,
        file_name: pdf.path.split("/").pop(),
        file_path: blobFilePaths[index],
        mime_type: "application/pdf",
        size_bytes: readFileSync(resolve(pdf.path)).length,
        is_seed: true,
      });
      partnerDocCount += 1;
    }
  }

  let dealDocCount = 0;
  for (const deal of deals) {
    if (!["proposal", "negotiation", "won"].includes(deal.stage)) continue;
    const uploader = profiles.find((p) => p.id === deal.user_id);
    if (!uploader) continue;
    const docType = deal.stage === "won" ? "PO" : "Proposal";
    await upsert(client, "deal_documents", {
      id: deterministicUuid("deal-doc-v1", deal.id),
      deal_id: deal.id,
      partner_id: deal.partner_id,
      uploaded_by: uploader.id,
      doc_type: docType,
      file_name: `${deal.account_name.replace(/[^a-zA-Z0-9]+/g, "-")}-${docType.toLowerCase()}.pdf`,
      file_path: blobFilePaths[dealDocCount % blobFilePaths.length],
      mime_type: "application/pdf",
      size_bytes: readFileSync(resolve(DUMMY_PDFS[dealDocCount % DUMMY_PDFS.length].path)).length,
      is_seed: true,
      updated_at: new Date().toISOString(),
    });
    dealDocCount += 1;
  }
  console.log(
    `Seeded ${blobFilePaths.length} document blobs, ${partnerDocCount} partner documents, ${dealDocCount} deal documents`,
  );
}

// ---------------------------------------------------------------------------
// 13. Audit events
// ---------------------------------------------------------------------------
async function seedAuditEvents(client: PoolClient, deals: Deal[], superAdmin: Profile) {
  let count = 0;
  for (const deal of deals) {
    await upsert(client, "portal_audit_events", {
      id: deterministicUuid("audit-v1", deal.id),
      actor_name: superAdmin.full_name,
      actor_role: "super_admin",
      action: "deal_stage_review",
      target_type: "deal",
      target_name: deal.account_name,
      outcome: deal.stage,
      details: `${deal.account_name} reviewed at stage ${deal.stage}`,
      severity: deal.stage === "lost" ? "medium" : "low",
      is_seed: true,
    });
    count += 1;
  }
  console.log(`Seeded ${count} audit events`);
}

// ---------------------------------------------------------------------------
// 14. domain_activity_events, deal_transitions, task_transitions — real
//     history for the deal-activity-timeline.tsx component and dashboard's
//     Activity tab (both read domain_activity_events directly).
// ---------------------------------------------------------------------------
const HISTORY_NS = "history-v1";

const DEAL_EVENT_SEQUENCE: Record<string, string[]> = {
  sourced: ["deal.created"],
  demo: ["deal.created", "deal.stage_advanced"],
  testing: ["deal.created", "deal.stage_advanced", "deal.stage_advanced"],
  qualified: ["deal.created", "deal.stage_advanced", "deal.stage_advanced", "deal.stage_advanced"],
  proposal: [
    "deal.created",
    "deal.stage_advanced",
    "deal.stage_advanced",
    "deal.stage_advanced",
    "deal.stage_advanced",
  ],
  negotiation: [
    "deal.created",
    "deal.stage_advanced",
    "deal.stage_advanced",
    "deal.stage_advanced",
    "deal.stage_advanced",
    "deal.stage_advanced",
  ],
  won: [
    "deal.created",
    "deal.stage_advanced",
    "deal.stage_advanced",
    "deal.stage_advanced",
    "deal.stage_advanced",
    "deal.stage_advanced",
    "deal.won",
  ],
  lost: ["deal.created", "deal.stage_advanced", "deal.stage_advanced", "deal.lost"],
};

async function seedActivityAndTransitions(
  client: PoolClient,
  deals: Deal[],
  tasks: { id: string; status: string }[],
) {
  let activityCount = 0;
  let dealTransitionCount = 0;
  for (const deal of deals) {
    const sequence = DEAL_EVENT_SEQUENCE[deal.stage] ?? ["deal.created"];
    for (const [index, eventName] of sequence.entries()) {
      const occurredAt = new Date(Date.now() - (sequence.length - index) * 3_600_000).toISOString();
      await upsert(client, "domain_activity_events", {
        id: deterministicUuid(HISTORY_NS, `activity:${deal.id}:${index}`),
        tenant_id: "00000000-0000-4000-8000-000000000000",
        organization_tenant_id: "00000000-0000-4000-8000-000000000000",
        subject_type: "deal",
        subject_id: deal.id,
        actor_user_id: deal.user_id,
        assignment_id: null,
        correlation_id: deterministicUuid(HISTORY_NS, `correlation:${deal.id}:${index}`),
        event_name: eventName,
        schema_version: 1,
        payload: JSON.stringify({ dealId: deal.id, stage: deal.stage }),
        created_at: occurredAt,
      });
      activityCount += 1;

      if (
        eventName === "deal.stage_advanced" ||
        eventName === "deal.won" ||
        eventName === "deal.lost"
      ) {
        await upsert(client, "deal_transitions", {
          id: deterministicUuid(HISTORY_NS, `transition:${deal.id}:${index}`),
          deal_id: deal.id,
          command_name:
            eventName === "deal.won"
              ? "deal.mark_won"
              : eventName === "deal.lost"
                ? "deal.mark_lost"
                : "deal.move_stage_forward",
          from_stage: deal.stage,
          to_stage: deal.stage,
          from_status: deal.status,
          to_status: deal.status,
          actor_user_id: deal.user_id,
          assignment_id: null,
          reason: eventName === "deal.lost" ? "Customer selected a competing offer" : null,
          correlation_id: deterministicUuid(HISTORY_NS, `correlation:${deal.id}:${index}`),
          is_seed: true,
          created_at: occurredAt,
        });
        dealTransitionCount += 1;
      }
    }
  }

  let taskTransitionCount = 0;
  for (const task of tasks) {
    if (task.status === "to_do") continue;
    await upsert(client, "task_transitions", {
      id: deterministicUuid(HISTORY_NS, `task-transition:${task.id}`),
      task_id: task.id,
      command_name: "task.transition",
      from_status: "to_do",
      to_status: task.status,
      actor_user_id: null,
      assignment_id: null,
      reason: task.status === "cancelled" ? "No longer required" : null,
      correlation_id: deterministicUuid(HISTORY_NS, `task-correlation:${task.id}`),
      created_at: new Date().toISOString(),
    });
    taskTransitionCount += 1;
  }
  console.log(
    `Seeded ${activityCount} activity events, ${dealTransitionCount} deal transitions, ${taskTransitionCount} task transitions`,
  );
}

// ---------------------------------------------------------------------------
// 15. portal_customer_activities — the customer "next step" timeline
// ---------------------------------------------------------------------------
async function seedCustomerActivities(
  client: PoolClient,
  customers: Customer[],
  profiles: Profile[],
) {
  let count = 0;
  for (const customer of customers) {
    const actor = profiles.find((p) => p.id === customer.user_id) ?? profiles[0];
    await upsert(client, "portal_customer_activities", {
      id: deterministicUuid("customer-activity-v1", customer.id),
      customer_id: customer.id,
      partner_id: customer.partner_id,
      actor_id: actor?.id ?? null,
      actor_name: actor?.full_name ?? "LIVEY",
      summary: `Quarterly check-in completed with ${customer.company_name}.`,
      next_step: "Confirm renewal timeline and outstanding action items",
    });
    count += 1;
  }
  console.log(`Seeded ${count} customer activities`);
}

// ---------------------------------------------------------------------------
// 16. partner_review_notes — Partner Approvals workspace history
// ---------------------------------------------------------------------------
async function seedPartnerReviewNotes(
  client: PoolClient,
  partners: Partner[],
  superAdmin: Profile,
) {
  let count = 0;
  for (const partner of partners) {
    await upsert(client, "partner_review_notes", {
      id: deterministicUuid("partner-note-v1", partner.id),
      partner_id: partner.id,
      author_id: superAdmin.id,
      note: `Reviewed ${partner.company_name}'s application — currently ${partner.status.replace(/_/g, " ")}.`,
      status_change: partner.status,
      is_seed: true,
    });
    count += 1;
  }
  console.log(`Seeded ${count} partner review notes`);
}

// ---------------------------------------------------------------------------
// 17. assistant_messages — a short realistic chatbot transcript
// ---------------------------------------------------------------------------
async function seedAssistantMessages(client: PoolClient, deals: Deal[], profiles: Profile[]) {
  const user = profiles.find((p) => p.partner_id) ?? profiles[0];
  const deal = deals[0];
  if (!user || !deal) return;
  const conversationId = deterministicUuid("assistant-v1", `conversation:${user.id}`);
  const turns: Array<{ role: string; content: string; outcome: string | null }> = [
    { role: "user", content: "Show me my open deals", outcome: null },
    {
      role: "assistant",
      content: `You have ${deals.filter((d) => !["won", "lost"].includes(d.stage)).length} open deal(s), including ${deal.account_name}.`,
      outcome: "listed_deals",
    },
  ];
  let count = 0;
  for (const [index, turn] of turns.entries()) {
    await upsert(client, "assistant_messages", {
      id: deterministicUuid("assistant-v1", `message:${user.id}:${index}`),
      conversation_id: conversationId,
      user_id: user.id,
      assignment_id: null,
      role: turn.role,
      content: turn.content,
      proposed_action: null,
      action_payload: null,
      retrieved_deal_ids: turn.role === "assistant" ? [deal.id] : [],
      confirmed: null,
      outcome: turn.outcome,
      model: turn.role === "assistant" ? "auto-selected" : null,
      correlation_id: deterministicUuid("assistant-v1", `correlation:${user.id}:${index}`),
    });
    count += 1;
  }
  console.log(`Seeded ${count} assistant messages`);
}

// ---------------------------------------------------------------------------
// 18. Governed pricing/catalogue layer (products/variants/skus/price books/
//     price rows/combos) — no current UI reads these directly, but they are
//     part of the canonical data model (product.md §9.4/§18) and should not
//     sit empty when everything else is populated.
// ---------------------------------------------------------------------------
const GOVERNED_CATALOG_NS = "governed-catalog-v1";

async function seedGovernedCatalog(client: PoolClient) {
  const productDefs = [
    { code: "CLOUD-SUITE", name: "Cloud Suite", family: "Software" },
    { code: "DATA-PLATFORM", name: "Data Platform", family: "Software" },
    { code: "REMOTE-MONITORING", name: "Remote Monitoring", family: "Hardware" },
  ];

  const productIds: Record<string, string> = {};
  for (const product of productDefs) {
    const id = deterministicUuid(GOVERNED_CATALOG_NS, `product:${product.code}`);
    productIds[product.code] = id;
    await upsert(client, "products", {
      id,
      product_code: product.code,
      product_name: product.name,
      product_family: product.family,
      category: product.family,
      description: `${product.name} — governed catalogue entry.`,
      product_description: `${product.name} — governed catalogue entry.`,
      product_kind: "product",
      status: "active",
      version: 1,
      is_seed: true,
      updated_at: new Date().toISOString(),
    });
  }

  const variantIds: Record<string, string> = {};
  for (const product of productDefs) {
    const id = deterministicUuid(GOVERNED_CATALOG_NS, `variant:${product.code}`);
    variantIds[product.code] = id;
    await upsert(client, "product_variants", {
      id,
      product_id: productIds[product.code],
      variant_code: `${product.code}-STD`,
      variant_name: "Standard",
      variant_family: product.family,
      status: "active",
      version: 1,
      sort_order: 0,
      is_seed: true,
      updated_at: new Date().toISOString(),
    });
  }

  const skuIds: Record<string, string> = {};
  for (const product of productDefs) {
    const id = deterministicUuid(GOVERNED_CATALOG_NS, `sku:${product.code}`);
    skuIds[product.code] = id;
    const msrp = catalogUnitUsd(PRODUCT_TO_SKU[product.name] ?? "") || 1000;
    await upsert(client, "product_skus", {
      id,
      product_variant_id: variantIds[product.code],
      // Legacy column from the table's original (pre-governed) shape —
      // nothing reads it, but it is still NOT NULL with no default.
      sku: `${product.code}-STD-SKU`,
      sku_code: `${product.code}-STD-SKU`,
      currency_code: "USD",
      msrp_amount: msrp,
      partner_transfer_amount: Math.round(msrp * 0.85 * 100) / 100,
      discounted_transfer_amount: Math.round(msrp * 0.85 * 100) / 100,
      reward_eligible_amount: Math.round(msrp * 0.85 * 100) / 100,
      additional_discount_amount: 0,
      status: "active",
      version: 1,
      is_seed: true,
      updated_at: new Date().toISOString(),
    });
  }

  const priceBookId = deterministicUuid(GOVERNED_CATALOG_NS, "price-book:standard-usd");
  await upsert(client, "price_books", {
    id: priceBookId,
    price_book_code: "STANDARD-USD",
    price_book_name: "Standard USD Price Book",
    currency_code: "USD",
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: null,
    status: "active",
    version: 1,
    source: "seed",
    description: "Default governed price book for USD-denominated sales.",
    is_seed: true,
    updated_at: new Date().toISOString(),
  });

  let priceRowCount = 0;
  for (const product of productDefs) {
    const msrp = catalogUnitUsd(PRODUCT_TO_SKU[product.name] ?? "") || 1000;
    await upsert(client, "price_rows", {
      id: deterministicUuid(GOVERNED_CATALOG_NS, `price-row:${product.code}`),
      price_book_id: priceBookId,
      product_id: productIds[product.code],
      product_variant_id: variantIds[product.code],
      product_sku_id: skuIds[product.code],
      combo_id: null,
      row_kind: "sku",
      currency_code: "USD",
      msrp_amount: msrp,
      partner_transfer_amount: Math.round(msrp * 0.85 * 100) / 100,
      discount_amount: 0,
      discounted_transfer_amount: Math.round(msrp * 0.85 * 100) / 100,
      reward_eligible_amount: Math.round(msrp * 0.85 * 100) / 100,
      effective_from: new Date().toISOString().slice(0, 10),
      effective_to: null,
      status: "active",
      version: 1,
      is_seed: true,
      updated_at: new Date().toISOString(),
    });
    priceRowCount += 1;
  }

  const comboId = deterministicUuid(GOVERNED_CATALOG_NS, "combo:cloud-and-data");
  await upsert(client, "combos", {
    id: comboId,
    combo_code: "CLOUD-DATA-BUNDLE",
    combo_name: "Cloud Suite + Data Platform Bundle",
    currency_code: "USD",
    status: "active",
    version: 1,
    combo_description: "Bundled Cloud Suite and Data Platform licences at a blended rate.",
    bundle_msrp_amount:
      (catalogUnitUsd("Cloud Suite") || 1000) + (catalogUnitUsd("Data Platform") || 1000),
    bundle_transfer_amount:
      Math.round(
        ((catalogUnitUsd("Cloud Suite") || 1000) + (catalogUnitUsd("Data Platform") || 1000)) *
          0.8 *
          100,
      ) / 100,
    is_seed: true,
    updated_at: new Date().toISOString(),
  });

  let comboComponentCount = 0;
  for (const code of ["CLOUD-SUITE", "DATA-PLATFORM"]) {
    await upsert(client, "combo_components", {
      id: deterministicUuid(GOVERNED_CATALOG_NS, `combo-component:${code}`),
      combo_id: comboId,
      product_sku_id: skuIds[code],
      component_sku_id: skuIds[code],
      component_quantity: 1,
      quantity: 1,
      component_role: "included",
      sort_order: comboComponentCount,
      status: "active",
      version: 1,
      is_seed: true,
      updated_at: new Date().toISOString(),
    });
    comboComponentCount += 1;
  }

  console.log(
    `Seeded ${productDefs.length} governed products/variants/skus, 1 price book, ${priceRowCount} price rows, 1 combo (${comboComponentCount} components)`,
  );
}

// ---------------------------------------------------------------------------

async function run() {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await fixLegacyApprovedStage(client);

    const { partners, profiles, customers, deals } = await loadLiveState(client);
    if (partners.length === 0 || deals.length === 0) {
      throw new Error(
        "No partners/deals found — run `bun run db:bootstrap` first to seed the base fixture.",
      );
    }

    const superAdmin =
      profiles.find((p) => p.partner_id === null && p.email.includes("admin@livey.tech")) ??
      profiles[0];
    const liveyInternal = profiles.filter((p) => p.partner_id === null);

    await seedCatalog(client);
    await seedDealPricing(client, deals);
    await seedOutcomeReviews(client, deals);
    await seedParticipants(client, deals, customers, liveyInternal);
    await seedDiscountRequests(client, deals);
    const createdTasks = await seedTasks(client, deals, profiles);
    await seedTickets(client, partners, profiles);
    await seedLearning(client, profiles);
    await seedRewards(client, deals, profiles);
    await seedNews(client, superAdmin);
    await seedNotifications(client, deals, profiles);
    await seedDocuments(client, partners, deals, profiles);
    await seedAuditEvents(client, deals, superAdmin);
    await seedActivityAndTransitions(client, deals, createdTasks);
    await seedCustomerActivities(client, customers, profiles);
    await seedPartnerReviewNotes(client, partners, superAdmin);
    await seedAssistantMessages(client, deals, profiles);
    await seedGovernedCatalog(client);

    await client.query("COMMIT");
    console.log("Supplemental seed complete.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.main) {
  run()
    .then(() => console.log("Done."))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export { run as seedPhase1Supplement };
