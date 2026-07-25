-- Add pending_agreement status to the enum
ALTER TYPE public.partner_status ADD VALUE IF NOT EXISTS 'pending_agreement' AFTER 'under_review';

-- Add agreement-related columns to partners table
ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS agreement_envelope_id TEXT,
  ADD COLUMN IF NOT EXISTS agreement_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agreement_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agreement_signed_doc_path TEXT,
  ADD COLUMN IF NOT EXISTS agreement_provider TEXT DEFAULT 'zohosign';

-- Table to store Zoho Sign OAuth tokens (single org row)
CREATE TABLE IF NOT EXISTS public.zoho_sign_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  api_domain TEXT NOT NULL DEFAULT 'https://sign.zoho.in',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.zoho_sign_tokens TO service_role;
ALTER TABLE public.zoho_sign_tokens ENABLE ROW LEVEL SECURITY;

-- Only service_role can touch the tokens table (never exposed to browser client)
CREATE POLICY "service_role_only_zoho_tokens" ON public.zoho_sign_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER zoho_sign_tokens_set_updated_at
  BEFORE UPDATE ON public.zoho_sign_tokens
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
