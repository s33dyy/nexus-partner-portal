import { pool } from "../src/server/postgres.server";

/**
 * The real LIVEY product catalogue, as published on liveytech.com.
 *
 * Sourced from the live site's own category pages on 2026-08-20:
 *   /wired-category-page      Audixa wired headsets
 *   /wireless-category-page   Audixa wireless headsets
 *   /webcam-category-page     RealSight webcams and video bars
 *   /savvi-aurix              SAVVI combos and AURIX docking hubs
 *   /headset-accessories      LT- spares and adapters
 *   /smartpack-essentials     SmartPack bundles
 *
 * PRICING IS DELIBERATELY ABSENT. liveytech.com publishes no prices — it is a
 * quote-based B2B catalogue, and the WooCommerce records carry no price fields
 * either. Inventing numbers would put fabricated figures in front of partners
 * and straight into deal values, so `list_price` and `margin` say so in words.
 * `parseMoneyText` (dropdown-sources.server.ts) already returns null for
 * unparseable text, which is the correct answer here rather than a wrong one.
 * Fill these in from the real price book and re-run.
 *
 * Every row carries the `0000000b-` UUID prefix, used by nothing else, so this
 * upserts rather than duplicates and `--clean` removes exactly what it wrote.
 * The ten pre-existing demo items (LIV-CLD-100 etc.) are left alone.
 *
 * Usage: bun scripts/seed-livey-catalog.ts [--clean]
 */

const UUID_PREFIX = "0000000b";
const PRICE_PLACEHOLDER = "Contact for pricing";
const MARGIN_PLACEHOLDER = "Per price book";

type Product = { code: string; name: string };

const CATALOG: Array<{
  category: string;
  tier: string;
  benefits: string;
  skuPrefix: string;
  products: Product[];
}> = [
  {
    category: "Wired Headsets",
    tier: "registered",
    benefits: "AI-driven noise cancelling wired headset for professional communication.",
    skuPrefix: "LIV-AUD",
    products: [
      { code: "AUDIXA-303", name: "Audixa 303 Series" },
      { code: "AUDIXA-311", name: "Audixa 311 Series" },
      { code: "AUDIXA-320P", name: "Audixa 320 Plus Series" },
      { code: "AUDIXA-410P", name: "Audixa 410 Plus Series" },
      { code: "AUDIXA-420P", name: "Audixa 420 Plus Series" },
      { code: "AUDIXA-500", name: "Audixa 500 Series" },
      { code: "AUDIXA-510", name: "Audixa 510 Series" },
      { code: "AUDIXA-550", name: "Audixa 550 Series" },
      { code: "AUDIXA-600", name: "Audixa 600 Series" },
      { code: "AUDIXA-800", name: "Audixa 800 Series" },
      { code: "AUDIXA-815", name: "Audixa 815 Series" },
    ],
  },
  {
    category: "Wireless Headsets",
    tier: "registered",
    benefits: "AI-driven noise cancelling wireless headset for professional communication.",
    skuPrefix: "LIV-AUD",
    products: [
      { code: "AUDIXA-710BTP", name: "Audixa 710BT Plus Series" },
      { code: "AUDIXA-712BT", name: "Audixa 712BT Series" },
      { code: "AUDIXA-715BT", name: "Audixa 715BT Series" },
      { code: "AUDIXA-716CS", name: "Audixa 716CS Series" },
      { code: "AUDIXA-720BT", name: "Audixa 720BT Series" },
      { code: "AUDIXA-910BT", name: "Audixa 910BT Series" },
      { code: "AUDIXA-950BT", name: "Audixa 950BT Series" },
      { code: "AUDIXA-CS200", name: "Audixa CS200 Series" },
      { code: "AUDIXA-CS300", name: "Audixa CS300 Series" },
      { code: "AUDIXA-OE750BT", name: "Audixa OpenEar 750BT Series" },
    ],
  },
  {
    category: "Video & Webcams",
    tier: "silver",
    benefits: "AI-driven ultra HD meeting room video for hybrid collaboration.",
    skuPrefix: "LIV-RS",
    products: [
      { code: "RS-WCH100", name: "RealSight Hellosync WCH100" },
      { code: "RS-WC300", name: "RealSight WC300" },
      { code: "RS-WC350", name: "RealSight WC350" },
      { code: "RS-WC400", name: "RealSight WC400 Wide Angle" },
      { code: "RS-WC450", name: "RealSight WC450" },
      { code: "RS-EPTZ500", name: "RealSight ePTZ500 Video Bar" },
    ],
  },
  {
    category: "Combos & Docking",
    tier: "silver",
    benefits: "Keyboard, mouse and docking bundles for desk and hybrid setups.",
    skuPrefix: "LIV-SAV",
    products: [
      { code: "AURIX-HB-C410", name: "AURIX HB-C410 Portable Docking Hub" },
      { code: "AURIX-HB-CB10", name: "AURIX HB-CB10 Portable Docking Hub" },
      { code: "SAVVI-CB100X", name: "SAVVI CB100X Professional Wireless Combo" },
      { code: "SAVVI-CB10C", name: "SAVVI CB10C Wired Combo" },
      { code: "SAVVI-CB15C", name: "SAVVI CB15C Wired Combo" },
      { code: "SAVVI-CB50W", name: "SAVVI CB50W Wireless Combo" },
      { code: "SAVVI-CB70W", name: "SAVVI CB70W Wireless Combo" },
      { code: "SAVVI-CB75W", name: "SAVVI CB75W Wireless Combo" },
    ],
  },
  {
    category: "SmartPack Bundles",
    tier: "registered",
    benefits: "SmartPack Essentials bundle for travel, commute and remote work.",
    skuPrefix: "LIV-SP",
    products: [
      { code: "SP-950BT", name: "SmartPack 950BT Series" },
      { code: "SP-712BTM", name: "SmartPack Essential 712BTM Series Headset" },
      { code: "SP-910BT", name: "SmartPack Essential 910BT Series" },
      { code: "SP-G300BT", name: "SmartPack Essential G300BT Gaming Series" },
      { code: "SP-G300DU", name: "SmartPack Essential G300DU Wired Gaming Headset" },
      { code: "SP-OE750BT", name: "SmartPack Essential OpenEar 750BT Headset" },
      { code: "SP-OE760BT", name: "SmartPack Essential OpenEar 760BT Earbuds" },
      { code: "SP-TAG200", name: "SmartPack Essentials Smart Tag-200" },
    ],
  },
  {
    category: "Accessories",
    tier: "registered",
    benefits: "Spare parts, cables and adapters for LIVEY headsets.",
    skuPrefix: "LIV-ACC",
    products: [
      { code: "LT-BA22", name: "LT-BA22 Headset Accessory" },
      { code: "LT-BA30P", name: "LT-BA30P Headset Accessory" },
      { code: "LT-BY30", name: "LT-BY30 Headset Accessory" },
      { code: "LT-BY31", name: "LT-BY31 Headset Accessory" },
      { code: "LT-BY32", name: "LT-BY32 Headset Accessory" },
      { code: "LT-U001P", name: "LT-U001P Headset Cable" },
      { code: "LT-U004P", name: "LT-U004P Headset Cable" },
      { code: "LT-U005P", name: "LT-U005P Headset Cable" },
      { code: "LT-U009FP", name: "LT-U009FP Headset Cable" },
      { code: "LT-U009GP", name: "LT-U009GP Headset Cable" },
      { code: "LT-UA010P", name: "LT-UA010P USB Adapter" },
      { code: "LT-UA010PM", name: "LT-UA010PM USB Adapter" },
      { code: "LT-UA020", name: "LT-UA020 USB Adapter" },
      { code: "LT-UA023", name: "LT-UA023 USB Adapter" },
    ],
  },
];

function seedUuid(index: number): string {
  return `${UUID_PREFIX}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function main() {
  if (process.argv.includes("--clean")) {
    const { rowCount } = await pool.query(
      `DELETE FROM portal_catalog_items WHERE id::text LIKE $1`,
      [`${UUID_PREFIX}-%`],
    );
    console.log(`[seed-catalog] removed ${rowCount ?? 0} imported catalogue items`);
    await pool.end();
    return;
  }

  const columns = [
    "id",
    "sku",
    "product_name",
    "category",
    "partner_tier",
    "list_price",
    "margin",
    "stock",
    "availability",
    "benefits",
    "catalog_kind",
    "product_code",
    "currency_code",
    "price_book_code",
    "price_book_version",
    "product_status",
    "is_seed",
  ];

  let index = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const group of CATALOG) {
      for (const product of group.products) {
        const row = [
          seedUuid(index),
          `${group.skuPrefix}-${product.code}`,
          product.name,
          group.category,
          group.tier,
          PRICE_PLACEHOLDER,
          MARGIN_PLACEHOLDER,
          0,
          // Stock is not published either; "made to order" is accurate for a
          // quote-based catalogue and avoids implying shelf availability.
          "made_to_order",
          group.benefits,
          "product",
          product.code,
          "USD",
          "LIVEY-2026",
          1,
          "active",
          true,
        ];
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
        const assignments = columns
          .filter((c) => c !== "id")
          .map((c) => `"${c}" = EXCLUDED."${c}"`)
          .join(", ");
        await client.query(
          `INSERT INTO portal_catalog_items (${columns.map((c) => `"${c}"`).join(", ")})
           VALUES (${placeholders})
           ON CONFLICT (id) DO UPDATE SET ${assignments}, updated_at = now()`,
          row,
        );
        index += 1;
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const summary = await pool.query(
    `SELECT category, count(*)::int AS items FROM portal_catalog_items
     WHERE id::text LIKE $1 GROUP BY category ORDER BY category`,
    [`${UUID_PREFIX}-%`],
  );
  console.log(`[seed-catalog] upserted ${index} products from liveytech.com`);
  console.table(summary.rows);

  const dupes = await pool.query(
    `SELECT sku, count(*)::int AS n FROM portal_catalog_items GROUP BY sku HAVING count(*) > 1`,
  );
  console.log(`[seed-catalog] duplicate SKUs across the whole catalogue: ${dupes.rowCount ?? 0}`);

  await pool.end();
}

main().catch((error) => {
  console.error("[seed-catalog] failed", error);
  process.exit(1);
});
