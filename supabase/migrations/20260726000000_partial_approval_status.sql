-- supabase/migrations/20260726000000_partial_approval_status.sql

-- Add partial_approval status to the enum (after under_review, before pending_agreement)
ALTER TYPE public.partner_status ADD VALUE IF NOT EXISTS 'partial_approval' BEFORE 'pending_agreement';

-- Add comment for documentation
COMMENT ON TYPE public.partner_status IS 'Partner registration statuses: pending_partner_registration -> submitted -> under_review -> partial_approval -> pending_agreement -> approved/rejected/need_more_info';