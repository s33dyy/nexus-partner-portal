ALTER TABLE public.portal_deals
  ADD COLUMN IF NOT EXISTS is_hidden_to_team boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reward_rate_percent numeric(6,2) NOT NULL DEFAULT 5;

CREATE TABLE IF NOT EXISTS public.portal_deal_collaborators (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES public.portal_deals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  split_percent numeric(6,2) NOT NULL DEFAULT 100,
  sort_order integer NOT NULL DEFAULT 0,
  is_seed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_deal_collaborators_deal_user_key UNIQUE (deal_id, user_id)
);

CREATE INDEX IF NOT EXISTS portal_deal_collaborators_deal_id_idx
  ON public.portal_deal_collaborators (deal_id);

CREATE TRIGGER portal_deal_collaborators_set_updated_at
  BEFORE UPDATE ON public.portal_deal_collaborators
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.portal_deal_collaborators (
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
  COALESCE(d.is_seed, false),
  now(),
  now()
FROM public.portal_deals d
WHERE d.user_id IS NOT NULL
ON CONFLICT (deal_id, user_id) DO NOTHING;
