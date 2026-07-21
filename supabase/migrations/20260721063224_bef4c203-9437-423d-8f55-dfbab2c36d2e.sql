
CREATE TABLE public.partner_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL,
  doc_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_documents TO authenticated;
GRANT ALL ON public.partner_documents TO service_role;

ALTER TABLE public.partner_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_docs_all" ON public.partner_documents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "own_docs_select" ON public.partner_documents
  FOR SELECT TO authenticated
  USING (partner_id IN (
    SELECT id FROM public.partners WHERE owner_user_id = auth.uid()
    UNION
    SELECT partner_id FROM public.profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
  ));

CREATE POLICY "own_docs_insert" ON public.partner_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND partner_id IN (SELECT id FROM public.partners WHERE owner_user_id = auth.uid())
  );

CREATE POLICY "own_docs_delete" ON public.partner_documents
  FOR DELETE TO authenticated
  USING (partner_id IN (SELECT id FROM public.partners WHERE owner_user_id = auth.uid()));

CREATE TABLE public.partner_review_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  author_id UUID NOT NULL,
  note TEXT NOT NULL,
  status_change TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.partner_review_notes TO authenticated;
GRANT ALL ON public.partner_review_notes TO service_role;

ALTER TABLE public.partner_review_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_notes_all" ON public.partner_review_notes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "own_notes_select" ON public.partner_review_notes
  FOR SELECT TO authenticated
  USING (partner_id IN (
    SELECT id FROM public.partners WHERE owner_user_id = auth.uid()
    UNION
    SELECT partner_id FROM public.profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
  ));

-- Storage policies for partner-documents bucket
CREATE POLICY "partner_docs_owner_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'partner-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.partners WHERE owner_user_id = auth.uid()
      UNION
      SELECT partner_id::text FROM public.profiles WHERE id = auth.uid() AND partner_id IS NOT NULL
    )
  );

CREATE POLICY "partner_docs_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'partner-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.partners WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "partner_docs_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'partner-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.partners WHERE owner_user_id = auth.uid()
    )
  );

CREATE POLICY "partner_docs_admin_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'partner-documents' AND public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (bucket_id = 'partner-documents' AND public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_partner_docs_updated
  BEFORE UPDATE ON public.partner_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
