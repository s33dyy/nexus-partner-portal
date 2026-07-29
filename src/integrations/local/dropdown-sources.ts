import { createServerFn } from "@tanstack/react-start";

import type { CatalogKind } from "@/lib/catalog";
import type { DropdownOption, DropdownSourceKey } from "@/lib/dropdown-sources";
import type { CustomerRecord } from "@/lib/portal-records";

const listDropdownSourceValuesFn = createServerFn({ method: "GET" })
  .validator(
    (input: {
      source: DropdownSourceKey;
      fieldName?: string;
      q?: string;
      partnerId?: string | null;
      userId?: string | null;
      catalogKind?: CatalogKind | "all";
    }) => input,
  )
  .handler(async ({ data }) => {
    const { listDropdownSourceValues } = await import("@/server/dropdown-sources.server");
    return listDropdownSourceValues(data);
  });

const createDropdownCatalogItemFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      product_name: string;
      sku?: string;
      category?: string;
      partner_tier?: string;
      list_price?: string;
      margin?: string;
      stock?: number;
      availability?: string;
      benefits?: string;
      catalog_kind?: CatalogKind;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { createCatalogItemFromDropdown } = await import("@/server/dropdown-sources.server");
    return createCatalogItemFromDropdown(data);
  });

const updateDropdownCatalogItemFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      id: string;
      product_name: string;
      sku?: string;
      category?: string;
      partner_tier?: string;
      list_price?: string;
      margin?: string;
      stock?: number;
      availability?: string;
      benefits?: string;
      catalog_kind?: CatalogKind;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { updateCatalogItemFromDropdown } = await import("@/server/dropdown-sources.server");
    return updateCatalogItemFromDropdown(data);
  });

const createDropdownCustomerFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      company_name: string;
      account_owner: string;
      region: string;
      segment: string;
      health_score?: number;
      mrr: string;
      renewal_date: string;
      status: string;
      next_step: string;
      last_touch?: string;
      user_id?: string | null;
      partner_id?: string | null;
    }) => input,
  )
  .handler(async ({ data }) => {
    const { createCustomerFromDropdown } = await import("@/server/dropdown-sources.server");
    return createCustomerFromDropdown(data);
  });

export async function listDropdownSourceValues(input: {
  source: DropdownSourceKey;
  fieldName?: string;
  q?: string;
  partnerId?: string | null;
  userId?: string | null;
  catalogKind?: CatalogKind | "all";
}): Promise<DropdownOption[]> {
  return listDropdownSourceValuesFn({ data: input });
}

export async function createDropdownCatalogItem(input: {
  product_name: string;
  sku?: string;
  category?: string;
  partner_tier?: string;
  list_price?: string;
  margin?: string;
  stock?: number;
  availability?: string;
  benefits?: string;
  catalog_kind?: CatalogKind;
}) {
  return createDropdownCatalogItemFn({ data: input });
}

export async function updateDropdownCatalogItem(input: {
  id: string;
  product_name: string;
  sku?: string;
  category?: string;
  partner_tier?: string;
  list_price?: string;
  margin?: string;
  stock?: number;
  availability?: string;
  benefits?: string;
  catalog_kind?: CatalogKind;
}) {
  return updateDropdownCatalogItemFn({ data: input });
}

export async function createDropdownCustomer(input: {
  company_name: string;
  account_owner: string;
  region: string;
  segment: string;
  health_score?: number;
  mrr: string;
  renewal_date: string;
  status: string;
  next_step: string;
  last_touch?: string;
  user_id?: string | null;
  partner_id?: string | null;
}): Promise<CustomerRecord> {
  return createDropdownCustomerFn({ data: input });
}
