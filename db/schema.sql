CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE app_role AS ENUM ('super_admin', 'partner_admin', 'partner_user');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Widen app_role to the nine governed RoleKeys (product.md §1.4/§5.4). A bare
-- CREATE TYPE with the full value list is not idempotent on an
-- already-migrated database: Postgres raises duplicate_object because the
-- type already exists, the handler above swallows it, and the six new
-- values never land. ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent on
-- both a fresh database (created with only the three original values above)
-- and an existing one, and is safe inside this file's single implicit
-- migration transaction on PostgreSQL 12+ as long as nothing later in this
-- same transaction inserts a row using the new value (nothing does).
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'rm';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'pam';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'kam';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'isr';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'livey_support';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'restricted_distributor';

DO $$
BEGIN
  CREATE TYPE partner_status AS ENUM (
    'pending_partner_registration',
    'submitted',
    'under_review',
    'need_more_info',
    'pending_agreement',
    'signed_pending_review',
    'approved',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- Add workflow statuses to existing enum if the type already exists (idempotent)
DO $$
BEGIN
  ALTER TYPE partner_status ADD VALUE IF NOT EXISTS 'pending_agreement' AFTER 'need_more_info';
  ALTER TYPE partner_status ADD VALUE IF NOT EXISTS 'signed_pending_review' AFTER 'pending_agreement';
EXCEPTION
  WHEN others THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE partner_tier AS ENUM ('registered', 'silver', 'gold', 'platinum');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE tenant_kind AS ENUM ('livey_organization', 'partner');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE geography_node_type AS ENUM ('global', 'sales_region', 'country', 'province_state');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE assignment_status AS ENUM ('scheduled', 'active', 'suspended', 'ended', 'revoked');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  company_name TEXT,
  avatar_url TEXT,
  partner_id UUID,
  partner_status partner_status NOT NULL DEFAULT 'pending_partner_registration',
  must_reset_password BOOLEAN NOT NULL DEFAULT FALSE,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  legal_name TEXT,
  gst_number TEXT,
  pan TEXT,
  cin TEXT,
  website TEXT,
  business_address TEXT,
  country TEXT,
  state TEXT,
  business_type TEXT,
  years_in_business INTEGER,
  annual_turnover TEXT,
  employee_count TEXT,
  business_focus TEXT[],
  status partner_status NOT NULL DEFAULT 'pending_partner_registration',
  tier partner_tier NOT NULL DEFAULT 'registered',
  -- Agreement tracking
  agreement_envelope_id TEXT,
  agreement_sent_at TIMESTAMPTZ,
  agreement_signed_at TIMESTAMPTZ,
  agreement_source_doc_path TEXT,
  agreement_signed_doc_path TEXT,
  agreement_provider TEXT DEFAULT 'zohosign',
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add agreement columns to existing partners table (idempotent)
DO $$ BEGIN
  ALTER TABLE partners ADD COLUMN IF NOT EXISTS agreement_envelope_id TEXT;
  ALTER TABLE partners ADD COLUMN IF NOT EXISTS agreement_sent_at TIMESTAMPTZ;
  ALTER TABLE partners ADD COLUMN IF NOT EXISTS agreement_signed_at TIMESTAMPTZ;
  ALTER TABLE partners ADD COLUMN IF NOT EXISTS agreement_source_doc_path TEXT;
  ALTER TABLE partners ADD COLUMN IF NOT EXISTS agreement_signed_doc_path TEXT;
  ALTER TABLE partners ADD COLUMN IF NOT EXISTS agreement_provider TEXT DEFAULT 'zohosign';
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS governed_tenants (
  tenant_id TEXT PRIMARY KEY,
  tenant_kind tenant_kind NOT NULL,
  display_name TEXT NOT NULL,
  parent_tenant_id TEXT REFERENCES governed_tenants(tenant_id) ON DELETE SET NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS geography_nodes (
  node_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES governed_tenants(tenant_id) ON DELETE RESTRICT,
  organization_tenant_id TEXT NOT NULL REFERENCES governed_tenants(tenant_id) ON DELETE RESTRICT,
  node_code TEXT NOT NULL UNIQUE,
  node_type geography_node_type NOT NULL,
  display_name TEXT NOT NULL,
  parent_node_id TEXT REFERENCES geography_nodes(node_id) ON DELETE SET NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS geography_node_aliases (
  alias_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES geography_nodes(node_id) ON DELETE CASCADE,
  legacy_value TEXT NOT NULL UNIQUE,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  source TEXT NOT NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignments (
  assignment_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES governed_tenants(tenant_id) ON DELETE RESTRICT,
  organization_tenant_id TEXT NOT NULL REFERENCES governed_tenants(tenant_id) ON DELETE RESTRICT,
  role_key TEXT NOT NULL,
  team_domain TEXT NOT NULL,
  geography_ceiling_node_id TEXT NOT NULL REFERENCES geography_nodes(node_id) ON DELETE RESTRICT,
  partner_id UUID REFERENCES partners(id) ON DELETE SET NULL,
  account_id TEXT,
  portfolio_id TEXT,
  queue_id TEXT,
  manager_assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  approver_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status assignment_status NOT NULL DEFAULT 'scheduled',
  predecessor_assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE SET NULL,
  successor_assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE SET NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assignment_events (
  event_id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(assignment_id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  reason TEXT,
  before_state JSONB,
  after_state JSONB,
  effective_at TIMESTAMPTZ NOT NULL,
  predecessor_assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE SET NULL,
  successor_assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE SET NULL,
  session_revocation_result TEXT,
  correlation_id TEXT NOT NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS active_contexts (
  context_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assignment_id TEXT NOT NULL REFERENCES assignments(assignment_id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES governed_tenants(tenant_id) ON DELETE RESTRICT,
  organization_tenant_id TEXT NOT NULL REFERENCES governed_tenants(tenant_id) ON DELETE RESTRICT,
  working_scope TEXT,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  revocation_link TEXT,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  correlation_id TEXT NOT NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Zoho Sign OAuth token storage (single org row)
CREATE TABLE IF NOT EXISTS zoho_sign_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  api_domain TEXT NOT NULL DEFAULT 'https://sign.zoho.in',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_blobs (
  file_path TEXT PRIMARY KEY,
  bucket TEXT NOT NULL DEFAULT 'partner-documents',
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  file_data BYTEA NOT NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL REFERENCES document_blobs(file_path) ON DELETE CASCADE,
  mime_type TEXT,
  size_bytes INTEGER,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES portal_deals(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL REFERENCES document_blobs(file_path) ON DELETE CASCADE,
  mime_type TEXT,
  size_bytes INTEGER,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_review_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  status_change TEXT,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_deals (
  id UUID PRIMARY KEY,
  account_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'India',
  region TEXT NOT NULL,
  product TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount TEXT NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  amount_value NUMERIC(14,2),
  amount_usd NUMERIC(14,2),
  fx_rate NUMERIC(14,6),
  fx_provider TEXT,
  fx_rate_fetched_at TIMESTAMPTZ,
  customer_budget TEXT,
  probability INTEGER NOT NULL DEFAULT 0,
  possible_close_date DATE,
  close_date DATE NOT NULL,
  source TEXT NOT NULL,
  last_touch TEXT NOT NULL,
  notes TEXT NOT NULL,
  is_hidden_to_team BOOLEAN NOT NULL DEFAULT FALSE,
  reward_rate_percent NUMERIC(6,2) NOT NULL DEFAULT 5,
  commercial_approved BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_deal_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES portal_deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  split_percent NUMERIC(6,2) NOT NULL DEFAULT 100,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, user_id)
);

CREATE TABLE IF NOT EXISTS portal_customers (
  id UUID PRIMARY KEY,
  company_name TEXT NOT NULL,
  account_owner TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'India',
  region TEXT NOT NULL,
  segment TEXT NOT NULL,
  health_score INTEGER NOT NULL DEFAULT 0,
  mrr TEXT NOT NULL,
  renewal_date DATE NOT NULL,
  status TEXT NOT NULL,
  next_step TEXT NOT NULL,
  last_touch TEXT NOT NULL,
  domain TEXT,
  phone TEXT,
  tax_registration_id TEXT,
  provider_customer_id TEXT,
  address TEXT,
  origin TEXT NOT NULL DEFAULT 'partner_portal',
  duplicate_review_status TEXT NOT NULL DEFAULT 'clean',
  master_customer_id UUID REFERENCES portal_customers(id) ON DELETE SET NULL,
  merged_into_customer_id UUID REFERENCES portal_customers(id) ON DELETE SET NULL,
  merged_at TIMESTAMPTZ,
  merge_reason TEXT,
  external_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_customer_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES portal_customers(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  next_step TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES portal_customers(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  participant_type TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deal_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES portal_deals(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  participant_type TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_merge_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  surviving_customer_id UUID NOT NULL REFERENCES portal_customers(id) ON DELETE CASCADE,
  merged_customer_id UUID NOT NULL REFERENCES portal_customers(id) ON DELETE CASCADE,
  redirect_customer_id UUID REFERENCES portal_customers(id) ON DELETE SET NULL,
  before_state JSONB NOT NULL,
  after_state JSONB NOT NULL,
  external_id_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  scope_restrictions JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT NOT NULL,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);



CREATE TABLE IF NOT EXISTS portal_catalog_items (
  id UUID PRIMARY KEY,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  partner_tier TEXT NOT NULL,
  list_price TEXT NOT NULL,
  margin TEXT NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  availability TEXT NOT NULL,
  benefits TEXT NOT NULL,
  catalog_kind TEXT NOT NULL DEFAULT 'product',
  product_code TEXT,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  price_book_code TEXT,
  price_book_version INTEGER NOT NULL DEFAULT 1,
  product_status TEXT NOT NULL DEFAULT 'active',
  archived_at TIMESTAMPTZ,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  product_description TEXT,
  product_kind TEXT NOT NULL DEFAULT 'product',
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  archived_reason TEXT,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_code TEXT NOT NULL UNIQUE,
  variant_name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  archived_reason TEXT,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  sku_code TEXT NOT NULL UNIQUE,
  currency_code TEXT NOT NULL,
  msrp_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  partner_transfer_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  discounted_transfer_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  reward_eligible_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  additional_discount_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  archived_reason TEXT,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS combos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_code TEXT NOT NULL UNIQUE,
  combo_name TEXT NOT NULL,
  combo_description TEXT,
  currency_code TEXT NOT NULL,
  bundle_msrp_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  bundle_transfer_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  archived_reason TEXT,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS combo_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id UUID NOT NULL REFERENCES combos(id) ON DELETE RESTRICT,
  component_sku_id UUID NOT NULL REFERENCES product_skus(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  archived_reason TEXT,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_book_code TEXT NOT NULL UNIQUE,
  price_book_name TEXT NOT NULL,
  currency_code TEXT NOT NULL,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  archived_reason TEXT,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_book_id UUID NOT NULL REFERENCES price_books(id) ON DELETE RESTRICT,
  product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
  product_variant_id UUID REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_sku_id UUID REFERENCES product_skus(id) ON DELETE RESTRICT,
  combo_id UUID REFERENCES combos(id) ON DELETE RESTRICT,
  row_kind TEXT NOT NULL DEFAULT 'sku',
  currency_code TEXT NOT NULL,
  msrp_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  partner_transfer_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  discounted_transfer_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  reward_eligible_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  archived_reason TEXT,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fx_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_code TEXT NOT NULL UNIQUE,
  source_currency_code TEXT NOT NULL,
  target_currency_code TEXT NOT NULL,
  source_amount NUMERIC(18, 4) NOT NULL,
  target_amount NUMERIC(18, 4) NOT NULL,
  rate NUMERIC(18, 8) NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL DEFAULT 'internal',
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  archived_reason TEXT,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_team_members (
  id UUID PRIMARY KEY,
  company_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role_title TEXT NOT NULL,
  portal_role TEXT NOT NULL,
  responsibility TEXT NOT NULL,
  status TEXT NOT NULL,
  last_active TEXT NOT NULL,
  phone TEXT NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_audit_events (
  id UUID PRIMARY KEY,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_name TEXT NOT NULL,
  outcome TEXT NOT NULL,
  details TEXT NOT NULL,
  severity TEXT NOT NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS portal_news_posts (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  image_path TEXT NOT NULL,
  image_alt TEXT NOT NULL DEFAULT '',
  posted_by_name TEXT NOT NULL,
  posted_by_role TEXT NOT NULL DEFAULT 'super_admin',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reward_catalog_items (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  image_path TEXT,
  category TEXT NOT NULL,
  points_cost INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  availability TEXT NOT NULL DEFAULT 'available',
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reward_point_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id UUID,
  points_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id UUID NOT NULL REFERENCES reward_catalog_items(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  points_cost INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'requested',
  shipping_name TEXT,
  shipping_address TEXT,
  notes TEXT,
  approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Risk-first reward integrity (2026-08-01): reservation/replay keys,
-- optimistic version, reversal linkage, and catalogue retirement. Additive
-- ALTER statements (not inline CREATE TABLE columns) because db:migrate
-- re-runs this whole file against the already-bootstrapped production
-- database on every deploy — CREATE TABLE IF NOT EXISTS is a no-op there,
-- so new columns only ever land through ADD COLUMN IF NOT EXISTS.
ALTER TABLE reward_catalog_items ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
ALTER TABLE reward_catalog_items ADD COLUMN IF NOT EXISTS retired_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE reward_point_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE reward_point_events ADD COLUMN IF NOT EXISTS reversal_of UUID REFERENCES reward_point_events(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS reward_point_events_idempotency_key_uidx
  ON reward_point_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS reward_redemptions_idempotency_key_uidx
  ON reward_redemptions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- reward_redemptions.reward_id must never cascade-delete redemption history
-- out from under a retired catalogue item. Discovers the existing FK by the
-- column it constrains (not a hardcoded constraint name) so this is safe to
-- re-run regardless of what a given environment's constraint happens to be
-- named, and is a no-op once the constraint is already RESTRICT.
DO $$
DECLARE
  reward_fk_name TEXT;
  reward_fk_delete_action "char";
BEGIN
  SELECT c.conname, c.confdeltype
    INTO reward_fk_name, reward_fk_delete_action
  FROM pg_constraint c
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid
   AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'public.reward_redemptions'::regclass
    AND c.contype = 'f'
    AND a.attname = 'reward_id'
  LIMIT 1;

  IF reward_fk_name IS NOT NULL AND reward_fk_delete_action <> 'r' THEN
    EXECUTE format(
      'ALTER TABLE public.reward_redemptions DROP CONSTRAINT %I',
      reward_fk_name
    );
    reward_fk_name := NULL;
  END IF;

  IF reward_fk_name IS NULL THEN
    ALTER TABLE public.reward_redemptions
      ADD CONSTRAINT reward_redemptions_reward_id_fkey
      FOREIGN KEY (reward_id)
      REFERENCES public.reward_catalog_items(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- Reward fulfillment wiring (2026-08-06): product.md §15.7's Processing ->
-- Fulfilled/Failed transition needs somewhere to record the GyFTR provider
-- truth (never fabricated — a STUB- prefixed voucher code is the honest
-- graceful-fallback result when GyFTR credentials are absent, a recorded
-- failure_reason is the honest result when the provider call fails). Same
-- ADD COLUMN IF NOT EXISTS convention as the block above.
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS fulfillment_provider TEXT;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS fulfillment_reference TEXT;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS fulfillment_voucher_code TEXT;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS fulfillment_expires_at TIMESTAMPTZ;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;
ALTER TABLE reward_redemptions ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- §15.9 gadget catalogue fields (2026-08-06): country eligibility, shipping
-- requirement, and the fulfillment Task assignee for manually/physically
-- fulfilled items. Bounded to the 3 fields this session's finding named;
-- active-date window and accountable-LIVEY-role remain deferred (see
-- current gaps.md 15d).
ALTER TABLE reward_catalog_items ADD COLUMN IF NOT EXISTS country_eligibility TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE reward_catalog_items ADD COLUMN IF NOT EXISTS requires_shipping BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE reward_catalog_items ADD COLUMN IF NOT EXISTS fulfillment_assignee_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- §15.2 points-rate policy (2026-08-06): the smallest real version of the
-- "effective-dated global points policy" the spec calls for — a single
-- current-rate row model keyed by effective_from, not the full
-- non-overlapping-interval model (deferred, see current gaps.md 15c).
-- Brand-new table, so plain CREATE TABLE IF NOT EXISTS is correct here.
CREATE TABLE IF NOT EXISTS reward_points_rate_policy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  points_per_reward_dollar NUMERIC(12,4) NOT NULL CHECK (points_per_reward_dollar > 0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reward_points_rate_policy_effective_from_idx
  ON reward_points_rate_policy (effective_from DESC);

-- Seed the rate that reproduces today's pre-fix behaviour exactly (reward
-- USD value was being used 1:1 as the points pool), so this fix changes the
-- *shape* of the calculation (a real two-step USD-then-points conversion)
-- without silently changing every existing deal's point totals.
INSERT INTO reward_points_rate_policy (id, points_per_reward_dollar, effective_from, is_seed)
VALUES ('00000000-0000-0000-0000-0000000000f1', 1, '2020-01-01T00:00:00Z', TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS lookup_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_name TEXT NOT NULL,
  value TEXT NOT NULL,
  value_key TEXT NOT NULL,
  domain_key TEXT NOT NULL DEFAULT 'general',
  label_snapshot TEXT NOT NULL DEFAULT '',
  value_version INTEGER NOT NULL DEFAULT 1,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  retired_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'seed',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (field_name, value_key)
);

CREATE TABLE IF NOT EXISTS feature_flags (
  flag_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  owner TEXT NOT NULL,
  cohort TEXT NOT NULL,
  dependencies TEXT[] NOT NULL DEFAULT '{}',
  metrics TEXT[] NOT NULL DEFAULT '{}',
  expires_at DATE,
  rollback TEXT NOT NULL,
  audit_required BOOLEAN NOT NULL DEFAULT TRUE,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS domain_activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  organization_tenant_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  actor_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assignment_id TEXT,
  correlation_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS command_outbox (
  outbox_id UUID PRIMARY KEY,
  event_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  organization_tenant_id TEXT NOT NULL,
  actor_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assignment_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  publish_after TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS command_inbox (
  inbox_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  tenant_id TEXT NOT NULL,
  organization_tenant_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  UNIQUE (source, source_message_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS partners_updated_at ON partners;
CREATE TRIGGER partners_updated_at
BEFORE UPDATE ON partners
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS portal_deals_updated_at ON portal_deals;
CREATE TRIGGER portal_deals_updated_at
BEFORE UPDATE ON portal_deals
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS portal_customers_updated_at ON portal_customers;
CREATE TRIGGER portal_customers_updated_at
BEFORE UPDATE ON portal_customers
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS customer_participants_updated_at ON customer_participants;
CREATE TRIGGER customer_participants_updated_at
BEFORE UPDATE ON customer_participants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS deal_participants_updated_at ON deal_participants;
CREATE TRIGGER deal_participants_updated_at
BEFORE UPDATE ON deal_participants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS product_variants_updated_at ON product_variants;
CREATE TRIGGER product_variants_updated_at
BEFORE UPDATE ON product_variants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS product_skus_updated_at ON product_skus;
CREATE TRIGGER product_skus_updated_at
BEFORE UPDATE ON product_skus
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS combos_updated_at ON combos;
CREATE TRIGGER combos_updated_at
BEFORE UPDATE ON combos
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS combo_components_updated_at ON combo_components;
CREATE TRIGGER combo_components_updated_at
BEFORE UPDATE ON combo_components
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS price_books_updated_at ON price_books;
CREATE TRIGGER price_books_updated_at
BEFORE UPDATE ON price_books
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS price_rows_updated_at ON price_rows;
CREATE TRIGGER price_rows_updated_at
BEFORE UPDATE ON price_rows
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS fx_snapshots_updated_at ON fx_snapshots;
CREATE TRIGGER fx_snapshots_updated_at
BEFORE UPDATE ON fx_snapshots
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS portal_catalog_items_updated_at ON portal_catalog_items;
CREATE TRIGGER portal_catalog_items_updated_at
BEFORE UPDATE ON portal_catalog_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS product_variants_updated_at ON product_variants;
CREATE TRIGGER product_variants_updated_at
BEFORE UPDATE ON product_variants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS product_skus_updated_at ON product_skus;
CREATE TRIGGER product_skus_updated_at
BEFORE UPDATE ON product_skus
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS combos_updated_at ON combos;
CREATE TRIGGER combos_updated_at
BEFORE UPDATE ON combos
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS combo_components_updated_at ON combo_components;
CREATE TRIGGER combo_components_updated_at
BEFORE UPDATE ON combo_components
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS price_books_updated_at ON price_books;
CREATE TRIGGER price_books_updated_at
BEFORE UPDATE ON price_books
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS price_rows_updated_at ON price_rows;
CREATE TRIGGER price_rows_updated_at
BEFORE UPDATE ON price_rows
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS fx_snapshots_updated_at ON fx_snapshots;
CREATE TRIGGER fx_snapshots_updated_at
BEFORE UPDATE ON fx_snapshots
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS deal_documents_updated_at ON deal_documents;
CREATE TRIGGER deal_documents_updated_at
BEFORE UPDATE ON deal_documents
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS reward_catalog_items_updated_at ON reward_catalog_items;
CREATE TRIGGER reward_catalog_items_updated_at
BEFORE UPDATE ON reward_catalog_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS reward_redemptions_updated_at ON reward_redemptions;
CREATE TRIGGER reward_redemptions_updated_at
BEFORE UPDATE ON reward_redemptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS portal_team_members_updated_at ON portal_team_members;
CREATE TRIGGER portal_team_members_updated_at
BEFORE UPDATE ON portal_team_members
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS sessions_updated_at ON sessions;
CREATE TRIGGER sessions_updated_at
BEFORE UPDATE ON sessions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS lookup_values_updated_at ON lookup_values;
CREATE TRIGGER lookup_values_updated_at
BEFORE UPDATE ON lookup_values
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS feature_flags_updated_at ON feature_flags;
CREATE TRIGGER feature_flags_updated_at
BEFORE UPDATE ON feature_flags
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS governed_tenants_updated_at ON governed_tenants;
CREATE TRIGGER governed_tenants_updated_at
BEFORE UPDATE ON governed_tenants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS geography_nodes_updated_at ON geography_nodes;
CREATE TRIGGER geography_nodes_updated_at
BEFORE UPDATE ON geography_nodes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS assignments_updated_at ON assignments;
CREATE TRIGGER assignments_updated_at
BEFORE UPDATE ON assignments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS active_contexts_updated_at ON active_contexts;
CREATE TRIGGER active_contexts_updated_at
BEFORE UPDATE ON active_contexts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_by_context_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revocation_reason TEXT;

ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id) ON DELETE CASCADE;
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES portal_customers(id) ON DELETE SET NULL;
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS poc_profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'India';
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS customer_budget TEXT;
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE portal_deals ALTER COLUMN currency_code SET DEFAULT 'USD';
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS amount_value NUMERIC(14,2);
-- Global reporting currency changed from INR to USD; rename the column on
-- already-migrated databases instead of dropping historical data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portal_deals' AND column_name = 'amount_inr'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portal_deals' AND column_name = 'amount_usd'
  ) THEN
    ALTER TABLE portal_deals RENAME COLUMN amount_inr TO amount_usd;
  END IF;
END $$;
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS amount_usd NUMERIC(14,2);
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS fx_rate NUMERIC(14,6);
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS fx_provider TEXT;
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS fx_rate_fetched_at TIMESTAMPTZ;
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS possible_close_date DATE;
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS is_hidden_to_team BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS reward_rate_percent NUMERIC(6,2) NOT NULL DEFAULT 5;

ALTER TABLE lookup_values ADD COLUMN IF NOT EXISTS domain_key TEXT NOT NULL DEFAULT 'general';
ALTER TABLE lookup_values ADD COLUMN IF NOT EXISTS label_snapshot TEXT NOT NULL DEFAULT '';
ALTER TABLE lookup_values ADD COLUMN IF NOT EXISTS value_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lookup_values ADD COLUMN IF NOT EXISTS effective_from DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE lookup_values ADD COLUMN IF NOT EXISTS effective_to DATE;
ALTER TABLE lookup_values ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
ALTER TABLE lookup_values ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE lookup_values ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE lookup_values ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE lookup_values
SET label_snapshot = CASE WHEN label_snapshot = '' THEN value ELSE label_snapshot END
WHERE label_snapshot = '';

ALTER TABLE portal_deal_collaborators ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS portal_deal_collaborators_updated_at ON portal_deal_collaborators;
CREATE TRIGGER portal_deal_collaborators_updated_at
BEFORE UPDATE ON portal_deal_collaborators
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

INSERT INTO portal_deal_collaborators (
  id,
  deal_id,
  user_id,
  split_percent,
  sort_order,
  is_seed,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  d.id,
  d.user_id,
  100,
  0,
  COALESCE(d.is_seed, FALSE),
  now(),
  now()
FROM portal_deals d
WHERE d.user_id IS NOT NULL
ON CONFLICT (deal_id, user_id) DO NOTHING;

ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id) ON DELETE CASCADE;
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'India';
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS domain TEXT;
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS tax_registration_id TEXT;
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS provider_customer_id TEXT;
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'partner_portal';
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS duplicate_review_status TEXT NOT NULL DEFAULT 'clean';
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS master_customer_id UUID REFERENCES portal_customers(id) ON DELETE SET NULL;
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS merged_into_customer_id UUID REFERENCES portal_customers(id) ON DELETE SET NULL;
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ;
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS merge_reason TEXT;
ALTER TABLE portal_customers ADD COLUMN IF NOT EXISTS external_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS support_ticket_seq START 1;

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  human_id TEXT NOT NULL UNIQUE DEFAULT 'TICK-' || LPAD(nextval('support_ticket_seq')::text, 4, '0'),
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  assignee_name TEXT,
  response_due_at TIMESTAMPTZ,
  resolve_due_at TIMESTAMPTZ,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Risk-first ticket contract (2026-08-01): additive, see the reward-table
-- comment above for why these are ALTER statements rather than inline
-- CREATE TABLE columns.
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS product_sku TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS serial_number TEXT;

CREATE TABLE IF NOT EXISTS support_ticket_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_role TEXT NOT NULL,
  body TEXT NOT NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Phase 4 (2026-07-30): internal-only support notes, hidden from partners.
ALTER TABLE support_ticket_comments ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;

DROP TRIGGER IF EXISTS support_tickets_updated_at ON support_tickets;
CREATE TRIGGER support_tickets_updated_at
BEFORE UPDATE ON support_tickets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Phase 2: deal lifecycle domain commands (optimistic concurrency + append-only transitions)
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS deal_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES portal_deals(id) ON DELETE CASCADE,
  command_name TEXT NOT NULL,
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE SET NULL,
  reason TEXT,
  correlation_id TEXT NOT NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_transitions_deal_id_idx ON deal_transitions (deal_id);

-- Phase 3 (partial): Assistant (chatbot), scoped to deal creation + monitoring.
-- Append-only conversation/audit log — no delete surface anywhere in the app.
CREATE TABLE IF NOT EXISTS assistant_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  proposed_action TEXT,
  action_payload JSONB,
  retrieved_deal_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  confirmed BOOLEAN,
  outcome TEXT,
  model TEXT,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- MVP Added Tables

CREATE TABLE IF NOT EXISTS deal_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES portal_deals(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  msrp_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  ptp_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  dtp_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  proposed_selling_price_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  reward_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pricing_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES portal_deals(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  total_ptp_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_dtp_usd NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_final BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, revision_number)
);

CREATE TABLE IF NOT EXISTS deal_outcome_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES portal_deals(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_applicable',
  po_document_url TEXT,
  po_number TEXT,
  po_date DATE,
  po_amount NUMERIC(14,2),
  currency_code TEXT DEFAULT 'USD',
  reason TEXT,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id)
);

-- Insight Hub (Learning) placeholder tables
CREATE TABLE IF NOT EXISTS learning_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_subjects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID NOT NULL REFERENCES learning_tracks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES learning_subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES learning_courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_url TEXT,
  content_type TEXT NOT NULL DEFAULT 'video',
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES learning_tracks(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress',
  score_percent NUMERIC(5,2),
  completed_at TIMESTAMPTZ,
  certificate_token TEXT UNIQUE,
  is_certified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS assistant_messages_conversation_id_idx ON assistant_messages (conversation_id);
CREATE INDEX IF NOT EXISTS assistant_messages_user_id_idx ON assistant_messages (user_id);

-- Phase 2: Tasks — first-class work items (blueprint Section 10). No delete
-- surface: closing out work is a status ("cancelled"), never a row removal.
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'to_do',
  priority TEXT NOT NULL DEFAULT 'medium',
  related_type TEXT,
  related_id UUID,
  assignee_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  creator_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ,
  blocked_reason TEXT,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_assignee_id_idx ON tasks (assignee_id);
CREATE INDEX IF NOT EXISTS tasks_partner_id_idx ON tasks (partner_id);
CREATE INDEX IF NOT EXISTS tasks_related_idx ON tasks (related_type, related_id);

DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at
BEFORE UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS task_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  command_name TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE SET NULL,
  reason TEXT,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_transitions_task_id_idx ON task_transitions (task_id);

-- RBAC permission matrix: role x feature CRUD flags, plus per-role region
-- (geography) access used by admin.roles.tsx, table-policy.server.ts, and
-- the Assistant. A role with no role_geography_access rows is unrestricted
-- (global) by convention — this keeps the table's seeding independent of
-- geography_nodes being populated (only db:bootstrap's demo seed populates
-- that tree; the ordinary db:migrate deploy path does not), so nothing
-- regresses for roles nobody has explicitly narrowed yet.
CREATE TABLE IF NOT EXISTS role_permissions (
  role_key TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_read BOOLEAN NOT NULL DEFAULT FALSE,
  can_update BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_key, feature_key)
);

DROP TRIGGER IF EXISTS role_permissions_updated_at ON role_permissions;
CREATE TRIGGER role_permissions_updated_at
BEFORE UPDATE ON role_permissions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS role_geography_access (
  role_key TEXT NOT NULL,
  geography_node_id TEXT NOT NULL REFERENCES geography_nodes(node_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_key, geography_node_id)
);

-- Default permission matrix. Super Admin gets full CRUD everywhere; the
-- partner roles mirror today's live partner-scoped behaviour; the six
-- currently-dormant internal roles (rm/pam/kam/isr/livey_support/
-- restricted_distributor) get read-leaning defaults approximating the
-- blueprint's permission matrix (docs/LIVEY-PAM-CRM-BLUEPRINT.md Section
-- 5.5). All of this is editable afterward from /admin/roles.
INSERT INTO role_permissions (role_key, feature_key, can_create, can_read, can_update, can_delete) VALUES
  ('super_admin', 'deals', true, true, true, true),
  ('super_admin', 'partners', true, true, true, true),
  ('super_admin', 'customers', true, true, true, true),
  ('super_admin', 'catalog', true, true, true, true),
  ('super_admin', 'tickets', true, true, true, true),
  ('super_admin', 'tasks', true, true, true, true),
  ('super_admin', 'learning', true, true, true, true),
  ('super_admin', 'rewards', true, true, true, true),
  ('super_admin', 'integrations', true, true, true, true),
  ('super_admin', 'users', true, true, true, true),
  ('super_admin', 'audit', true, true, true, true),
  ('super_admin', 'news', true, true, true, true),
  ('super_admin', 'assistant', true, true, true, true),
  ('super_admin', 'calls', true, true, true, true),

  ('rm', 'deals', true, true, true, false),
  ('rm', 'partners', false, true, true, false),
  ('rm', 'customers', true, true, true, false),
  ('rm', 'catalog', false, true, false, false),
  ('rm', 'tickets', true, true, true, false),
  ('rm', 'tasks', true, true, true, false),
  ('rm', 'learning', true, true, true, false),
  ('rm', 'rewards', false, true, false, false),
  ('rm', 'integrations', false, false, false, false),
  ('rm', 'users', false, false, false, false),
  ('rm', 'audit', false, true, false, false),
  ('rm', 'news', false, true, false, false),
  ('rm', 'assistant', true, true, false, false),

  ('pam', 'deals', true, true, true, false),
  ('pam', 'partners', false, true, true, false),
  ('pam', 'customers', true, true, true, false),
  ('pam', 'catalog', false, true, false, false),
  ('pam', 'tickets', true, true, true, false),
  ('pam', 'tasks', true, true, true, false),
  ('pam', 'learning', false, true, false, false),
  ('pam', 'rewards', false, true, false, false),
  ('pam', 'integrations', false, false, false, false),
  ('pam', 'users', false, false, false, false),
  ('pam', 'audit', false, true, false, false),
  ('pam', 'news', false, true, false, false),
  ('pam', 'assistant', true, true, false, false),

  ('kam', 'deals', true, true, true, false),
  ('kam', 'partners', false, true, false, false),
  ('kam', 'customers', true, true, true, false),
  ('kam', 'catalog', false, true, false, false),
  ('kam', 'tickets', true, true, true, false),
  ('kam', 'tasks', true, true, true, false),
  ('kam', 'learning', false, true, false, false),
  ('kam', 'rewards', false, false, false, false),
  ('kam', 'integrations', false, false, false, false),
  ('kam', 'users', false, false, false, false),
  ('kam', 'audit', false, true, false, false),
  ('kam', 'news', false, false, false, false),
  ('kam', 'assistant', true, true, false, false),

  ('isr', 'deals', true, true, true, false),
  ('isr', 'partners', false, true, false, false),
  ('isr', 'customers', true, true, true, false),
  ('isr', 'catalog', false, true, false, false),
  ('isr', 'tickets', false, true, false, false),
  ('isr', 'tasks', true, true, true, false),
  ('isr', 'learning', false, true, false, false),
  ('isr', 'rewards', false, false, false, false),
  ('isr', 'integrations', false, false, false, false),
  ('isr', 'users', false, false, false, false),
  ('isr', 'audit', false, true, false, false),
  ('isr', 'news', false, false, false, false),
  ('isr', 'assistant', true, true, false, false),

  ('livey_support', 'deals', false, true, false, false),
  ('livey_support', 'partners', false, true, false, false),
  ('livey_support', 'customers', false, true, true, false),
  ('livey_support', 'catalog', false, true, false, false),
  ('livey_support', 'tickets', true, true, true, false),
  ('livey_support', 'tasks', true, true, true, false),
  ('livey_support', 'learning', false, true, true, false),
  ('livey_support', 'rewards', false, false, false, false),
  ('livey_support', 'integrations', false, false, false, false),
  ('livey_support', 'users', false, false, false, false),
  ('livey_support', 'audit', false, true, false, false),
  ('livey_support', 'news', false, true, false, false),
  ('livey_support', 'assistant', false, true, false, false),
  ('livey_support', 'calls', true, true, true, true),

  ('restricted_distributor', 'deals', false, true, true, false),
  ('restricted_distributor', 'partners', false, false, false, false),
  ('restricted_distributor', 'customers', false, true, false, false),
  ('restricted_distributor', 'catalog', false, false, false, false),
  ('restricted_distributor', 'tickets', false, false, false, false),
  ('restricted_distributor', 'tasks', false, true, true, false),
  ('restricted_distributor', 'learning', false, true, false, false),
  ('restricted_distributor', 'rewards', false, false, false, false),
  ('restricted_distributor', 'integrations', false, false, false, false),
  ('restricted_distributor', 'users', false, false, false, false),
  ('restricted_distributor', 'audit', false, true, false, false),
  ('restricted_distributor', 'news', false, false, false, false),
  ('restricted_distributor', 'assistant', false, true, false, false),

  ('partner_admin', 'deals', true, true, true, false),
  ('partner_admin', 'partners', false, true, true, false),
  ('partner_admin', 'customers', true, true, true, false),
  ('partner_admin', 'catalog', false, true, false, false),
  ('partner_admin', 'tickets', true, true, true, false),
  ('partner_admin', 'tasks', true, true, true, false),
  ('partner_admin', 'learning', false, true, false, false),
  ('partner_admin', 'rewards', true, true, false, false),
  ('partner_admin', 'integrations', false, false, false, false),
  ('partner_admin', 'users', true, true, false, false),
  ('partner_admin', 'audit', false, true, false, false),
  ('partner_admin', 'news', false, true, false, false),
  ('partner_admin', 'assistant', true, true, false, false),

  ('partner_user', 'deals', true, true, true, false),
  ('partner_user', 'partners', false, true, false, false),
  ('partner_user', 'customers', true, true, true, false),
  ('partner_user', 'catalog', false, true, false, false),
  ('partner_user', 'tickets', true, true, true, false),
  ('partner_user', 'tasks', true, true, true, false),
  ('partner_user', 'learning', false, true, false, false),
  ('partner_user', 'rewards', true, true, false, false),
  ('partner_user', 'integrations', false, false, false, false),
  ('partner_user', 'users', false, false, false, false),
  ('partner_user', 'audit', false, true, false, false),
  ('partner_user', 'news', false, true, false, false),
  ('partner_user', 'assistant', true, true, false, false)
ON CONFLICT (role_key, feature_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS learning_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES learning_subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  passing_score NUMERIC NOT NULL DEFAULT 80.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_assessment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES learning_assessments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  score NUMERIC NOT NULL,
  is_passed BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS learning_assessments_updated_at ON learning_assessments;
CREATE TRIGGER learning_assessments_updated_at BEFORE UPDATE ON learning_assessments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS discount_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES portal_deals(id) ON DELETE CASCADE,
  line_item_id UUID NOT NULL REFERENCES deal_line_items(id) ON DELETE CASCADE,
  requested_discount_pct NUMERIC(6,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  reason TEXT,
  approver_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  requester_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS discount_requests_updated_at ON discount_requests;
CREATE TRIGGER discount_requests_updated_at BEFORE UPDATE ON discount_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Compatibility ALTERs for columns that were only declared inline on
-- CREATE TABLE IF NOT EXISTS above. Both support_tickets and
-- learning_enrollments already existed on any previously-migrated database,
-- so CREATE TABLE IF NOT EXISTS is a no-op there and the inline columns
-- never land — these explicit ADD COLUMN IF NOT EXISTS statements are what
-- actually apply them, following this file's established convention.
CREATE SEQUENCE IF NOT EXISTS support_ticket_seq START 1;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS human_id TEXT UNIQUE;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS response_due_at TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolve_due_at TIMESTAMPTZ;
UPDATE support_tickets SET human_id = 'TICK-' || LPAD(nextval('support_ticket_seq')::text, 4, '0')
WHERE human_id IS NULL;
ALTER TABLE support_tickets ALTER COLUMN human_id SET NOT NULL;
ALTER TABLE support_tickets ALTER COLUMN human_id SET DEFAULT
  'TICK-' || LPAD(nextval('support_ticket_seq')::text, 4, '0');

ALTER TABLE learning_enrollments ADD COLUMN IF NOT EXISTS certificate_token TEXT UNIQUE;
ALTER TABLE learning_enrollments ADD COLUMN IF NOT EXISTS is_certified BOOLEAN NOT NULL DEFAULT FALSE;

-- Reconcile the Insight Hub content-model mismatch: admin.learning.tsx and
-- insight-hub.tsx (pre-existing, from before this session) already query
-- learning_tracks.is_published/tier_requirement, learning_subjects.
-- order_index, and learning_lessons.subject_id/order_index/is_required —
-- none of which the "Insight Hub (Learning) placeholder tables" above ever
-- defined, so every one of those queries errors and both pages silently
-- render empty. These additive columns make the schema match the code that
-- already assumes them, per product.md §14.2's Track -> Subject -> Lesson
-- model (no Course level for the Technical track; Sales/Solution reuse the
-- same Subject level here since the UI has no separate Course surface).
ALTER TABLE learning_tracks ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE learning_tracks ADD COLUMN IF NOT EXISTS tier_requirement TEXT;
UPDATE learning_tracks SET is_published = TRUE WHERE status = 'published' AND NOT is_published;

ALTER TABLE learning_subjects ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0;
UPDATE learning_subjects SET order_index = sort_order WHERE order_index = 0 AND sort_order <> 0;

ALTER TABLE learning_lessons
  ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES learning_subjects(id) ON DELETE CASCADE;
ALTER TABLE learning_lessons ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0;
ALTER TABLE learning_lessons ADD COLUMN IF NOT EXISTS is_required BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE learning_lessons SET order_index = sort_order WHERE order_index = 0 AND sort_order <> 0;
-- New lessons are authored directly under a Subject (no admin UI ever
-- creates a Course row), so the legacy course_id link can no longer be
-- mandatory.
ALTER TABLE learning_lessons ALTER COLUMN course_id DROP NOT NULL;

-- insight-hub.tsx reads learning_enrollments.progress_percent (0-100,
-- driving the "Overall progress" stat and each track's progress bar), which
-- likewise never existed — every real enrollment renders NaN%.
ALTER TABLE learning_enrollments ADD COLUMN IF NOT EXISTS progress_percent INTEGER NOT NULL DEFAULT 0;

-- Pre-existing instance of the same CREATE-TABLE-IF-NOT-EXISTS-on-an-
-- already-existing-table gap: portal_catalog_items existed on this database
-- before product_code/currency_code/price_book_code/price_book_version/
-- product_status/archived_at were added to its definition above, so none of
-- those columns ever actually landed.
ALTER TABLE portal_catalog_items ADD COLUMN IF NOT EXISTS catalog_kind TEXT NOT NULL DEFAULT 'product';
ALTER TABLE portal_catalog_items ADD COLUMN IF NOT EXISTS product_code TEXT;
ALTER TABLE portal_catalog_items ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE portal_catalog_items ADD COLUMN IF NOT EXISTS price_book_code TEXT;
ALTER TABLE portal_catalog_items ADD COLUMN IF NOT EXISTS price_book_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE portal_catalog_items ADD COLUMN IF NOT EXISTS product_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE portal_catalog_items ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Same gap again: ticket-commands.server.ts and support.tsx have always
-- read/written support_ticket_comments.is_internal, but the column was
-- never in this table's CREATE TABLE definition, so every ticket reply
-- INSERT has been failing in production with "column is_internal does not
-- exist" since the ticket-command module landed.
ALTER TABLE support_ticket_comments ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;

-- product.md §19.8: audit events must be non-repudiable. Links every audit
-- row to the real authenticated user who caused it (stamped server-side by
-- table-policy.server.ts's withNonRepudiableActor), instead of trusting
-- only the free-text actor_name/actor_role the client sends.
ALTER TABLE portal_audit_events ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Same pre-existing gap, systematically: every governed pricing/catalogue
-- table below (products, product_variants, product_skus, combos,
-- combo_components, price_books, price_rows, fx_snapshots) already existed
-- as an empty table before its CREATE TABLE IF NOT EXISTS definition above
-- gained these columns, so none of them ever actually landed — despite this
-- session's Work Package B correctly resolving which of the two duplicate
-- definitions src/lib/pricing-domain.ts's ProductRecord/ProductVariantRecord/
-- ProductSkuRecord/ComboRecord/ComboComponentRecord/PriceBookRecord/
-- PriceRowRecord types actually expect. Every one of these tables has zero
-- rows on this database, so the handful that are NOT NULL with no DEFAULT
-- (sku_code, component_sku_id, snapshot_code, source_amount, target_amount)
-- are safe to add exactly as declared — nothing existing can violate them.
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS commercial_approved BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE products ADD COLUMN IF NOT EXISTS product_description TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_kind TEXT NOT NULL DEFAULT 'product';
ALTER TABLE products ADD COLUMN IF NOT EXISTS archived_reason TEXT;

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS archived_reason TEXT;

ALTER TABLE product_skus ADD COLUMN IF NOT EXISTS sku_code TEXT UNIQUE;
ALTER TABLE product_skus ALTER COLUMN sku_code SET NOT NULL;
ALTER TABLE product_skus ADD COLUMN IF NOT EXISTS discounted_transfer_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;
ALTER TABLE product_skus ADD COLUMN IF NOT EXISTS reward_eligible_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;
ALTER TABLE product_skus ADD COLUMN IF NOT EXISTS additional_discount_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;
ALTER TABLE product_skus ADD COLUMN IF NOT EXISTS archived_reason TEXT;

ALTER TABLE combos ADD COLUMN IF NOT EXISTS combo_description TEXT;
ALTER TABLE combos ADD COLUMN IF NOT EXISTS bundle_msrp_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;
ALTER TABLE combos ADD COLUMN IF NOT EXISTS bundle_transfer_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;
ALTER TABLE combos ADD COLUMN IF NOT EXISTS archived_reason TEXT;

ALTER TABLE combo_components
  ADD COLUMN IF NOT EXISTS component_sku_id UUID REFERENCES product_skus(id) ON DELETE RESTRICT;
ALTER TABLE combo_components ALTER COLUMN component_sku_id SET NOT NULL;
ALTER TABLE combo_components ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE combo_components ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE combo_components ADD COLUMN IF NOT EXISTS archived_reason TEXT;

ALTER TABLE price_books ADD COLUMN IF NOT EXISTS archived_reason TEXT;

ALTER TABLE price_rows ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;
ALTER TABLE price_rows ADD COLUMN IF NOT EXISTS reward_eligible_amount NUMERIC(18, 4) NOT NULL DEFAULT 0;
ALTER TABLE price_rows ADD COLUMN IF NOT EXISTS archived_reason TEXT;

ALTER TABLE fx_snapshots ADD COLUMN IF NOT EXISTS snapshot_code TEXT UNIQUE;
ALTER TABLE fx_snapshots ALTER COLUMN snapshot_code SET NOT NULL;
ALTER TABLE fx_snapshots ADD COLUMN IF NOT EXISTS source_amount NUMERIC(18, 4);
ALTER TABLE fx_snapshots ALTER COLUMN source_amount SET NOT NULL;
ALTER TABLE fx_snapshots ADD COLUMN IF NOT EXISTS target_amount NUMERIC(18, 4);
ALTER TABLE fx_snapshots ALTER COLUMN target_amount SET NOT NULL;
ALTER TABLE fx_snapshots ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'internal';
ALTER TABLE fx_snapshots ADD COLUMN IF NOT EXISTS archived_reason TEXT;

-- Insight Hub completion flow: lessons had no viewable body (content_url was
-- always null in every seed/authoring path), and there was no way to record
-- that a learner actually opened a given lesson — enrollment progress could
-- never move past 0% except by an admin hand-editing the row. content_body
-- holds inline lesson text (dummy content is all content_type='text', no
-- external video URLs); learning_lesson_progress is the per-lesson
-- completion record learning-commands.server.ts's completeLesson() writes,
-- which drives learning_enrollments.progress_percent/status/certificate_token
-- the same way submitAssessmentAttempt already does for the assessment path.
ALTER TABLE learning_lessons ADD COLUMN IF NOT EXISTS content_body TEXT;

CREATE TABLE IF NOT EXISTS learning_lesson_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES learning_lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS learning_lesson_progress_user_id_idx ON learning_lesson_progress (user_id);
CREATE INDEX IF NOT EXISTS learning_lesson_progress_lesson_id_idx ON learning_lesson_progress (lesson_id);

-- Auto-task-on-tag: deal_participants/customer_participants only ever
-- recorded a role-type label plus who performed the tagging action, never
-- which specific person was tagged, so nothing could ever be routed to them.
-- tagDealParticipant already accepted a participantUserId in its input type
-- but silently dropped it before this column existed. Nullable: automatic/
-- role-level tags (product.md §5.7) may still exist with no specific person
-- resolved yet.
ALTER TABLE deal_participants ADD COLUMN IF NOT EXISTS participant_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE customer_participants ADD COLUMN IF NOT EXISTS participant_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Google Sign-In: identity linking only, not a new access grant on its own —
-- a brand-new Google signup still goes through bootstrapPartnerAssignment
-- the same as any other self-registered partner admin. google_id is UNIQUE
-- so one Google account can only ever link to one profile; NULL is allowed
-- (and multiple NULLs never conflict under a UNIQUE constraint) for every
-- profile that has never connected a Google account at all.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS google_email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS google_linked_at TIMESTAMPTZ;

-- WhatsApp Assistant: OTP-verified account linking (Twilio Verify). Same
-- shape as Google linking above — whatsapp_phone_e164 is UNIQUE so one
-- WhatsApp number can only ever link to one profile, NULL allowed for
-- every profile that hasn't linked one.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS whatsapp_phone_e164 TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS whatsapp_verified_at TIMESTAMPTZ;

-- assistant_messages.conversation_id widens from UUID to TEXT: WhatsApp
-- threads use a deterministic non-UUID id ("whatsapp:<phoneE164>") so
-- history can be reloaded per-thread with no client-side state, alongside
-- random UUIDs for web conversations. channel distinguishes the two so
-- history queries can filter/thread them separately.
ALTER TABLE assistant_messages ALTER COLUMN conversation_id TYPE TEXT USING conversation_id::text;
ALTER TABLE assistant_messages ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'web';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assistant_messages_channel_check'
      AND conrelid = 'assistant_messages'::regclass
  ) THEN
    ALTER TABLE assistant_messages ADD CONSTRAINT assistant_messages_channel_check CHECK (channel IN ('web', 'whatsapp'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS assistant_messages_channel_conversation_idx ON assistant_messages (channel, conversation_id);

-- Tiny generic key/value store — first use: caching the Twilio Content API
-- SIDs for the WhatsApp menu's interactive list-picker/quick-reply
-- templates, created lazily on first use and reused across restarts
-- instead of creating a fresh Content resource on every deploy.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WhatsApp guided-menu wizard: tracks which deterministic step a
-- conversation is on (browsing a record type, or mid-way through the
-- Create-a-Deal flow) so multi-step flows don't depend on an LLM correctly
-- re-inferring state from free-text history every turn. One row per active
-- conversation; deleted when a flow finishes, is cancelled, or the user
-- returns to the main menu.
CREATE TABLE IF NOT EXISTS whatsapp_wizard_state (
  conversation_id TEXT PRIMARY KEY,
  flow TEXT NOT NULL,
  step TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Call Center Phase 1: Voice calling (Twilio Voice + browser softphone).
-- Brand-new table, so plain CREATE TABLE IF NOT EXISTS is correct here —
-- unlike profiles.call_ready below, call_logs doesn't exist on any
-- previously-migrated database, so there's no "existing table" trap.
CREATE TABLE IF NOT EXISTS call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_call_sid TEXT UNIQUE NOT NULL,
  direction TEXT NOT NULL,              -- 'inbound' | 'outbound'
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  agent_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL,                 -- queued/ringing/in-progress/completed/busy/failed/no-answer/canceled
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  recording_url TEXT,
  disposition TEXT,
  linked_ticket_id UUID REFERENCES support_tickets(id) ON DELETE SET NULL,
  linked_deal_id UUID REFERENCES portal_deals(id) ON DELETE SET NULL,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_logs_agent_user_id_idx ON call_logs (agent_user_id);
CREATE INDEX IF NOT EXISTS call_logs_created_at_idx ON call_logs (created_at DESC);

-- Simple agent presence for Phase 1 (no live "who's on duty" dashboard
-- yet — that's Phase 2). The softphone panel's ready/not-ready toggle
-- writes this directly; the inbound-call webhook reads it to decide who
-- to ring. profiles is an existing production table, so this MUST be an
-- explicit ALTER TABLE ADD COLUMN IF NOT EXISTS (same trap/fix as
-- google_id/whatsapp_phone_e164 above) — inlining it into the CREATE
-- TABLE IF NOT EXISTS profiles block near the top of this file would
-- silently never apply here.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS call_ready BOOLEAN NOT NULL DEFAULT FALSE;
