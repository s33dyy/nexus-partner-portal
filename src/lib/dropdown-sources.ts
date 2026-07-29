export type DropdownSourceKey = "account" | "catalog" | "client" | "poc" | "lookup";

export type DropdownOption = {
  id: string;
  label: string;
  description?: string | null;
  source: DropdownSourceKey;
};

export type DropdownSourceConfig = {
  kind: DropdownSourceKey;
  table: string;
  idField: string;
  labelField: string;
  descriptionField?: string;
  allowCreate: boolean;
  searchFields?: string[];
};

export const DROPDOWN_SOURCES = {
  account: {
    kind: "account",
    table: "partners",
    idField: "id",
    labelField: "company_name",
    descriptionField: "legal_name",
    allowCreate: false,
    searchFields: ["company_name", "legal_name"],
  },
  client: {
    kind: "client",
    table: "portal_customers",
    idField: "id",
    labelField: "company_name",
    descriptionField: "account_owner",
    allowCreate: true,
    searchFields: ["company_name", "account_owner", "region", "segment", "mrr"],
  },
  catalog: {
    kind: "catalog",
    table: "portal_catalog_items",
    idField: "id",
    labelField: "product_name",
    descriptionField: "sku",
    allowCreate: true,
    searchFields: ["sku", "product_name", "category", "partner_tier", "catalog_kind"],
  },
  poc: {
    kind: "poc",
    table: "profiles",
    idField: "id",
    labelField: "full_name",
    descriptionField: "email",
    allowCreate: false,
    searchFields: ["full_name", "email", "company_name"],
  },
  lookup: {
    kind: "lookup",
    table: "lookup_values",
    idField: "id",
    labelField: "value",
    allowCreate: true,
    searchFields: ["value"],
  },
} as const satisfies Record<DropdownSourceKey, DropdownSourceConfig>;

export function isDropdownSourceKey(value: string): value is DropdownSourceKey {
  return value in DROPDOWN_SOURCES;
}
