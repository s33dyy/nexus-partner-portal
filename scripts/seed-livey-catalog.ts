import { pool } from "../src/server/postgres.server";

/**
 * The real LIVEY product catalogue, scraped from liveytech.com on 2026-08-20.
 *
 * Sources, per category, are the site's own pages rather than its WooCommerce
 * records — /wp-json/wp/v2/product returns only ten items and all of them use
 * the retired SAVVY/Splendor/Stellar naming, while the live category pages
 * carry the current Audixa, RealSight, SAVVI and SmartPack lines:
 *
 *   /wired-category-page  /wireless-category-page  /webcam-category-page
 *   /savvi-aurix          /headset-accessories     /smartpack-essentials
 *   /livey-lt-g300-gaming-series-headset
 *
 * CATEGORIES COME FROM THE SOURCE PAGE, not from the product name. A name
 * heuristic put Audixa 716CS in Wired because its model token carries neither
 * "BT" nor a leading "CS"; the site lists it under Wireless. The page a
 * product is published on is the only authority on that, so the scrape
 * records it and this table preserves it.
 *
 * PRICING IS DELIBERATELY ABSENT. liveytech.com publishes no prices — it is a
 * quote-based B2B catalogue and the WooCommerce records carry no price fields
 * either. These values feed deal amounts and partner-facing screens, so a
 * plausible-looking wrong number is worse than an obvious blank.
 * parseMoneyText already yields null for unparseable text, which is correct
 * here. Fill them from the real price book and re-run.
 *
 * Every row carries the `0000000b-` UUID prefix, used by nothing else, so this
 * upserts rather than duplicates and `--clean` removes exactly what it wrote.
 *
 * Usage: bun scripts/seed-livey-catalog.ts [--clean]
 */

const UUID_PREFIX = "0000000b";
const PRICE_PLACEHOLDER = "Contact for pricing";
const MARGIN_PLACEHOLDER = "Per price book";

/** Tier and blurb per category; the site states neither, so these are ours. */
const CATEGORY_META: Record<string, { tier: string; benefits: string }> = {
  "Wired Headsets": {
    tier: "registered",
    benefits: "AI-driven noise cancelling wired headset for professional communication.",
  },
  "Wireless Headsets": {
    tier: "registered",
    benefits: "AI-driven noise cancelling wireless headset for professional communication.",
  },
  "Video & Webcams": {
    tier: "silver",
    benefits: "AI-driven ultra HD meeting room video for hybrid collaboration.",
  },
  "Combos & Docking": {
    tier: "silver",
    benefits: "Keyboard, mouse and docking bundles for desk and hybrid setups.",
  },
  "SmartPack Bundles": {
    tier: "registered",
    benefits: "SmartPack Essentials bundle for travel, commute and remote work.",
  },
  "Gaming Headsets": {
    tier: "registered",
    benefits: "High-resolution gaming headset with immersive audio.",
  },
  Accessories: {
    tier: "registered",
    benefits: "Spare parts, cables and adapters for LIVEY headsets.",
  },
};

type Product = { category: string; code: string; sku: string; name: string; image: string };

const PRODUCTS: Product[] = [
  {
    category: "Combos & Docking",
    code: "AURIX-HB-C410",
    sku: "LIV-SAV-AURIX-HB-C410",
    name: "AURIX HB-C410 Portable Docking Hub",
    image: "https://liveytech.com/wp-content/uploads/2026/06/16.jpg",
  },
  {
    category: "Combos & Docking",
    code: "AURIX-HB-CB10",
    sku: "LIV-SAV-AURIX-HB-CB10",
    name: "AURIX HB-CB10 Portable Docking Hub",
    image: "https://liveytech.com/wp-content/uploads/2026/06/15.jpg",
  },
  {
    category: "Wired Headsets",
    code: "AUDIXA-303",
    sku: "LIV-AUD-AUDIXA-303",
    name: "Audixa 303 Series",
    image: "https://liveytech.com/wp-content/uploads/2025/03/Artboard-2-3-768x797.jpg",
  },
  {
    category: "Wired Headsets",
    code: "AUDIXA-311",
    sku: "LIV-AUD-AUDIXA-311",
    name: "Audixa 311 Series",
    image: "https://liveytech.com/wp-content/uploads/2025/03/Artboard-4-768x797.jpg",
  },
  {
    category: "Wired Headsets",
    code: "AUDIXA-320P",
    sku: "LIV-AUD-AUDIXA-320P",
    name: "Audixa 320 Plus Series",
    image: "https://liveytech.com/wp-content/uploads/2026/02/320.jpg.jpeg",
  },
  {
    category: "Wired Headsets",
    code: "AUDIXA-410P",
    sku: "LIV-AUD-AUDIXA-410P",
    name: "Audixa 410 Plus Series",
    image: "https://liveytech.com/wp-content/uploads/2025/04/new-768x797.jpg",
  },
  {
    category: "Wired Headsets",
    code: "AUDIXA-420P",
    sku: "LIV-AUD-AUDIXA-420P",
    name: "Audixa 420 Plus Series",
    image: "https://liveytech.com/wp-content/uploads/2025/03/Artboard-3-768x797.jpg",
  },
  {
    category: "Wired Headsets",
    code: "AUDIXA-500",
    sku: "LIV-AUD-AUDIXA-500",
    name: "Audixa 500 Series",
    image: "https://liveytech.com/wp-content/uploads/2025/03/Artboard-5-768x797.jpg",
  },
  {
    category: "Wired Headsets",
    code: "AUDIXA-510",
    sku: "LIV-AUD-AUDIXA-510",
    name: "Audixa 510 Series",
    image: "https://liveytech.com/wp-content/uploads/2025/03/Artboard-7-768x797.jpg",
  },
  {
    category: "Wired Headsets",
    code: "AUDIXA-550",
    sku: "LIV-AUD-AUDIXA-550",
    name: "Audixa 550 Series",
    image: "https://liveytech.com/wp-content/uploads/2025/03/Artboard-8-768x797.jpg",
  },
  {
    category: "Wired Headsets",
    code: "AUDIXA-600",
    sku: "LIV-AUD-AUDIXA-600",
    name: "Audixa 600 Series",
    image: "https://liveytech.com/wp-content/uploads/2025/10/600dm_-768x797.png",
  },
  {
    category: "Wireless Headsets",
    code: "AUDIXA-710BTP",
    sku: "LIV-AUD-AUDIXA-710BTP",
    name: "Audixa 710BT Plus Series",
    image: "https://liveytech.com/wp-content/uploads/2025/03/Artboard-2-4-768x797.jpg",
  },
  {
    category: "Wireless Headsets",
    code: "AUDIXA-712BT",
    sku: "LIV-AUD-AUDIXA-712BT",
    name: "Audixa 712BT Series",
    image: "https://liveytech.com/wp-content/uploads/2025/03/Artboard-5-1-768x797.jpg",
  },
  {
    category: "Wireless Headsets",
    code: "AUDIXA-715BT",
    sku: "LIV-AUD-AUDIXA-715BT",
    name: "Audixa 715BT Series",
    image: "https://liveytech.com/wp-content/uploads/2025/03/Artboard-8-1-768x797.jpg",
  },
  {
    category: "Wireless Headsets",
    code: "AUDIXA-716CS",
    sku: "LIV-AUD-AUDIXA-716CS",
    name: "Audixa 716CS Series",
    image: "https://liveytech.com/wp-content/uploads/2025/03/Artboard-9-2-768x797.jpg",
  },
  {
    category: "Wireless Headsets",
    code: "AUDIXA-720BT",
    sku: "LIV-AUD-AUDIXA-720BT",
    name: "Audixa 720BT Series",
    image: "https://liveytech.com/wp-content/uploads/2025/03/Artboard-3-1-768x797.jpg",
  },
  {
    category: "Wired Headsets",
    code: "AUDIXA-800",
    sku: "LIV-AUD-AUDIXA-800",
    name: "Audixa 800 Series",
    image: "https://liveytech.com/wp-content/uploads/2025/03/Artboard-9-1-768x797.jpg",
  },
  {
    category: "Wired Headsets",
    code: "AUDIXA-815",
    sku: "LIV-AUD-AUDIXA-815",
    name: "Audixa 815 Series",
    image: "https://liveytech.com/wp-content/uploads/2025/04/815-new-768x797.jpg",
  },
  {
    category: "Wireless Headsets",
    code: "AUDIXA-910BT",
    sku: "LIV-AUD-AUDIXA-910BT",
    name: "Audixa 910BT Series",
    image: "https://liveytech.com/wp-content/uploads/2025/04/910bt-png-768x797.png",
  },
  {
    category: "Wireless Headsets",
    code: "AUDIXA-950BT",
    sku: "LIV-AUD-AUDIXA-950BT",
    name: "Audixa 950BT Series",
    image: "https://liveytech.com/wp-content/uploads/2026/02/950BT-Web.png",
  },
  {
    category: "Wireless Headsets",
    code: "AUDIXA-CS200",
    sku: "LIV-AUD-AUDIXA-CS200",
    name: "Audixa CS200 Series",
    image: "https://liveytech.com/wp-content/uploads/2025/03/Artboard-10-2-768x797.jpg",
  },
  {
    category: "Wireless Headsets",
    code: "AUDIXA-CS300",
    sku: "LIV-AUD-AUDIXA-CS300",
    name: "Audixa CS300 Series",
    image: "https://liveytech.com/wp-content/uploads/2025/09/CS300_Front_image-768x797.jpg",
  },
  {
    category: "Wireless Headsets",
    code: "AUDIXA-OPENEAR750BT",
    sku: "LIV-AUD-AUDIXA-OPENEAR750BT",
    name: "Audixa OpenEar 750BT Series",
    image: "https://liveytech.com/wp-content/uploads/2026/02/11-768x797.jpg",
  },
  {
    category: "Accessories",
    code: "LT-BA22",
    sku: "LIV-ACC-LT-BA22",
    name: "LT-BA22 Headset Accessory",
    image: "https://liveytech.com/wp-content/uploads/2024/06/LIVEY-LT-BA22-1024x1024.jpg",
  },
  {
    category: "Accessories",
    code: "LT-BA30P",
    sku: "LIV-ACC-LT-BA30P",
    name: "LT-BA30P Headset Accessory",
    image: "https://liveytech.com/wp-content/uploads/2024/06/LIVEY-LT-BA30P-1-1024x1024.jpg",
  },
  {
    category: "Accessories",
    code: "LT-BY30",
    sku: "LIV-ACC-LT-BY30",
    name: "LT-BY30 Headset Accessory",
    image: "https://liveytech.com/wp-content/uploads/2024/06/LIVEY-LT-BY30-1024x1024.jpg",
  },
  {
    category: "Accessories",
    code: "LT-BY31",
    sku: "LIV-ACC-LT-BY31",
    name: "LT-BY31 Headset Accessory",
    image: "https://liveytech.com/wp-content/uploads/2024/06/LIVEY-LT-BY31-1024x1024.jpg",
  },
  {
    category: "Accessories",
    code: "LT-BY32",
    sku: "LIV-ACC-LT-BY32",
    name: "LT-BY32 Headset Accessory",
    image: "https://liveytech.com/wp-content/uploads/2024/06/LIVEY-LT-BY32-1024x1024.jpg",
  },
  {
    category: "Gaming Headsets",
    code: "LT-G300",
    sku: "LIV-GAM-LT-G300",
    name: "LIVEY LT-G300 Gaming Series Headset",
    image: "https://liveytech.com/wp-content/uploads/2024/07/748x776-1.jpg",
  },
  {
    category: "Accessories",
    code: "LT-U001P",
    sku: "LIV-ACC-LT-U001P",
    name: "LT-U001P Headset Accessory",
    image: "https://liveytech.com/wp-content/uploads/2024/06/LIVEY-LT-U001P-1024x1024.jpg",
  },
  {
    category: "Accessories",
    code: "LT-U004P",
    sku: "LIV-ACC-LT-U004P",
    name: "LT-U004P Headset Accessory",
    image:
      "https://liveytech.com/wp-content/uploads/2024/07/WhatsApp-Image-2024-07-12-at-10.53.51-AM-1-1024x1024.jpeg",
  },
  {
    category: "Accessories",
    code: "LT-U005P",
    sku: "LIV-ACC-LT-U005P",
    name: "LT-U005P Headset Accessory",
    image: "https://liveytech.com/wp-content/uploads/2024/06/LIVEY-LT-U005P-1024x1024.jpg",
  },
  {
    category: "Accessories",
    code: "LT-U009FP",
    sku: "LIV-ACC-LT-U009FP",
    name: "LT-U009FP Headset Accessory",
    image: "https://liveytech.com/wp-content/uploads/2024/06/LIVEY-LT-U009FP-1024x1024.jpg",
  },
  {
    category: "Accessories",
    code: "LT-U009GP",
    sku: "LIV-ACC-LT-U009GP",
    name: "LT-U009GP Headset Accessory",
    image: "https://liveytech.com/wp-content/uploads/2024/06/LIVEY-LT-U009GP-1024x1024.jpg",
  },
  {
    category: "Accessories",
    code: "LT-UA010P",
    sku: "LIV-ACC-LT-UA010P",
    name: "LT-UA010P Headset Accessory",
    image: "https://liveytech.com/wp-content/uploads/2024/06/LIVEY-LT-UA010P-1024x1024.jpg",
  },
  {
    category: "Accessories",
    code: "LT-UA010PM",
    sku: "LIV-ACC-LT-UA010PM",
    name: "LT-UA010PM Headset Accessory",
    image: "https://liveytech.com/wp-content/uploads/2024/06/LIVEY-LT-UA010PM-1024x1024.jpg",
  },
  {
    category: "Accessories",
    code: "LT-UA020",
    sku: "LIV-ACC-LT-UA020",
    name: "LT-UA020 Headset Accessory",
    image: "https://liveytech.com/wp-content/uploads/2024/06/LIVEY-LT-UA020-1024x1024.jpg",
  },
  {
    category: "Accessories",
    code: "LT-UA023",
    sku: "LIV-ACC-LT-UA023",
    name: "LT-UA023 Headset Accessory",
    image: "https://liveytech.com/wp-content/uploads/2024/06/LIVEY-LT-UA023-1024x1024.jpg",
  },
  {
    category: "Video & Webcams",
    code: "RS-WCH100",
    sku: "LIV-RS-RS-WCH100",
    name: "RealSight Hellosync WCH100",
    image: "https://liveytech.com/wp-content/uploads/2025/03/WCH100-2-768x797.jpg",
  },
  {
    category: "Video & Webcams",
    code: "RS-WC300",
    sku: "LIV-RS-RS-WC300",
    name: "RealSight WC300",
    image: "https://liveytech.com/wp-content/uploads/2025/11/wc300-2-768x797.png",
  },
  {
    category: "Video & Webcams",
    code: "RS-WC350",
    sku: "LIV-RS-RS-WC350",
    name: "RealSight WC350",
    image: "https://liveytech.com/wp-content/uploads/2025/12/WC350_rev1-768x797.jpg",
  },
  {
    category: "Video & Webcams",
    code: "RS-WC400",
    sku: "LIV-RS-RS-WC400",
    name: "RealSight WC400-Wide angle",
    image: "https://liveytech.com/wp-content/uploads/2025/12/WC400_rev1-768x797.jpg",
  },
  {
    category: "Video & Webcams",
    code: "RS-WC450",
    sku: "LIV-RS-RS-WC450",
    name: "RealSight WC450",
    image: "https://liveytech.com/wp-content/uploads/2025/12/WC4501-768x797.jpg",
  },
  {
    category: "Video & Webcams",
    code: "RS-EPTZ500",
    sku: "LIV-RS-RS-EPTZ500",
    name: "RealSight ePTZ500 Video Bar",
    image: "https://liveytech.com/wp-content/uploads/2025/03/PTZ500-768x725.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-CB100X",
    sku: "LIV-SAV-SAVVI-CB100X",
    name: "SAVVI CB100X Professional Wireless Combo",
    image: "https://liveytech.com/wp-content/uploads/2026/06/01.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-CB10C",
    sku: "LIV-SAV-SAVVI-CB10C",
    name: "SAVVI CB10C Wired Combo",
    image: "https://liveytech.com/wp-content/uploads/2026/06/09.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-CB15C",
    sku: "LIV-SAV-SAVVI-CB15C",
    name: "SAVVI CB15C Wired Combo",
    image: "https://liveytech.com/wp-content/uploads/2026/06/10.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-CB50W",
    sku: "LIV-SAV-SAVVI-CB50W",
    name: "SAVVI CB50W Wireless Combo",
    image: "https://liveytech.com/wp-content/uploads/2026/06/08.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-CB70W",
    sku: "LIV-SAV-SAVVI-CB70W",
    name: "SAVVI CB70W Wireless Combo",
    image: "https://liveytech.com/wp-content/uploads/2026/06/07.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-CB75W",
    sku: "LIV-SAV-SAVVI-CB75W",
    name: "SAVVI CB75W Wireless Combo",
    image: "https://liveytech.com/wp-content/uploads/2026/06/06.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-CB77W",
    sku: "LIV-SAV-SAVVI-CB77W",
    name: "SAVVI CB77W Business Wireless Combo",
    image: "https://liveytech.com/wp-content/uploads/2026/06/05.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-CB80X",
    sku: "LIV-SAV-SAVVI-CB80X",
    name: "SAVVI CB80X Wireless Combo",
    image: "https://liveytech.com/wp-content/uploads/2026/06/04.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-CB85X",
    sku: "LIV-SAV-SAVVI-CB85X",
    name: "SAVVI CB85X Membrane Wireless Combo",
    image: "https://liveytech.com/wp-content/uploads/2026/06/03.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-CB90X",
    sku: "LIV-SAV-SAVVI-CB90X",
    name: "SAVVI CB90X Professional Wireless Combo",
    image: "https://liveytech.com/wp-content/uploads/2026/06/02-1022x1024.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-MS10C",
    sku: "LIV-SAV-SAVVI-MS10C",
    name: "SAVVI MS10C Wired Mouse",
    image: "https://liveytech.com/wp-content/uploads/2026/06/11.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-MS80X",
    sku: "LIV-SAV-SAVVI-MS80X",
    name: "SAVVI MS80X Wireless Mouse",
    image: "https://liveytech.com/wp-content/uploads/2026/06/13.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-MS90X",
    sku: "LIV-SAV-SAVVI-MS90X",
    name: "SAVVI MS90X Wireless Mouse",
    image: "https://liveytech.com/wp-content/uploads/2026/06/14.jpg",
  },
  {
    category: "Combos & Docking",
    code: "SAVVI-MS95X",
    sku: "LIV-SAV-SAVVI-MS95X",
    name: "SAVVI MS95X Wireless Mouse",
    image: "https://liveytech.com/wp-content/uploads/2026/06/12.jpg",
  },
  {
    category: "SmartPack Bundles",
    code: "SP-950BT",
    sku: "LIV-SP-SP-950BT",
    name: "SmartPack 950BT Series",
    image: "https://liveytech.com/wp-content/uploads/2025/09/950.jpg",
  },
  {
    category: "SmartPack Bundles",
    code: "SP-712BTM",
    sku: "LIV-SP-SP-712BTM",
    name: "SmartPack Essential 712BTM Series Headset",
    image: "https://liveytech.com/wp-content/uploads/2025/09/712-3.jpg",
  },
  {
    category: "SmartPack Bundles",
    code: "SP-910BT",
    sku: "LIV-SP-SP-910BT",
    name: "SmartPack Essential 910BT Series",
    image: "https://liveytech.com/wp-content/uploads/2025/09/910-4-1.jpg",
  },
  {
    category: "SmartPack Bundles",
    code: "SP-G300BT",
    sku: "LIV-SP-SP-G300BT",
    name: "SmartPack Essential G300BT Gaming Series",
    image: "https://liveytech.com/wp-content/uploads/2025/09/g300bt-2.jpg",
  },
  {
    category: "SmartPack Bundles",
    code: "SP-G300DU",
    sku: "LIV-SP-SP-G300DU",
    name: "SmartPack Essential G300DU Wired Gaming Headset",
    image: "https://liveytech.com/wp-content/uploads/2025/09/G300-gaming-1.jpg",
  },
  {
    category: "SmartPack Bundles",
    code: "SP-OE750BT",
    sku: "LIV-SP-SP-OE750BT",
    name: "SmartPack Essential OpenEar 750BT Headset",
    image: "https://liveytech.com/wp-content/uploads/2025/09/750-1.jpg",
  },
  {
    category: "SmartPack Bundles",
    code: "SP-OE760BT",
    sku: "LIV-SP-SP-OE760BT",
    name: "SmartPack Essential OpenEar 760BT Earbuds",
    image: "https://liveytech.com/wp-content/uploads/2025/09/760-1-2.jpg",
  },
  {
    category: "SmartPack Bundles",
    code: "SP-TAG200",
    sku: "LIV-SP-SP-TAG200",
    name: "SmartPack Essentials Smart Tag-200",
    image: "https://liveytech.com/wp-content/uploads/2025/09/smart_tag_200-1.jpg",
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
    "image_path",
    "image_alt",
    "is_seed",
  ];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [index, product] of PRODUCTS.entries()) {
      const meta = CATEGORY_META[product.category];
      if (!meta) throw new Error(`No metadata for category "${product.category}"`);
      const row = [
        seedUuid(index),
        product.sku,
        product.name,
        product.category,
        meta.tier,
        PRICE_PLACEHOLDER,
        MARGIN_PLACEHOLDER,
        0,
        // Stock is not published either, and "made to order" is honest for a
        // quote-based catalogue rather than implying shelf availability.
        "made_to_order",
        meta.benefits,
        "product",
        product.code,
        "USD",
        "LIVEY-2026",
        1,
        "active",
        product.image,
        `${product.name} product photo`,
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
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const summary = await pool.query(
    `SELECT category, count(*)::int AS items, count(image_path)::int AS with_image
     FROM portal_catalog_items WHERE id::text LIKE $1 GROUP BY category ORDER BY category`,
    [`${UUID_PREFIX}-%`],
  );
  console.log(`[seed-catalog] upserted ${PRODUCTS.length} products from liveytech.com`);
  console.table(summary.rows);

  const dupes = await pool.query(
    `SELECT sku FROM portal_catalog_items GROUP BY sku HAVING count(*) > 1`,
  );
  console.log(`[seed-catalog] duplicate SKUs catalogue-wide: ${dupes.rowCount ?? 0}`);
  await pool.end();
}

main().catch((error) => {
  console.error("[seed-catalog] failed", error);
  process.exit(1);
});
