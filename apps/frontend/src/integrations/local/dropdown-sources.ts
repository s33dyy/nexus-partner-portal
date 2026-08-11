import type { CatalogItemRecord, CatalogKind } from "@/lib/catalog";
import type { DropdownOption, DropdownSourceKey } from "@/lib/dropdown-sources";
import type { CustomerRecord } from "@/lib/portal-records";
import type { LineItemCatalogOption } from "@livey/shared/types/dropdown-sources";

import { apiFetch } from "./api-client";

export async function listDropdownSourceValues(input: {
  source: DropdownSourceKey;
  fieldName?: string;
  q?: string;
  partnerId?: string | null;
  userId?: string | null;
  catalogKind?: CatalogKind | "all";
}): Promise<DropdownOption[]> {
  return apiFetch("GET", "/api/dropdown-sources/list-dropdown-source-values", undefined, {
    query: input,
  });
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
}): Promise<CatalogItemRecord> {
  return apiFetch("POST", "/api/dropdown-sources/create-dropdown-catalog-item", input);
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
}): Promise<CatalogItemRecord> {
  return apiFetch("POST", "/api/dropdown-sources/update-dropdown-catalog-item", input);
}

export async function listLineItemCatalogOptions(input: {
  q?: string;
}): Promise<LineItemCatalogOption[]> {
  return apiFetch("GET", "/api/dropdown-sources/list-line-item-catalog-options", undefined, {
    query: input,
  });
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
  return apiFetch("POST", "/api/dropdown-sources/create-dropdown-customer", input);
}
