CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE app_role AS ENUM ('super_admin', 'partner_admin', 'partner_user');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

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

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  product_family TEXT NOT NULL DEFAULT 'core',
  category TEXT NOT NULL DEFAULT 'General',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_code TEXT NOT NULL UNIQUE,
  variant_name TEXT NOT NULL,
  variant_family TEXT NOT NULL DEFAULT 'standard',
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_skus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL UNIQUE,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  msrp_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  partner_transfer_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  reward_eligible_dtp_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS combos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_code TEXT NOT NULL UNIQUE,
  combo_name TEXT NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS combo_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id UUID NOT NULL REFERENCES combos(id) ON DELETE RESTRICT,
  product_sku_id UUID NOT NULL REFERENCES product_skus(id) ON DELETE RESTRICT,
  component_quantity NUMERIC(18,6) NOT NULL DEFAULT 1,
  component_role TEXT NOT NULL DEFAULT 'included',
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_book_code TEXT NOT NULL UNIQUE,
  price_book_name TEXT NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'governed',
  description TEXT NOT NULL DEFAULT '',
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
  combo_component_id UUID REFERENCES combo_components(id) ON DELETE RESTRICT,
  row_kind TEXT NOT NULL DEFAULT 'sku',
  currency_code TEXT NOT NULL DEFAULT 'USD',
  msrp_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  partner_transfer_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  additional_discount_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  discounted_transfer_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  reward_eligible_dtp_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  pipeline_probability NUMERIC(8,6) NOT NULL DEFAULT 0,
  margin_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fx_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_currency_code TEXT NOT NULL,
  target_currency_code TEXT NOT NULL,
  rate NUMERIC(18,8) NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rate_source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  archived_at TIMESTAMPTZ,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_currency_code, target_currency_code, captured_at)
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

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  assignee_name TEXT,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
