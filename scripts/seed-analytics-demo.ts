import { pool } from "../src/server/postgres.server";

/**
 * Generates a realistic deal book so Analytics has something to analyse.
 *
 * The seeded fixtures create one deal per partner — eleven rows, all stamped
 * within a three-day window. That is enough to prove the app works and far too
 * little to tell whether a dashboard does: a twelve-month trend drawn over
 * three days is a dot, a win rate over three decisions swings 33 points per
 * deal, and "new vs existing business" is undefined when no customer has ever
 * bought twice.
 *
 * This script is ADDITIVE and IDEMPOTENT. Every row it writes carries the
 * `0000000a-` UUID prefix, which nothing else in the codebase uses, so it can
 * be re-run without duplicating and removed without touching the governed
 * demo fixtures (which use `00000006-`). Re-running produces byte-identical
 * rows: the generator is a seeded PRNG, never Math.random.
 *
 * Two properties matter more than volume:
 *
 *  1. created_at is always strictly before close_date. The existing fixtures
 *     violate this — their closed deals have close dates up to 20 days BEFORE
 *     the deal was created — which is why "avg days to close" had to exclude
 *     them and render an em-dash.
 *  2. Roughly a third of customers buy more than once, spread across months,
 *     so repeat business is a real signal rather than a constant.
 *
 * Usage: bun scripts/seed-analytics-demo.ts [--clean]
 */

const UUID_PREFIX = "0000000a";
const TARGET_DEALS = 240;
const MONTHS_OF_HISTORY = 18;

/** Deterministic PRNG. A seed script that used Math.random could not be re-run. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x11e7c0de);

const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const between = (min: number, max: number) => min + rand() * (max - min);
const intBetween = (min: number, max: number) => Math.floor(between(min, max + 1));

/** Stable UUID from an index, so a re-run updates rather than inserts. */
function seedUuid(index: number): string {
  return `${UUID_PREFIX}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/**
 * The funnel shape.
 *
 * Weighted so the board looks like a pipeline rather than a uniform
 * distribution: lots of early-stage noise, a narrowing middle, and a decided
 * tail. Won outnumbers lost about 2:1, which puts win rate near 65% — high but
 * plausible for a partner-sourced book, and it leaves the loss donut with
 * enough rows to have more than one slice.
 */
const STAGE_WEIGHTS: Array<{ stage: string; weight: number }> = [
  { stage: "sourced", weight: 14 },
  { stage: "demo", weight: 12 },
  { stage: "testing", weight: 9 },
  { stage: "qualified", weight: 8 },
  { stage: "proposal", weight: 7 },
  { stage: "negotiation", weight: 6 },
  { stage: "won", weight: 30 },
  { stage: "lost", weight: 14 },
];

const TOTAL_WEIGHT = STAGE_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);

function pickStage(): string {
  let roll = rand() * TOTAL_WEIGHT;
  for (const entry of STAGE_WEIGHTS) {
    roll -= entry.weight;
    if (roll <= 0) return entry.stage;
  }
  return "sourced";
}

/** Probability tracks stage — a negotiation deal at 0% is not a real record. */
const STAGE_PROBABILITY: Record<string, [number, number]> = {
  sourced: [0, 25],
  demo: [25, 50],
  testing: [25, 50],
  qualified: [50, 58],
  proposal: [50, 72],
  negotiation: [64, 72],
  won: [100, 100],
  lost: [0, 0],
};

const LOSS_REASONS = [
  "Price too high",
  "Budget constraints",
  "Feature limitations",
  "Chose a competitor",
  "Lost urgency / no decision",
  "Timing — revisit later",
  "Other",
];

/** Weighted so the donut has a dominant reason rather than seven equal slices. */
const LOSS_WEIGHTS = [26, 21, 18, 14, 10, 8, 3];

function pickLossReason(): string {
  const total = LOSS_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  let roll = rand() * total;
  for (let index = 0; index < LOSS_REASONS.length; index += 1) {
    roll -= LOSS_WEIGHTS[index];
    if (roll <= 0) return LOSS_REASONS[index];
  }
  return "Other";
}

const LOSS_DETAIL: Record<string, string[]> = {
  "Price too high": [
    "Quoted 18% above the budget the sponsor had signed off.",
    "Procurement pushed back on unit price after the second review.",
  ],
  "Budget constraints": [
    "Capex freeze announced two weeks before the close date.",
    "Budget reallocated to a compliance programme mid-cycle.",
  ],
  "Feature limitations": [
    "Needed multi-site failover we do not ship yet.",
    "Blocked on an integration with their existing ERP.",
  ],
  "Chose a competitor": [
    "Incumbent matched on price and offered onsite support.",
    "Selected a regional vendor with a faster install window.",
  ],
  "Lost urgency / no decision": [
    "Sponsor changed roles and the project lost its owner.",
    "Evaluation stalled after the pilot; no decision date set.",
  ],
  "Timing — revisit later": [
    "Deferred to the next fiscal year, contact stays warm.",
    "Site readiness slipped; agreed to re-engage in two quarters.",
  ],
  Other: ["Closed at the customer's request without a stated reason."],
};

const SOURCES = ["Partner sourced", "Inbound", "Field event", "Referral", "Outbound"];
const REGIONS = ["North", "South", "East", "West", "India"];
const CONTACT_FIRST = [
  "Aarav",
  "Diya",
  "Rohan",
  "Ishita",
  "Kabir",
  "Ananya",
  "Vikram",
  "Meera",
  "Arjun",
  "Nisha",
  "Rahul",
  "Tara",
  "Aditya",
  "Sanya",
  "Dev",
  "Priya",
];
const CONTACT_LAST = [
  "Sharma",
  "Nair",
  "Reddy",
  "Chopra",
  "Menon",
  "Bose",
  "Iyer",
  "Kulkarni",
  "Rao",
  "Verma",
  "Joshi",
  "Ghosh",
  "Pillai",
  "Sethi",
];

const ACCOUNT_PREFIX = [
  "Vertex",
  "Harbor",
  "Northstar",
  "BluePeak",
  "SummitFlow",
  "Meridian",
  "Ironclad",
  "Quantum",
  "Solstice",
  "Coral Bay",
  "Lighthouse",
  "Redwood",
  "Cobalt",
  "Everest",
  "Nimbus",
  "Orion",
  "Pinnacle",
  "Sterling",
];
const ACCOUNT_SUFFIX = [
  "Logistics",
  "Healthcare",
  "Retail Group",
  "Manufacturing",
  "Hospitality",
  "Energy",
  "Financial",
  "Education",
  "Infrastructure",
  "Media",
];

const DEAL_MOTION = [
  "Expansion",
  "New site rollout",
  "Renewal upgrade",
  "Pilot conversion",
  "Refresh programme",
  "Multi-site deployment",
];

type Ref = { id: string; label: string; partnerId: string | null };

async function loadReferences() {
  const [partners, customers, owners, products] = await Promise.all([
    pool.query(`SELECT id, company_name FROM partners ORDER BY company_name`),
    pool.query(`SELECT id, company_name, partner_id, country FROM portal_customers ORDER BY id`),
    pool.query(
      `SELECT id, full_name, partner_id FROM profiles
       WHERE partner_id IS NOT NULL AND full_name IS NOT NULL ORDER BY id`,
    ),
    pool.query(`SELECT sku, product_name, list_price FROM portal_catalog_items ORDER BY sku`),
  ]);

  return {
    partners: partners.rows.map((row) => ({
      id: String(row.id),
      label: String(row.company_name ?? "Partner"),
      partnerId: String(row.id),
    })) as Ref[],
    customers: customers.rows.map((row) => ({
      id: String(row.id),
      label: String(row.company_name ?? "Customer"),
      partnerId: row.partner_id ? String(row.partner_id) : null,
    })) as Ref[],
    owners: owners.rows.map((row) => ({
      id: String(row.id),
      label: String(row.full_name),
      partnerId: row.partner_id ? String(row.partner_id) : null,
    })) as Ref[],
    products: products.rows.map((row) => ({
      sku: String(row.sku),
      name: String(row.product_name),
      price: Number(String(row.list_price).replace(/[^0-9.]/g, "")) || 2500,
    })),
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function main() {
  const clean = process.argv.includes("--clean");

  if (clean) {
    const { rowCount } = await pool.query(`DELETE FROM portal_deals WHERE id::text LIKE $1`, [
      `${UUID_PREFIX}-%`,
    ]);
    console.log(`[seed-analytics] removed ${rowCount ?? 0} previously generated deals`);
    await pool.end();
    return;
  }

  const refs = await loadReferences();
  if (refs.customers.length === 0 || refs.owners.length === 0 || refs.products.length === 0) {
    throw new Error(
      "No customers, owners or catalog items found — run `bun run db:bootstrap` before seeding analytics data.",
    );
  }

  const now = new Date();
  const horizonStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTHS_OF_HISTORY, 1),
  );

  // A third of customers are repeat buyers. Without this every won deal is a
  // first purchase and "new vs existing business" is pinned at 100%.
  const repeatCustomers = refs.customers.filter((_, index) => index % 3 === 0);

  const rows: unknown[][] = [];

  for (let index = 0; index < TARGET_DEALS; index += 1) {
    const stage = pickStage();
    const isWon = stage === "won";
    const isLost = stage === "lost";
    const isClosed = isWon || isLost;

    // Created somewhere in the history window, weighted slightly toward
    // recent months so the pipeline isn't uniformly ancient.
    const ageSkew = rand() ** 0.75;
    const createdAt = new Date(
      horizonStart.getTime() + ageSkew * (now.getTime() - horizonStart.getTime()),
    );

    // The invariant the existing fixtures break: a deal cannot close before it
    // is created. Sales cycles run 12–140 days, longer for bigger deals.
    const cycleDays = Math.round(between(12, 140));
    const closeDate = new Date(createdAt.getTime() + cycleDays * 86_400_000);

    // Open deals forecast forward from today rather than from creation, or
    // the projection chart would be entirely in the past.
    const forecastDate = new Date(now.getTime() + intBetween(-20, 330) * 86_400_000);

    const customer =
      rand() < 0.35 && repeatCustomers.length > 0 ? pick(repeatCustomers) : pick(refs.customers);
    const partnerId = customer.partnerId ?? pick(refs.partners).id;
    const ownersForPartner = refs.owners.filter((owner) => owner.partnerId === partnerId);
    const owner = ownersForPartner.length > 0 ? pick(ownersForPartner) : pick(refs.owners);
    const product = pick(refs.products);

    const quantity = intBetween(1, 24);
    // Log-ish spread so a few large deals dominate value without every deal
    // being either tiny or enormous.
    const unit = product.price * between(0.85, 1.35);
    const amountUsd = Math.round(unit * quantity);

    const [probMin, probMax] = STAGE_PROBABILITY[stage] ?? [0, 50];
    const probability = probMin === probMax ? probMin : intBetween(probMin, probMax);

    const accountName = `${pick(ACCOUNT_PREFIX)} ${pick(ACCOUNT_SUFFIX)} — ${pick(DEAL_MOTION)}`;
    const contactName = `${pick(CONTACT_FIRST)} ${pick(CONTACT_LAST)}`;

    const lossCategory = isLost ? pickLossReason() : null;
    const lossDetail = lossCategory ? pick(LOSS_DETAIL[lossCategory] ?? ["Closed lost."]) : null;

    const status = isWon ? "won" : isLost ? "lost" : rand() < 0.7 ? "approved" : "submitted";

    rows.push([
      seedUuid(index),
      accountName,
      customer.id,
      contactName,
      owner.id,
      owner.label,
      "India",
      pick(REGIONS),
      product.name,
      stage,
      status,
      quantity,
      `$${amountUsd.toLocaleString("en-US")}`,
      "USD",
      amountUsd,
      amountUsd,
      1,
      "manual",
      createdAt.toISOString(),
      `$${Math.round(amountUsd * between(0.9, 1.25)).toLocaleString("en-US")}`,
      probability,
      isClosed ? isoDate(closeDate) : isoDate(forecastDate),
      isClosed ? isoDate(closeDate) : isoDate(forecastDate),
      pick(SOURCES),
      isClosed ? `Closed ${stage}` : `Stage: ${stage}`,
      isLost ? String(lossDetail) : `Generated demo deal for analytics.`,
      partnerId,
      false,
      5,
      stage !== "sourced",
      lossCategory,
      lossDetail,
      1,
      true,
      createdAt.toISOString(),
      (isClosed ? closeDate : createdAt).toISOString(),
    ]);
  }

  const columns = [
    "id",
    "account_name",
    "customer_id",
    "contact_name",
    "poc_profile_id",
    "owner_name",
    "country",
    "region",
    "product",
    "stage",
    "status",
    "quantity",
    "amount",
    "currency_code",
    "amount_value",
    "amount_usd",
    "fx_rate",
    "fx_provider",
    "fx_rate_fetched_at",
    "customer_budget",
    "probability",
    "possible_close_date",
    "close_date",
    "source",
    "last_touch",
    "notes",
    "partner_id",
    "is_hidden_to_team",
    "reward_rate_percent",
    "commercial_approved",
    "loss_reason_category",
    "loss_reason_detail",
    "version",
    "is_seed",
    "created_at",
    "updated_at",
  ];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      const assignments = columns
        .filter((column) => column !== "id")
        .map((column) => `"${column}" = EXCLUDED."${column}"`)
        .join(", ");
      await client.query(
        `INSERT INTO portal_deals (${columns.map((c) => `"${c}"`).join(", ")})
         VALUES (${placeholders})
         ON CONFLICT (id) DO UPDATE SET ${assignments}`,
        row,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const summary = await pool.query(
    `SELECT stage, count(*)::int AS n, round(sum(amount_usd))::int AS usd
     FROM portal_deals WHERE id::text LIKE $1 GROUP BY stage ORDER BY stage`,
    [`${UUID_PREFIX}-%`],
  );
  console.log(`[seed-analytics] wrote ${rows.length} deals across ${MONTHS_OF_HISTORY} months`);
  console.table(summary.rows);

  const sanity = await pool.query(
    `SELECT count(*)::int AS broken FROM portal_deals
     WHERE id::text LIKE $1 AND stage IN ('won','lost') AND close_date < created_at::date`,
    [`${UUID_PREFIX}-%`],
  );
  console.log(
    `[seed-analytics] closed deals with close_date before created_at: ${sanity.rows[0].broken}`,
  );

  await pool.end();
}

main().catch((error) => {
  console.error("[seed-analytics] failed", error);
  process.exit(1);
});
