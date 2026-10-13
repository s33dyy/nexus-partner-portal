ALTER TABLE public.portal_customers
  ALTER COLUMN renewal_date TYPE TEXT USING renewal_date::text;

UPDATE public.portal_customers
SET renewal_date = 'LIVEYfy'
WHERE renewal_date IS NULL OR renewal_date NOT IN ('LIVEYfy', 'RC');

ALTER TABLE public.portal_customers
  ALTER COLUMN renewal_date SET NOT NULL;

ALTER TABLE public.portal_customers
  DROP CONSTRAINT IF EXISTS portal_customers_renewal_type_check,
  ADD CONSTRAINT portal_customers_renewal_type_check
    CHECK (renewal_date IN ('LIVEYfy', 'RC'));
