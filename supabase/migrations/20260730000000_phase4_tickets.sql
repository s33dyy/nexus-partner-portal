ALTER TABLE public.support_tickets ADD COLUMN product_sku TEXT;
ALTER TABLE public.support_tickets ADD COLUMN serial_number TEXT;
ALTER TABLE public.support_ticket_comments ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT FALSE;
