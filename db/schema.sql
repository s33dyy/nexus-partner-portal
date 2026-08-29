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
    'partial_approval',
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
  ALTER TYPE partner_status ADD VALUE IF NOT EXISTS 'partial_approval' AFTER 'need_more_info';
  ALTER TYPE partner_status ADD VALUE IF NOT EXISTS 'pending_agreement' AFTER 'partial_approval';
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

-- portal_deals has no forward dependencies, so it's created here, ahead of
-- deal_documents/partner_review_notes/portal_deal_collaborators below, all of
-- which reference it via foreign key. Without this ordering, applying this
-- file against a genuinely empty database (fresh Docker/Railway deploy)
-- fails with "relation portal_deals does not exist" the first time.
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

-- §2.6/§9.15 (Deals Phase 3): Won's PO Upload-Now-or-Submit-Later choice.
-- markDealWon already writes `close_date` (the outcome date — no new column
-- needed for that, just accepting a caller-supplied value instead of always
-- defaulting to today) but had nowhere to record which PO path the reviewer
-- picked. portal_deals is an existing production table, so — same trap as
-- every ALTER above — this MUST land as an idempotent ADD COLUMN, never
-- edited into the CREATE TABLE IF NOT EXISTS portal_deals block near the
-- top of this file. Nullable: existing rows and deals closed Won before
-- this column existed have no value to backfill.
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS po_choice TEXT;

-- 9g (§9.11/§23's Coverage Exception dictionary, product.md lines 214/681-
-- 699): "A governed work item created when a required RM, ISR, PAM, or KAM
-- cannot be resolved. It blocks the protected Deal action until the missing
-- Assignment is corrected and reconciliation succeeds." Brand-new table (no
-- previously-migrated database has it), so plain CREATE TABLE IF NOT EXISTS
-- is correct here — same as call_logs above, unlike every ALTER on this
-- page. Minimal, bounded implementation: the full Open -> In Remediation ->
-- Resolved/Cancelled workflow (queue UI, reconciliation retry, SLA
-- countdown) is NOT built — only Open is ever written by moveDealStageForward's
-- Testing -> Qualified handoff check, which blocks the transition outright
-- whenever a required PAM/KAM mapping can't be resolved. status/resolution/
-- resolved_at exist so a future remediation UI has somewhere to write, but
-- nothing reads or transitions them yet.
CREATE TABLE IF NOT EXISTS coverage_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  required_role TEXT NOT NULL,              -- 'pam' | 'kam' | 'rm' | 'isr'
  coverage_key TEXT NOT NULL,                -- the partner_id/customer_id the mapping was missing for
  deal_id UUID NOT NULL REFERENCES portal_deals(id) ON DELETE CASCADE,
  action TEXT NOT NULL,                      -- the protected action this blocked, e.g. 'deal.testing_to_qualified'
  status TEXT NOT NULL DEFAULT 'open',       -- open | in_remediation | resolved | cancelled
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sla_target_at TIMESTAMPTZ,
  responsible_role TEXT,                     -- who owns resolving it (product.md: Super Admin Assignment Operations)
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coverage_exceptions_deal_id_idx ON coverage_exceptions (deal_id);
CREATE INDEX IF NOT EXISTS coverage_exceptions_status_idx ON coverage_exceptions (status);

-- ---------------------------------------------------------------------------
-- 2026-08-11: Proposed completion dates + reminder dispatch ledger.
--
-- "Proposed completion date" is the owner's own forecast of when a Task or
-- Deal will actually be finished. It is deliberately NOT the same column as
-- the existing hard dates: tasks.due_at is the deadline someone else set,
-- and portal_deals.close_date is the committed close (with
-- possible_close_date being the sales-side probable close used for pipeline
-- weighting). Overloading either of those would have destroyed the ability
-- to say "this was promised for the 5th and is now forecast for the 12th",
-- which is the whole point of reminding on it.
--
-- Both are additive ALTERs, never inline CREATE TABLE columns, because
-- db:migrate re-runs this entire file against the already-bootstrapped
-- production database on every deploy and CREATE TABLE IF NOT EXISTS is a
-- no-op there.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS proposed_completion_at TIMESTAMPTZ;
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS proposed_completion_date DATE;

CREATE INDEX IF NOT EXISTS tasks_proposed_completion_at_idx
  ON tasks (proposed_completion_at)
  WHERE proposed_completion_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS portal_deals_proposed_completion_date_idx
  ON portal_deals (proposed_completion_date)
  WHERE proposed_completion_date IS NOT NULL;

-- Per-user reminder opt-out. Nothing in the app writes this yet except
-- Settings; the reminder sweep reads it as a hard mute across every channel.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS reminder_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

-- Reminder idempotency ledger. The sweep is intentionally re-runnable (an
-- in-process interval AND an external cron endpoint can both trigger it, and
-- a Railway redeploy restarts the interval mid-day), so "have I already told
-- this person about this?" cannot live in memory. One row per
-- subject x recipient x offset x channel x target_date.
--
-- target_date is part of the uniqueness key on purpose: if an owner moves a
-- proposed completion date, that is a genuinely new promise and the whole
-- reminder ladder legitimately re-fires against the new date rather than
-- being suppressed by the old date's rows.
--
-- Brand-new table, so plain CREATE TABLE IF NOT EXISTS is correct here.
CREATE TABLE IF NOT EXISTS reminder_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type TEXT NOT NULL,                -- 'task' | 'deal'
  subject_id UUID NOT NULL,
  recipient_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  offset_key TEXT NOT NULL,                  -- see REMINDER_OFFSETS in domain/contracts/reminders.ts
  channel TEXT NOT NULL,                     -- 'in_app' | 'whatsapp' | 'email'
  target_date DATE NOT NULL,                 -- the proposed completion date this fired against
  status TEXT NOT NULL DEFAULT 'sent',       -- sent | skipped | failed
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reminder_dispatches_dedupe_uidx
  ON reminder_dispatches (subject_type, subject_id, recipient_user_id, offset_key, channel, target_date);
CREATE INDEX IF NOT EXISTS reminder_dispatches_created_at_idx ON reminder_dispatches (created_at);

-- ---------------------------------------------------------------------------
-- 2026-08-12: Daily digest email.
--
-- Separate from reminder_dispatches on purpose. That table's uniqueness key is
-- (subject, subject_id, recipient, offset, channel, target_date) because a
-- reminder is about a RECORD; a digest is about a PERSON and a DAY, and has no
-- subject at all. Reusing it would have meant a synthetic subject_id and a
-- misleading table name for anyone reading the schema later.
--
-- One row per recipient per day, unique so the sweep is safe to run on the
-- same interval as reminders (every 30 minutes) without ever sending twice.
CREATE TABLE IF NOT EXISTS digest_email_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | skipped | failed
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS digest_email_dispatches_dedupe_uidx
  ON digest_email_dispatches (recipient_user_id, target_date);
CREATE INDEX IF NOT EXISTS digest_email_dispatches_created_at_idx
  ON digest_email_dispatches (created_at);

-- Separate opt-out from reminder_opt_out: a user who mutes per-record nudges
-- may still want the once-a-day summary, and vice versa. Collapsing them into
-- one flag would make "turn off reminders" silently also stop the digest.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS digest_email_opt_out BOOLEAN NOT NULL DEFAULT FALSE;

-- --- Loss reason categories (product.md §9.15 "Lost requires: loss reason") ------
-- The free-text reason on deal_transitions records WHY a specific deal was lost,
-- which is the audit trail. It cannot answer "what are we losing to?" across the
-- book — every row is a unique sentence. A bounded category alongside it makes
-- that question answerable without taking the narrative away: the dialog asks for
-- both, and the category is what Analytics groups by.
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS loss_reason_category TEXT;
ALTER TABLE portal_deals ADD COLUMN IF NOT EXISTS loss_reason_detail TEXT;

CREATE INDEX IF NOT EXISTS portal_deals_loss_reason_category_idx
  ON portal_deals (loss_reason_category)
  WHERE loss_reason_category IS NOT NULL;

-- --- Product imagery -----------------------------------------------------------
-- Matches the column that portal_news_posts and reward_catalog_items already
-- use, so the catalogue reads the same way as every other pictured record and
-- the existing <img src={image_path}> convention carries over unchanged.
-- Nullable: a product without a photo is normal, and a broken <img> is worse
-- than none, so the UI branches on null rather than rendering an empty box.
ALTER TABLE portal_catalog_items ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE portal_catalog_items ADD COLUMN IF NOT EXISTS image_alt TEXT;

-- ===========================================================================
-- Distributor Management System (DMS) — product.md §24
-- ===========================================================================
--
-- Every statement below is additive and idempotent: db:migrate re-runs this
-- whole file against the already-bootstrapped production database on every
-- deploy, so new columns on existing tables are ALTER ... ADD COLUMN IF NOT
-- EXISTS, never inline CREATE TABLE columns (CREATE TABLE IF NOT EXISTS is a
-- no-op on a table that already exists, and the inline column would never
-- land). The six DMS tables themselves are brand new, so plain
-- CREATE TABLE IF NOT EXISTS is correct for them.
--
-- None of these tables is registered in TABLE_COLUMNS (livey-service.server.ts)
-- and all of them are denied on the generic queryTable()/supabase.from() path
-- for every role including super_admin. Every legitimate access goes through a
-- named server function in distribution-commands.server.ts /
-- distribution-queries.server.ts using raw pool.query.

CREATE SEQUENCE IF NOT EXISTS stock_request_seq START 1;

-- A named physical place that holds stock. A 'distributor' location belongs
-- to exactly one Distributor Assignment and a 'livey_warehouse' belongs to
-- none — enforced by the CHECK below rather than left to convention, because
-- a distributor location with no owner would be visible to nobody and a
-- warehouse with one would be visible to the wrong person.
CREATE TABLE IF NOT EXISTS stock_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_code TEXT NOT NULL UNIQUE,
  location_name TEXT NOT NULL,
  location_type TEXT NOT NULL CHECK (location_type IN ('livey_warehouse','distributor')),
  tenant_id TEXT NOT NULL REFERENCES governed_tenants(tenant_id) ON DELETE RESTRICT,
  organization_tenant_id TEXT NOT NULL REFERENCES governed_tenants(tenant_id) ON DELETE RESTRICT,
  geography_node_id TEXT NOT NULL REFERENCES geography_nodes(node_id) ON DELETE RESTRICT,
  distributor_assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE RESTRICT,
  custodian_assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((location_type = 'distributor') = (distributor_assignment_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS stock_locations_distributor_idx
  ON stock_locations (distributor_assignment_id)
  WHERE distributor_assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_locations_custodian_idx
  ON stock_locations (custodian_assignment_id)
  WHERE custodian_assignment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_locations_type_idx ON stock_locations (location_type, active);

DROP TRIGGER IF EXISTS stock_locations_updated_at ON stock_locations;
CREATE TRIGGER stock_locations_updated_at
BEFORE UPDATE ON stock_locations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- distributor_assignment_id and manager_assignment_id are SNAPSHOTS taken at
-- submission (§24.3), not live lookups. A later reorganisation must not move
-- an in-flight request to a different approver, so approval authority is read
-- from this row and never re-derived from the requester's current Assignment.
CREATE TABLE IF NOT EXISTS stock_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  human_id TEXT NOT NULL UNIQUE DEFAULT 'DMS-' || LPAD(nextval('stock_request_seq')::text, 6, '0'),
  distributor_assignment_id TEXT NOT NULL REFERENCES assignments(assignment_id) ON DELETE RESTRICT,
  requester_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  manager_assignment_id TEXT NOT NULL REFERENCES assignments(assignment_id) ON DELETE RESTRICT,
  destination_location_id UUID NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  deal_id UUID REFERENCES portal_deals(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES portal_customers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'submitted',
  priority TEXT NOT NULL DEFAULT 'medium',
  required_by DATE NOT NULL,
  reason TEXT NOT NULL,
  decision_reason TEXT,
  exception_reason TEXT,
  exception_from_status TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN (
    'submitted','approved','awaiting_stock','partially_allocated','allocated',
    'dispatched','partially_received','received','exception','rejected','cancelled'
  )),
  CHECK (priority IN ('low','medium','high','urgent'))
);

CREATE INDEX IF NOT EXISTS stock_requests_distributor_idx
  ON stock_requests (distributor_assignment_id, status);
CREATE INDEX IF NOT EXISTS stock_requests_manager_idx
  ON stock_requests (manager_assignment_id, status);
CREATE INDEX IF NOT EXISTS stock_requests_destination_idx ON stock_requests (destination_location_id);
CREATE INDEX IF NOT EXISTS stock_requests_deal_idx ON stock_requests (deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_requests_customer_idx
  ON stock_requests (customer_id) WHERE customer_id IS NOT NULL;

DROP TRIGGER IF EXISTS stock_requests_updated_at ON stock_requests;
CREATE TRIGGER stock_requests_updated_at
BEFORE UPDATE ON stock_requests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- The quantity ladder from §24.3. Each rung is bounded by the one above it,
-- so the database refuses a line that claims more shipped than reserved or
-- more arrived than shipped even if a command ever forgets to check.
CREATE TABLE IF NOT EXISTS stock_request_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES stock_requests(id) ON DELETE RESTRICT,
  product_sku_id UUID NOT NULL REFERENCES product_skus(id) ON DELETE RESTRICT,
  source_location_id UUID REFERENCES stock_locations(id) ON DELETE RESTRICT,
  requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
  approved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (approved_quantity >= 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  dispatched_quantity INTEGER NOT NULL DEFAULT 0 CHECK (dispatched_quantity >= 0),
  received_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, product_sku_id),
  CHECK (approved_quantity <= requested_quantity),
  CHECK (reserved_quantity <= approved_quantity),
  CHECK (dispatched_quantity <= reserved_quantity),
  CHECK (received_quantity <= dispatched_quantity)
);

CREATE INDEX IF NOT EXISTS stock_request_lines_request_idx ON stock_request_lines (request_id);
CREATE INDEX IF NOT EXISTS stock_request_lines_sku_idx ON stock_request_lines (product_sku_id);
CREATE INDEX IF NOT EXISTS stock_request_lines_source_idx
  ON stock_request_lines (source_location_id) WHERE source_location_id IS NOT NULL;

DROP TRIGGER IF EXISTS stock_request_lines_updated_at ON stock_request_lines;
CREATE TRIGGER stock_request_lines_updated_at
BEFORE UPDATE ON stock_request_lines
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- The balance PROJECTION: one row per (SKU, location), rebuildable at any
-- time from inventory_movements below, which is the actual truth. Available
-- is deliberately absent — it is computed as
-- on_hand - reserved - damaged in SQL so it cannot drift from its inputs.
CREATE TABLE IF NOT EXISTS inventory_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_sku_id UUID NOT NULL REFERENCES product_skus(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  on_hand_quantity INTEGER NOT NULL DEFAULT 0 CHECK (on_hand_quantity >= 0),
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  damaged_quantity INTEGER NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
  in_transit_quantity INTEGER NOT NULL DEFAULT 0 CHECK (in_transit_quantity >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_sku_id, location_id),
  -- Committed and written-off units both come out of what is physically
  -- present; together they can never exceed it.
  CHECK (reserved_quantity + damaged_quantity <= on_hand_quantity)
);

CREATE INDEX IF NOT EXISTS inventory_balances_location_idx ON inventory_balances (location_id);

DROP TRIGGER IF EXISTS inventory_balances_updated_at ON inventory_balances;
CREATE TRIGGER inventory_balances_updated_at
BEFORE UPDATE ON inventory_balances
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Immutable ledger. Rows are never updated and never deleted; a mistake is
-- corrected by posting a compensating movement with a reason. Every row
-- carries who did it, under which Assignment, why, the correlation ID that
-- ties it to the rest of the request's evidence, and the before/after
-- quantities on both sides so a projection can be audited without replaying
-- the whole table.
CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type TEXT NOT NULL,
  product_sku_id UUID NOT NULL REFERENCES product_skus(id) ON DELETE RESTRICT,
  source_location_id UUID REFERENCES stock_locations(id) ON DELETE RESTRICT,
  destination_location_id UUID REFERENCES stock_locations(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  request_id UUID REFERENCES stock_requests(id) ON DELETE RESTRICT,
  request_line_id UUID REFERENCES stock_request_lines(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES profiles(id) ON DELETE RESTRICT,
  assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE RESTRICT,
  reason TEXT,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  source_on_hand_before INTEGER,
  source_on_hand_after INTEGER,
  source_reserved_before INTEGER,
  source_reserved_after INTEGER,
  source_damaged_before INTEGER,
  source_damaged_after INTEGER,
  destination_on_hand_before INTEGER,
  destination_on_hand_after INTEGER,
  destination_in_transit_before INTEGER,
  destination_in_transit_after INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (movement_type IN (
    'opening_balance','receipt','reservation','reservation_release','dispatch',
    'delivery','transfer','damage','adjustment'
  )),
  CHECK (source_location_id IS NOT NULL OR destination_location_id IS NOT NULL),
  CHECK (source_location_id IS DISTINCT FROM destination_location_id)
);

CREATE INDEX IF NOT EXISTS inventory_movements_sku_time_idx
  ON inventory_movements (product_sku_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_source_idx
  ON inventory_movements (source_location_id, created_at DESC)
  WHERE source_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_movements_destination_idx
  ON inventory_movements (destination_location_id, created_at DESC)
  WHERE destination_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_movements_request_idx
  ON inventory_movements (request_id) WHERE request_id IS NOT NULL;

-- Every state change a request ever made, including the reason and the
-- Assignment the actor held at the time. There is no hard delete of a
-- request, so this is the complete history.
CREATE TABLE IF NOT EXISTS stock_request_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES stock_requests(id) ON DELETE RESTRICT,
  command_name TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor_user_id UUID REFERENCES profiles(id) ON DELETE RESTRICT,
  assignment_id TEXT REFERENCES assignments(assignment_id) ON DELETE RESTRICT,
  reason TEXT,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_request_transitions_request_idx
  ON stock_request_transitions (request_id, created_at DESC);

-- --- Workflow automation evidence on the existing Task/Notification tables --
--
-- Additive ALTERs, never inline CREATE TABLE columns: both tables exist on
-- every previously-migrated database.
--
-- automation_key is what makes a replayed command converge instead of
-- opening a second Task. The unique index is PARTIAL so the millions of
-- hand-created Tasks that carry NULL are unaffected, and it excludes closed
-- Tasks so the same automation key can legitimately recur on a later
-- request cycle after the first one is done.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS automation_source TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS automation_template_version INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS automation_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_automation_key_open_idx
  ON tasks (automation_key)
  WHERE automation_key IS NOT NULL AND status NOT IN ('completed', 'cancelled');

CREATE INDEX IF NOT EXISTS tasks_automation_source_idx
  ON tasks (automation_source) WHERE automation_source IS NOT NULL;

-- event_key is scoped per recipient, not per event: one recipient gets one
-- Notification per event, while different recipients each get their own.
-- A single global unique key would have silently delivered a shortage
-- notice to whichever of the three recipients happened to be inserted first.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subject_type TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subject_id TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_event_key_idx
  ON notifications (user_id, event_key)
  WHERE event_key IS NOT NULL AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notifications_subject_idx
  ON notifications (subject_type, subject_id)
  WHERE subject_type IS NOT NULL;

-- --- Distribution permission defaults (product.md §24.4.1) ------------------
--
-- Delete is FALSE for every role including super_admin: §24.2 forbids
-- destroying inventory history, and a correction is a compensating movement,
-- not a deletion. Roles absent from this list inherit the table's all-false
-- column defaults through the rows below. Editable afterward from
-- /admin/roles, like the rest of the matrix.
INSERT INTO role_permissions (role_key, feature_key, can_create, can_read, can_update, can_delete) VALUES
  ('super_admin', 'distribution', true, true, true, false),
  ('rm', 'distribution', false, true, true, false),
  ('pam', 'distribution', false, true, true, false),
  ('restricted_distributor', 'distribution', true, true, true, false),
  ('kam', 'distribution', false, false, false, false),
  ('isr', 'distribution', false, false, false, false),
  ('livey_support', 'distribution', false, false, false, false),
  ('partner_admin', 'distribution', false, false, false, false),
  ('partner_user', 'distribution', false, false, false, false)
ON CONFLICT (role_key, feature_key) DO NOTHING;

-- --- Product-surface readiness flags ---------------------------------------
--
-- Seeded disabled so the row exists for an operator to flip, without the
-- surface ever being on by default. DO NOTHING on conflict is deliberate: a
-- re-run of this file must never flip a flag an operator has deliberately
-- changed, in either direction.
INSERT INTO feature_flags (
  flag_key, label, enabled, owner, cohort, dependencies, metrics, expires_at, rollback, audit_required, is_seed
) VALUES
  (
    'distribution-core',
    'Distributor stock requests and inventory',
    false,
    'Distribution and Logistics',
    'internal-only',
    ARRAY['command-framework-write','baseline-telemetry'],
    ARRAY['stock-request-throughput','distribution-denial-rate'],
    NULL,
    'Disable distribution-core first. Navigation, direct routes, and every DMS command fail closed; movement and request history is retained, never deleted.',
    true,
    true
  ),
  (
    'integration-operations-centre',
    'Integration operations centre',
    false,
    'Platform Integrations',
    'internal-only',
    ARRAY['baseline-telemetry'],
    ARRAY['integration-readiness-reads'],
    NULL,
    'Disable the flag; /admin/integrations returns to the unavailable page.',
    true,
    true
  ),
  (
    'learning-lesson-authoring',
    'Insight Hub lesson authoring',
    false,
    'Enablement',
    'internal-only',
    ARRAY['command-framework-write'],
    ARRAY['lesson-authoring-writes'],
    NULL,
    'Disable the flag; the lesson authoring action disappears from Learning admin.',
    true,
    true
  ),
  (
    'gyftr-fulfillment',
    'GyFTR digital reward fulfillment',
    false,
    'Rewards',
    'internal-only',
    ARRAY['command-framework-write'],
    ARRAY['voucher-issue-success','voucher-issue-failure'],
    NULL,
    'Disable the flag; digital rewards become unrequestable and unapprovable, and no provider call is made.',
    true,
    true
  ),
  (
    'product-recommendations',
    'Product recommendations',
    false,
    'Distribution and Logistics',
    'internal-only',
    ARRAY['baseline-telemetry'],
    ARRAY['recommendation-impressions','recommendation-accepts'],
    NULL,
    'Disable the flag; every recommendation panel disappears and no recommendation query runs. Nothing else changes — recommendations are read-only and derive from history that stays put.',
    true,
    true
  )
ON CONFLICT (flag_key) DO NOTHING;

-- --- News post audience targeting (product.md §11) --------------------------
--
-- Additive ALTERs, never inline CREATE TABLE columns: portal_news_posts
-- exists on every previously-migrated database.
--
-- Empty array means EVERYONE, which is why the default is '{}' and not NULL
-- semantics: every post written before targeting existed keeps reaching the
-- whole audience. A migration that silently narrowed old posts to nobody
-- would look like the partner feed had broken.
--
-- Region keys are the SALES_REGIONS vocabulary the header filter already uses
-- (domain/contracts/world-geography.ts), not free text and not geography_nodes
-- — the audience question is "which sales region", and that is the list the
-- reader is already filtering the rest of the app by.
ALTER TABLE portal_news_posts
  ADD COLUMN IF NOT EXISTS target_region_keys TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE portal_news_posts
  ADD COLUMN IF NOT EXISTS target_partner_ids UUID[] NOT NULL DEFAULT '{}';

-- GIN indexes so "which posts reach this partner / this region" stays an
-- index lookup rather than a scan once the feed grows.
CREATE INDEX IF NOT EXISTS portal_news_posts_target_regions_idx
  ON portal_news_posts USING GIN (target_region_keys);
CREATE INDEX IF NOT EXISTS portal_news_posts_target_partners_idx
  ON portal_news_posts USING GIN (target_partner_ids);

-- --- Outreach sequences (automated follow-up cadences) ----------------------
--
-- A Sequence is an ordered list of Steps. An email step is sent unattended by
-- the sweep in outreach-sweep.server.ts; a task step opens a Task for the
-- owner through the same ensureAutomatedTask() path every other workflow
-- uses, so a generated "call them" reminder lives in /tasks beside the rest
-- of a rep's work rather than in a parallel to-do list nobody checks.
--
-- All four tables are new, so plain CREATE TABLE IF NOT EXISTS is safe here
-- (unlike the ALTERs above, which extend tables that already exist on
-- previously-migrated databases).

CREATE TABLE IF NOT EXISTS outreach_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  -- Weekends are skipped when set, so a four-day cadence started on a
  -- Thursday finishes the following Wednesday instead of mailing somebody on
  -- a Sunday.
  business_days_only BOOLEAN NOT NULL DEFAULT TRUE,
  -- Later emails carry "Re: <first subject>" so the thread reads as one
  -- conversation in the recipient's client.
  thread_as_reply BOOLEAN NOT NULL DEFAULT TRUE,
  -- When a Deal is opened for an enrolled Customer the cadence stops: the
  -- sequence has done its job and continuing to prospect somebody who is
  -- already in a live deal is the single most embarrassing thing an
  -- automation can do.
  unenroll_on_deal_created BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outreach_sequences_partner_idx ON outreach_sequences (partner_id);
CREATE INDEX IF NOT EXISTS outreach_sequences_owner_idx ON outreach_sequences (owner_id);
CREATE INDEX IF NOT EXISTS outreach_sequences_status_idx ON outreach_sequences (status);

DROP TRIGGER IF EXISTS outreach_sequences_updated_at ON outreach_sequences;
CREATE TRIGGER outreach_sequences_updated_at
BEFORE UPDATE ON outreach_sequences
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS outreach_sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  -- Days from the enrolment date, counted in business days when the parent
  -- sequence says so. Two steps may share an offset (send the email, then
  -- open the "connect on LinkedIn" task the same day).
  day_offset INTEGER NOT NULL DEFAULT 0,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  task_title TEXT NOT NULL DEFAULT '',
  task_priority TEXT NOT NULL DEFAULT 'medium',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, step_index)
);

CREATE INDEX IF NOT EXISTS outreach_sequence_steps_sequence_idx
  ON outreach_sequence_steps (sequence_id, step_index);

CREATE TABLE IF NOT EXISTS outreach_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES outreach_sequences(id) ON DELETE CASCADE,
  -- Optional: an enrolment can target a bare address, but linking a Customer
  -- is what gives {{company}}/{{country}}/{{segment}} something to resolve to
  -- and what lets "a Deal opened" unenrol the contact automatically.
  customer_id UUID REFERENCES portal_customers(id) ON DELETE SET NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL,
  contact_email_normalized TEXT NOT NULL,
  -- The one-off line a rep adds for this person only ("hope Jake's game went
  -- well") — merged into the first email above the template body.
  personal_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  enrolled_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  unenroll_reason TEXT,
  unenrolled_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live enrolment per address per sequence. Enrolling the same person
-- twice is always a mistake — usually a double-click on the enrol button —
-- and the partial index lets them be re-enrolled later, once the first run
-- has finished or been stopped.
CREATE UNIQUE INDEX IF NOT EXISTS outreach_enrollments_active_contact_idx
  ON outreach_enrollments (sequence_id, contact_email_normalized)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS outreach_enrollments_sequence_idx
  ON outreach_enrollments (sequence_id, status);
CREATE INDEX IF NOT EXISTS outreach_enrollments_customer_idx
  ON outreach_enrollments (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS outreach_enrollments_partner_idx ON outreach_enrollments (partner_id);

DROP TRIGGER IF EXISTS outreach_enrollments_updated_at ON outreach_enrollments;
CREATE TRIGGER outreach_enrollments_updated_at
BEFORE UPDATE ON outreach_enrollments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- One row per (enrolment, step), materialised at enrolment time. Computing
-- the whole timeline up front is what makes the sweep a plain
-- "WHERE scheduled_for <= now() AND status = 'pending'" scan, makes an
-- enrolment's future visible in the UI, and stops a sequence edited tomorrow
-- from silently rewriting a cadence somebody is halfway through.
CREATE TABLE IF NOT EXISTS outreach_step_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES outreach_enrollments(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES outreach_sequence_steps(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- Set by the claiming UPDATE. A row stuck in 'sending' past
  -- STALE_CLAIM_MINUTES is reclaimed on a later sweep — that only happens if
  -- the process died mid-step.
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  detail TEXT,
  -- Task steps record the Task they opened so the timeline can link to it.
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  -- Open tracking: the pixel URL carries this token, so a token leak reveals
  -- nothing but the fact that one anonymous message was opened.
  tracking_token TEXT UNIQUE,
  open_count INTEGER NOT NULL DEFAULT 0,
  first_opened_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, step_id)
);

CREATE INDEX IF NOT EXISTS outreach_step_executions_due_idx
  ON outreach_step_executions (scheduled_for)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS outreach_step_executions_enrollment_idx
  ON outreach_step_executions (enrollment_id, step_index);

-- Channel-level suppression (product.md §19.6, ACR-016). Keyed by address
-- rather than by contact or profile because the person who clicks
-- "unsubscribe" is an external recipient with no account here, and the only
-- durable identifier we hold for them is the mailbox we wrote to. Checked
-- before every send AND at enrolment, so a suppressed address can neither be
-- enrolled nor mailed by an enrolment that predates the opt-out.
CREATE TABLE IF NOT EXISTS outreach_suppressions (
  email_normalized TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'unsubscribed',
  source TEXT NOT NULL DEFAULT 'recipient',
  enrollment_id UUID REFERENCES outreach_enrollments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The rep's own scheduling link, substituted into {{meeting_link}}. Lives on
-- the profile rather than in one shared setting because every rep books into
-- their own calendar.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS meeting_link TEXT;

-- --- Outreach permission defaults ------------------------------------------
--
-- Read-leaning for the internal roles that do the prospecting, and closed for
-- the partner roles: a sequence mails LIVEY's own customers from LIVEY's
-- domain, so authoring one is not a partner-side capability. Editable
-- afterward from /admin/roles like the rest of the matrix.
INSERT INTO role_permissions (role_key, feature_key, can_create, can_read, can_update, can_delete) VALUES
  ('super_admin', 'outreach', true, true, true, true),
  ('rm', 'outreach', true, true, true, false),
  ('pam', 'outreach', true, true, true, false),
  ('kam', 'outreach', true, true, true, false),
  ('isr', 'outreach', true, true, true, false),
  ('livey_support', 'outreach', false, false, false, false),
  ('restricted_distributor', 'outreach', false, false, false, false),
  ('partner_admin', 'outreach', false, false, false, false),
  ('partner_user', 'outreach', false, false, false, false)
ON CONFLICT (role_key, feature_key) DO NOTHING;

-- --- Outreach: keep delivery history when a sequence is re-cut -------------
--
-- outreach_step_executions.step_id started life as ON DELETE CASCADE, which
-- quietly made "edit the steps" mean "erase this sequence's whole track
-- record". saveSequenceSteps() DELETEs and re-inserts the step rows, and it
-- only guards against enrolments that are still ACTIVE — so every finished
-- and unenrolled contact's executions cascaded away with them, taking
-- emails-sent, opens, and the per-contact timeline with them. Analytics are
-- computed from these rows (outreach-queries.server.ts), so a single edit
-- reset a sequence's reported performance to zero.
--
-- The row already snapshots step_index and step_type precisely so it can
-- describe itself without the step. These two columns finish that job, and
-- the FK becomes SET NULL: history survives, and a live enrolment (which is
-- the only thing that still needs the step's body) is unaffected, because
-- editing is refused while any enrolment is active.
ALTER TABLE outreach_step_executions
  ADD COLUMN IF NOT EXISTS step_subject TEXT NOT NULL DEFAULT '';
ALTER TABLE outreach_step_executions
  ADD COLUMN IF NOT EXISTS step_task_title TEXT NOT NULL DEFAULT '';

ALTER TABLE outreach_step_executions ALTER COLUMN step_id DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE outreach_step_executions
    DROP CONSTRAINT IF EXISTS outreach_step_executions_step_id_fkey;
  ALTER TABLE outreach_step_executions
    ADD CONSTRAINT outreach_step_executions_step_id_fkey
    FOREIGN KEY (step_id) REFERENCES outreach_sequence_steps(id) ON DELETE SET NULL;
END
$$;

-- Backfill the snapshot for any execution written before those columns
-- existed, so old rows describe themselves too.
UPDATE outreach_step_executions x
   SET step_subject = COALESCE(st.subject, ''),
       step_task_title = COALESCE(st.task_title, '')
  FROM outreach_sequence_steps st
 WHERE st.id = x.step_id
   AND x.step_subject = ''
   AND x.step_task_title = '';

-- The unsubscribe handler looks an address up across every sequence
-- (WHERE contact_email_normalized = $1 AND status = 'active'). The unique
-- index above leads with sequence_id, so it cannot serve that lookup — this
-- one can.
CREATE INDEX IF NOT EXISTS outreach_enrollments_email_active_idx
  ON outreach_enrollments (contact_email_normalized)
  WHERE status = 'active';
