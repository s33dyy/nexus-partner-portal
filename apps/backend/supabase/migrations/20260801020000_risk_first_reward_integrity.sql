ALTER TABLE public.reward_redemptions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.reward_redemptions
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.reward_point_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.reward_point_events
  ADD COLUMN IF NOT EXISTS reversal_of UUID;

ALTER TABLE public.reward_catalog_items
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
ALTER TABLE public.reward_catalog_items
  ADD COLUMN IF NOT EXISTS retired_by UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reward_point_events_reversal_of_fkey'
      AND conrelid = 'public.reward_point_events'::regclass
  ) THEN
    ALTER TABLE public.reward_point_events
      ADD CONSTRAINT reward_point_events_reversal_of_fkey
      FOREIGN KEY (reversal_of)
      REFERENCES public.reward_point_events(id)
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reward_catalog_items_retired_by_fkey'
      AND conrelid = 'public.reward_catalog_items'::regclass
  ) THEN
    ALTER TABLE public.reward_catalog_items
      ADD CONSTRAINT reward_catalog_items_retired_by_fkey
      FOREIGN KEY (retired_by)
      REFERENCES public.profiles(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS reward_redemptions_idempotency_key_uidx
  ON public.reward_redemptions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS reward_point_events_idempotency_key_uidx
  ON public.reward_point_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

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
