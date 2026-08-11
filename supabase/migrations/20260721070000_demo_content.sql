CREATE TABLE public.portal_demo_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  hint TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'default',
  sort_order INT NOT NULL DEFAULT 0,
  is_seed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.portal_demo_feed_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  time_label TEXT NOT NULL,
  tone TEXT NOT NULL DEFAULT 'primary',
  sort_order INT NOT NULL DEFAULT 0,
  is_seed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.portal_demo_partner_spotlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  region TEXT NOT NULL,
  tier TEXT NOT NULL,
  pipeline_value TEXT NOT NULL,
  last_activity TEXT NOT NULL,
  status TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_seed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, DELETE ON public.portal_demo_metrics TO authenticated;
GRANT SELECT, DELETE ON public.portal_demo_feed_items TO authenticated;
GRANT SELECT, DELETE ON public.portal_demo_partner_spotlights TO authenticated;
GRANT ALL ON public.portal_demo_metrics TO service_role;
GRANT ALL ON public.portal_demo_feed_items TO service_role;
GRANT ALL ON public.portal_demo_partner_spotlights TO service_role;

ALTER TABLE public.portal_demo_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_demo_feed_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_demo_partner_spotlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "demo_metrics_select" ON public.portal_demo_metrics
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "demo_metrics_delete_admin" ON public.portal_demo_metrics
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') AND is_seed);

CREATE POLICY "demo_feed_select" ON public.portal_demo_feed_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "demo_feed_delete_admin" ON public.portal_demo_feed_items
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') AND is_seed);

CREATE POLICY "demo_partner_spotlights_select" ON public.portal_demo_partner_spotlights
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "demo_partner_spotlights_delete_admin" ON public.portal_demo_partner_spotlights
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') AND is_seed);
