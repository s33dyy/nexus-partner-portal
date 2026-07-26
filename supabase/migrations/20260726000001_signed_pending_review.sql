-- Add signed_pending_review status to the enum after pending_agreement
ALTER TYPE public.partner_status ADD VALUE IF NOT EXISTS 'signed_pending_review' AFTER 'pending_agreement';

COMMENT ON TYPE public.partner_status IS 'Partner registration statuses: pending_partner_registration -> submitted -> under_review -> need_more_info -> partial_approval -> pending_agreement -> signed_pending_review -> approved/rejected';
