ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS product_sku TEXT;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS serial_number TEXT;

ALTER TABLE public.support_ticket_comments
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;
