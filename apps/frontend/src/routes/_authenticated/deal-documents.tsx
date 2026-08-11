import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { ExternalLink, FileText, Loader2, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedPage } from "@/components/route-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";
import { useRequireAccess } from "@/hooks/use-partner-access";
import { applyPartnerScope } from "@/lib/partner-scope";
import {
  filterVisibleDealDocuments,
  groupDealDocumentCollaborators,
  type DealDocumentRecord,
} from "@/lib/document-access";
import { filterVisibleDeals, groupCollaboratorIdsByDeal } from "@/lib/deal-visibility";
import { type DealRecord } from "@/lib/portal-records";

type Partner = {
  id: string;
  company_name: string;
};

type DealDocumentRow = DealDocumentRecord;

export const Route = createFileRoute("/_authenticated/deal-documents")({
  component: DealDocumentsPage,
});

function DealDocumentsPage() {
  const { profile, hasRole } = useAuth();
  const access = useRequireAccess("full");
  const [documents, setDocuments] = useState<DealDocumentRow[]>([]);
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [dealFilter, setDealFilter] = useState("all");
  const [docTypeFilter, setDocTypeFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [docType, setDocType] = useState("Purchase Order");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canSeeAll = hasRole("super_admin");
  const partnerId = profile?.partner_id ?? null;
  const viewerRole = hasRole("super_admin")
    ? "super_admin"
    : hasRole("partner_admin")
      ? "partner_admin"
      : "partner_user";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dealQuery = supabase.from("portal_deals").select("*").order("updated_at", {
        ascending: false,
      });
      const collaboratorQuery = supabase
        .from("portal_deal_collaborators")
        .select("deal_id, user_id");

      const scopedDealQuery = applyPartnerScope(dealQuery, {
        isSuperAdmin: canSeeAll,
        partnerId,
        userId: profile?.id ?? null,
      });

      const scopedDocumentQuery = applyPartnerScope(
        supabase
          .from("deal_documents")
          .select(
            "id, deal_id, partner_id, uploaded_by, doc_type, file_name, file_path, mime_type, size_bytes, created_at",
          )
          .order("created_at", { ascending: false }),
        {
          isSuperAdmin: canSeeAll,
          partnerId,
          userId: profile?.id ?? null,
          fallbackColumn: "uploaded_by",
        },
      );

      const [dealRes, collaboratorRes, documentRes, partnerRes] = await Promise.all([
        scopedDealQuery,
        collaboratorQuery,
        scopedDocumentQuery,
        canSeeAll
          ? supabase
              .from("partners")
              .select("id, company_name")
              .order("company_name", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (dealRes.error || collaboratorRes.error || documentRes.error || partnerRes.error) {
        throw dealRes.error ?? collaboratorRes.error ?? documentRes.error ?? partnerRes.error;
      }

      const collaboratorRows =
        (collaboratorRes.data as Array<{ deal_id: string; user_id: string }> | null) ?? [];
      const visibleDeals = filterVisibleDeals(
        ((dealRes.data as DealRecord[] | null) ?? []).map((deal) => ({
          ...deal,
          is_hidden_to_team: Boolean(deal.is_hidden_to_team),
        })),
        groupCollaboratorIdsByDeal(collaboratorRows),
        {
          viewerUserId: profile?.id ?? null,
          viewerRole,
          isSuperAdmin: canSeeAll,
          isPartnerAdmin: hasRole("partner_admin"),
        },
      );

      const documentsRows = (documentRes.data as DealDocumentRow[] | null) ?? [];
      const visibleDocuments = filterVisibleDealDocuments(documentsRows, {
        viewerUserId: profile?.id ?? null,
        viewerRole,
        isSuperAdmin: canSeeAll,
        isPartnerAdmin: hasRole("partner_admin"),
        partnerId,
        collaboratorUserIdsByDeal: groupDealDocumentCollaborators(collaboratorRows),
      });

      setDeals(visibleDeals);
      setDocuments(visibleDocuments);
      setPartners((partnerRes.data as Partner[] | null) ?? []);
      // Deliberately does not default selectedId to the first document —
      // selectedId drives the review Dialog's `open` prop below, so
      // auto-selecting a document here made the modal auto-open on every
      // page load/refresh whenever any document existed.
      setSelectedDealId((current) => current ?? visibleDeals[0]?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load deal documents");
      setDeals([]);
      setDocuments([]);
      setPartners([]);
      setSelectedId(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canSeeAll, hasRole, partnerId, profile?.id, viewerRole]);

  useEffect(() => {
    if (access.loading) return;
    if (!access.canAccessDealDocuments) return;
    void load();
  }, [access.canAccessDealDocuments, access.loading, load]);

  const partnerById = useMemo(
    () => new Map(partners.map((partner) => [partner.id, partner.company_name])),
    [partners],
  );

  const dealById = useMemo(() => new Map(deals.map((deal) => [deal.id, deal])), [deals]);

  const filteredDocuments = useMemo(() => {
    const term = query.trim().toLowerCase();
    return documents.filter((doc) => {
      const matchesDeal = dealFilter === "all" || doc.deal_id === dealFilter;
      const matchesType = docTypeFilter === "all" || doc.doc_type === docTypeFilter;
      const matchesQuery =
        !term ||
        [
          doc.file_name,
          doc.doc_type,
          dealById.get(doc.deal_id)?.account_name ?? "",
          partnerById.get(doc.partner_id) ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesDeal && matchesType && matchesQuery;
    });
  }, [dealById, dealFilter, docTypeFilter, documents, partnerById, query]);

  const selectedDocument = useMemo(
    // No fallback to filteredDocuments[0]: this drives the review Dialog's
    // `open` prop below, so falling back to "the first document" here is
    // what made the modal impossible to close — closing sets selectedId to
    // null, which this fallback immediately turned back into the first
    // document, reopening it on the very next render.
    () => filteredDocuments.find((doc) => doc.id === selectedId) ?? null,
    [filteredDocuments, selectedId],
  );

  useEffect(() => {
    if (!selectedDocument) {
      setPreviewUrl(null);
      setPreviewName("");
      setPreviewLoading(false);
      return;
    }
    setSelectedId(selectedDocument.id);
  }, [selectedDocument]);

  const openPreview = async (doc: DealDocumentRow) => {
    setPreviewUrl(null);
    setPreviewName(doc.file_name);
    setPreviewLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from("deal-documents")
        .createSignedUrl(doc.file_path, 300);
      if (error || !data) throw error ?? new Error("Preview unavailable");
      setPreviewUrl(data.signedUrl);
      setPreviewName(doc.file_name);
      setSelectedId(doc.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open preview");
    } finally {
      setPreviewLoading(false);
    }
  };

  const refresh = () => {
    setRefreshing(true);
    void load();
  };

  const uploadDocument = async () => {
    if (!selectedDealId) {
      toast.error("Select a deal before uploading");
      return;
    }
    if (!uploadFile) {
      toast.error("Select a file to upload");
      return;
    }

    const targetDeal = dealById.get(selectedDealId);
    if (!targetDeal) {
      toast.error("Select a valid deal before uploading");
      return;
    }

    setUploading(true);
    try {
      const safeName = uploadFile.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const filePath = `${targetDeal.partner_id ?? "partner"}/${targetDeal.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("deal-documents")
        .upload(filePath, uploadFile, {
          contentType: uploadFile.type || "application/octet-stream",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const now = new Date().toISOString();
      const { error: insertError } = await supabase.from("deal_documents").insert({
        id: globalThis.crypto.randomUUID(),
        deal_id: targetDeal.id,
        partner_id: targetDeal.partner_id,
        uploaded_by: profile?.id ?? null,
        doc_type: docType.trim() || "Purchase Order",
        file_name: uploadFile.name,
        file_path: filePath,
        mime_type: uploadFile.type || null,
        size_bytes: uploadFile.size,
        created_at: now,
        updated_at: now,
      });
      if (insertError) throw insertError;

      toast.success("Deal document uploaded");
      setUploadFile(null);
      setDocType("Purchase Order");
      setSelectedDealId(targetDeal.id);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to upload deal document");
    } finally {
      setUploading(false);
    }
  };

  const deleteDocument = async (doc: DealDocumentRow) => {
    setDeletingId(doc.id);
    try {
      const [blobRes, docRes] = await Promise.all([
        supabase.storage.from("deal-documents").remove([doc.file_path]),
        supabase.from("deal_documents").delete().eq("id", doc.id),
      ]);
      if (blobRes.error || docRes.error) {
        throw blobRes.error ?? docRes.error;
      }
      toast.success("Deal document removed");
      if (selectedId === doc.id) {
        setSelectedId(null);
        setPreviewUrl(null);
        setPreviewLoading(false);
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete deal document");
    } finally {
      setDeletingId(null);
    }
  };

  const docTypes = useMemo(
    () => ["all", ...new Set(documents.map((doc) => doc.doc_type))],
    [documents],
  );

  if (!access.canAccessDealDocuments) {
    return <AccessDeniedPage title="Deal documents" roleLabel="Approved partner" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Workspace
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Deal Documents</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Upload won-deal purchase orders and keep each partner's commercial records isolated.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
          <Badge variant="secondary">
            {documents.length === 0 ? "No deal documents" : "Live docs"}
          </Badge>
          <Button variant="outline" onClick={refresh} disabled={loading || refreshing}>
            {loading || refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-4 border-b">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base">Upload PO</CardTitle>
              <CardDescription>
                Attach a purchase order to a won deal. Partner admins see all partner docs, while
                partner users only see their own or collaborated records.
              </CardDescription>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
              <select
                value={dealFilter}
                onChange={(e) => setDealFilter(e.target.value)}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="all">All deals</option>
                {deals.map((deal) => (
                  <option key={deal.id} value={deal.id}>
                    {deal.account_name}
                  </option>
                ))}
              </select>
              <select
                value={docTypeFilter}
                onChange={(e) => setDocTypeFilter(e.target.value)}
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                {docTypes.map((type) => (
                  <option key={type} value={type}>
                    {type === "all" ? "All document types" : type}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_auto]">
            <div className="space-y-2">
              <Label>Deal</Label>
              <select
                value={selectedDealId ?? ""}
                onChange={(e) => setSelectedDealId(e.target.value || null)}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="" disabled>
                  Select a deal
                </option>
                {deals.map((deal) => (
                  <option key={deal.id} value={deal.id}>
                    {deal.account_name} · {deal.stage}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Document type</Label>
              <Input
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                placeholder="Purchase Order"
              />
            </div>
            <div className="space-y-2">
              <Label>File</Label>
              <Input
                type="file"
                accept=".pdf,image/png,image/jpeg"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setUploadFile(e.target.files?.[0] ?? null);
                }}
              />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full lg:w-auto"
                onClick={() => void uploadDocument()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Upload PO
              </Button>
            </div>
          </div>

          <Separator />

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading deal documents...
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
              No matching deal documents are available.
            </div>
          ) : (
            <div className="divide-y">
              {filteredDocuments.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => {
                    setSelectedId(doc.id);
                    void openPreview(doc);
                  }}
                  className={`flex w-full flex-col gap-3 px-4 py-4 text-left transition hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between ${
                    selectedDocument?.id === doc.id ? "bg-muted/40" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate font-medium">{doc.file_name}</div>
                      <Badge variant="outline">{doc.doc_type}</Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {dealById.get(doc.deal_id)?.account_name ?? doc.deal_id}
                      {canSeeAll ? ` · ${partnerById.get(doc.partner_id) ?? doc.partner_id}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <div>
                      {doc.size_bytes ? `${Math.round(doc.size_bytes / 1024)} KB` : "Preview"}
                    </div>
                    <div>{new Date(doc.created_at).toLocaleDateString()}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(selectedDocument)}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedDocument ? `Review ${selectedDocument.file_name}` : "Review document"}
            </DialogTitle>
            <DialogDescription>
              Preview the uploaded purchase order, confirm the deal, and remove the file if it needs
              to be replaced.
            </DialogDescription>
          </DialogHeader>

          {selectedDocument ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Deal
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {dealById.get(selectedDocument.deal_id)?.account_name ??
                      selectedDocument.deal_id}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Partner
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {partnerById.get(selectedDocument.partner_id) ?? selectedDocument.partner_id}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium">Preview</div>
                {previewLoading ? (
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading preview...
                  </div>
                ) : previewUrl ? (
                  <>
                    <iframe
                      title={previewName || selectedDocument.file_name}
                      src={previewUrl}
                      className="h-80 w-full rounded-lg border bg-background"
                    />
                    <Button asChild variant="outline">
                      <a href={previewUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Open in new tab
                      </a>
                    </Button>
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    Preview unavailable for this document.
                  </div>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void openPreview(selectedDocument)}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Refresh preview
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void deleteDocument(selectedDocument)}
                  disabled={deletingId === selectedDocument.id}
                >
                  {deletingId === selectedDocument.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete file
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
