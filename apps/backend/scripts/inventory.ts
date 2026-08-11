import "../src/lib/load-env";

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createPool } from "./db";
import {
  analyzeInventoryTables,
  emptyInventorySnapshot,
  formatInventoryReport,
  listInventoryTables,
  loadInventorySnapshotFromFixtureJson,
  type InventoryTables,
} from "../src/server/inventory-report";

type CliOptions = {
  fixturePath: string | null;
  json: boolean;
  checkpointPath: string | null;
  resume: boolean;
  live: boolean;
};

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    fixturePath: null,
    json: false,
    checkpointPath: null,
    resume: false,
    live: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixture") {
      options.fixturePath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--checkpoint") {
      options.checkpointPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--resume") {
      options.resume = true;
      continue;
    }
    if (arg === "--live") {
      options.live = true;
      continue;
    }
  }

  return options;
}

export function assertInventoryModeAllowed(options: CliOptions) {
  if (!options.fixturePath && !options.live) {
    throw new Error("Inventory script is read-only by default; use --fixture or --live");
  }
}

async function loadFixtureTables(fixturePath: string) {
  const jsonText = await readFile(resolve(fixturePath), "utf8");
  return loadInventorySnapshotFromFixtureJson(jsonText);
}

async function loadLiveTables(
  checkpointPath: string | null,
  resume: boolean,
): Promise<InventoryTables> {
  if (process.env.INVENTORY_ALLOW_LIVE !== "1") {
    throw new Error("Live inventory reads require INVENTORY_ALLOW_LIVE=1");
  }

  const pool = createPool();
  try {
    const tables = emptyInventorySnapshot();
    const checkpoint = checkpointPath && resume ? await loadCheckpoint(checkpointPath) : null;
    const processedTables = new Set(checkpoint?.processedTables ?? []);
    const seededTables = checkpoint?.tables ?? emptyInventorySnapshot();
    Object.assign(tables, seededTables);
    for (const table of listInventoryTables()) {
      if (processedTables.has(table)) {
        continue;
      }
      const result = await pool.query(`SELECT * FROM ${table}`);
      tables[table] = result.rows as InventoryTables[string];
      if (checkpointPath) {
        await saveCheckpoint(checkpointPath, tables, [...processedTables, table]);
      }
      processedTables.add(table);
    }
    return tables;
  } finally {
    await pool.end();
  }
}

async function loadCheckpoint(pathname: string) {
  try {
    const jsonText = await readFile(resolve(pathname), "utf8");
    return JSON.parse(jsonText) as { processedTables: string[]; tables: InventoryTables };
  } catch {
    return { processedTables: [], tables: emptyInventorySnapshot() };
  }
}

async function saveCheckpoint(
  pathname: string,
  tables: InventoryTables,
  processedTables: string[],
) {
  await writeFile(resolve(pathname), JSON.stringify({ processedTables, tables }, null, 2), "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertInventoryModeAllowed(options);
  const usingFixture = Boolean(options.fixturePath);

  const tables = usingFixture
    ? await loadFixtureTables(options.fixturePath as string)
    : await loadLiveTables(options.checkpointPath, options.resume);

  const report = analyzeInventoryTables(
    tables,
    usingFixture ? `fixture:${options.fixturePath}` : "live-database",
  );
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatInventoryReport(report));
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
