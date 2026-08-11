export type LookupValueRow = {
  id: string;
  field_name: string;
  value: string;
  value_key: string;
  domain_key: string;
  label_snapshot: string;
  value_version: number;
  effective_from: string;
  effective_to: string | null;
  retired_at: string | null;
  source: string;
  metadata: Record<string, unknown>;
  created_by: string | null;
  is_seed: boolean;
  created_at: string;
};
