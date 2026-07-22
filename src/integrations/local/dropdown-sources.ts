import { createServerFn } from "@tanstack/react-start";

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
    }) => input,
  )
  .handler(async ({ data }) => {
    const { listDropdownSourceValues } = await import("@/server/dropdown-sources.server");
    return listDropdownSourceValues(data);
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
}): Promise<DropdownOption[]> {
  return listDropdownSourceValuesFn({ data: input });
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

