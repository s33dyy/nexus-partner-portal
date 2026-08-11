import { Hono } from "hono";

import {
  createCatalogItemFromDropdown,
  createCustomerFromDropdown,
  listDropdownSourceValues,
  listLineItemCatalogOptions,
  updateCatalogItemFromDropdown,
} from "@/server/dropdown-sources.server";
import type { CatalogKind } from "@livey/shared/lib/catalog";
import type { DropdownSourceKey } from "@livey/shared/lib/dropdown-sources";

export const dropdownSourceRoutes = new Hono();

dropdownSourceRoutes.get("/list-dropdown-source-values", async (c) =>
  c.json(
    await listDropdownSourceValues({
      source: c.req.query("source") as DropdownSourceKey,
      fieldName: c.req.query("fieldName"),
      q: c.req.query("q"),
      partnerId: c.req.query("partnerId") ?? null,
      userId: c.req.query("userId") ?? null,
      catalogKind: c.req.query("catalogKind") as CatalogKind | "all" | undefined,
    }),
  ),
);

dropdownSourceRoutes.get("/list-line-item-catalog-options", async (c) =>
  c.json(await listLineItemCatalogOptions({ q: c.req.query("q") })),
);

dropdownSourceRoutes.post("/create-dropdown-catalog-item", async (c) =>
  c.json(await createCatalogItemFromDropdown(await c.req.json())),
);

dropdownSourceRoutes.post("/update-dropdown-catalog-item", async (c) =>
  c.json(await updateCatalogItemFromDropdown(await c.req.json())),
);

dropdownSourceRoutes.post("/create-dropdown-customer", async (c) =>
  c.json(await createCustomerFromDropdown(await c.req.json())),
);
