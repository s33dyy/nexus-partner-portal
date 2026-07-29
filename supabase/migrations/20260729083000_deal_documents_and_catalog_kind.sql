ALTER TABLE public.portal_catalog_items
  ADD COLUMN IF NOT EXISTS catalog_kind TEXT NOT NULL DEFAULT 'product';

UPDATE public.portal_catalog_items
SET catalog_kind = COALESCE(NULLIF(catalog_kind, ''), 'product');

INSERT INTO storage.buckets (id, name, public)
VALUES ('deal-documents', 'deal-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.deal_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_id UUID NOT NULL REFERENCES public.portal_deals(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL REFERENCES public.document_blobs(file_path) ON DELETE CASCADE,
  mime_type TEXT,
  size_bytes BIGINT,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deal_documents TO authenticated;
GRANT ALL ON public.deal_documents TO service_role;

ALTER TABLE public.deal_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deal_docs_admin_all" ON public.deal_documents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "deal_docs_partner_select" ON public.deal_documents
  FOR SELECT TO authenticated
  USING (
    partner_id IN (
      SELECT id FROM public.partners WHERE owner_user_id = auth.uid()
      UNION
      SELECT partner_id FROM public.profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
    )
    AND (
      public.has_role(auth.uid(), 'partner_admin')
      OR uploaded_by = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.portal_deal_collaborators collaborator
        WHERE collaborator.deal_id = public.deal_documents.deal_id
          AND collaborator.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "deal_docs_partner_insert" ON public.deal_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND partner_id IN (
      SELECT id FROM public.partners WHERE owner_user_id = auth.uid()
      UNION
      SELECT partner_id FROM public.profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
    )
    AND EXISTS (
      SELECT 1
      FROM public.portal_deals deal
      WHERE deal.id = public.deal_documents.deal_id
        AND deal.partner_id = public.deal_documents.partner_id
    )
  );

CREATE POLICY "deal_docs_partner_update" ON public.deal_documents
  FOR UPDATE TO authenticated
  USING (
    partner_id IN (
      SELECT id FROM public.partners WHERE owner_user_id = auth.uid()
      UNION
      SELECT partner_id FROM public.profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
    )
    AND (
      public.has_role(auth.uid(), 'partner_admin')
      OR uploaded_by = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.portal_deal_collaborators collaborator
        WHERE collaborator.deal_id = public.deal_documents.deal_id
          AND collaborator.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    partner_id IN (
      SELECT id FROM public.partners WHERE owner_user_id = auth.uid()
      UNION
      SELECT partner_id FROM public.profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
    )
  );

CREATE POLICY "deal_docs_partner_delete" ON public.deal_documents
  FOR DELETE TO authenticated
  USING (
    partner_id IN (
      SELECT id FROM public.partners WHERE owner_user_id = auth.uid()
      UNION
      SELECT partner_id FROM public.profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
    )
    AND (
      public.has_role(auth.uid(), 'partner_admin')
      OR uploaded_by = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.portal_deal_collaborators collaborator
        WHERE collaborator.deal_id = public.deal_documents.deal_id
          AND collaborator.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "deal_docs_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'deal-documents'
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR (
        (storage.foldername(name))[1] IN (
          SELECT id::text FROM public.partners WHERE owner_user_id = auth.uid()
          UNION
          SELECT partner_id::text FROM public.profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
        )
        AND (
          public.has_role(auth.uid(), 'partner_admin')
          OR EXISTS (
            SELECT 1
            FROM public.deal_documents doc
            LEFT JOIN public.portal_deal_collaborators collaborator
              ON collaborator.deal_id = doc.deal_id
            WHERE doc.file_path = name
              AND (doc.uploaded_by = auth.uid() OR collaborator.user_id = auth.uid())
          )
        )
      )
    )
  );

CREATE POLICY "deal_docs_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'deal-documents'
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.partners WHERE owner_user_id = auth.uid()
        UNION
        SELECT partner_id::text FROM public.profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
      )
    )
  );

CREATE POLICY "deal_docs_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'deal-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.partners WHERE owner_user_id = auth.uid()
      UNION
      SELECT partner_id::text FROM public.profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
    )
  );

CREATE POLICY "deal_docs_storage_admin_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'deal-documents' AND public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (bucket_id = 'deal-documents' AND public.has_role(auth.uid(), 'super_admin'));

DROP TRIGGER IF EXISTS deal_documents_updated_at ON public.deal_documents;
CREATE TRIGGER deal_documents_updated_at
  BEFORE UPDATE ON public.deal_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
