import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, Loader2, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { CsvExportButton } from "@/components/csv-export-button";
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
import { LookupCombobox } from "@/components/lookup-combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/local/client";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { useAuth } from "@/hooks/use-auth";
import { usePartnerAccess } from "@/hooks/use-partner-access";
import { applyPartnerScope } from "@/lib/partner-scope";
import { type CsvColumn } from "@/lib/csv-export";

type Partner = {
  id: string;
  company_name: string;
};

type DocRow = {
  id: string;
  partner_id: string;
  uploaded_by: string;
  doc_type: string;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

const DOC_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "partner_name", header: "Partner" },
  { key: "doc_type", header: "Document Type" },
  { key: "file_name", header: "File Name" },
  { key: "file_path", header: "File Path" },
  { key: "mime_type", header: "MIME Type" },
  { key: "size_bytes", header: "Size (bytes)" },
  { key: "created_at", header: "Created At" },
];

export const Route = createFileRoute("/_authenticated/documents")({
  component: DocumentsPage,
});

function DocumentsPage() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [query, setQuery] = useState("");
  const [docTypeFilter, setDocTypeFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState({ file_name: "", doc_type: "" });
  const [saving, setSaving] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { profile, hasRole } = useAuth();
  const access = usePartnerAccess();
  const navigate = useNavigate();

  function uniqueStrings(values: Array<string | null | undefined>) {
    return [
      ...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)),
    ];
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let docQuery = supabase
        .from("partner_documents")
        .select(
          "id, partner_id, uploaded_by, doc_type, file_name, file_path, mime_type, size_bytes, created_at",
        )
        .order("created_at", { ascending: false });

      docQuery = applyPartnerScope(docQuery, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
        fallbackColumn: "uploaded_by",
      });

      const [docsRes, partnersRes] = await Promise.all([
        docQuery,
        supabase
          .from("partners")
          .select("id, company_name")
          .order("created_at", { ascending: false }),
      ]);
      if (docsRes.error || partnersRes.error) {
        throw docsRes.error ?? partnersRes.error;
      }
      const docRows = (docsRes.data as DocRow[] | null) ?? [];
      const partnerRows = (partnersRes.data as Partner[] | null) ?? [];
      setDocs(docRows);
      setPartners(partnerRows);
      setSource(docRows.length > 0 ? "database" : "empty");
      setSelectedId((current) => current ?? docRows[0]?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load documents");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hasRole, profile?.id, profile?.partner_id]);

  useEffect(() => {
    if (access.loading) return;
    if (!access.canAccessPartnerDocuments) {
      navigate({ to: "/dashboard", replace: true });
      return;
    }
    void load();
  }, [access.canAccessPartnerDocuments, access.loading, load, navigate]);

  const partnerById = useMemo(
    () => new Map(partners.map((partner) => [partner.id, partner.company_name])),
    [partners],
  );

  const filteredDocs = useMemo(() => {
    const term = query.trim().toLowerCase();
    return docs.filter((doc) => {
      const matchesType = docTypeFilter === "all" || doc.doc_type === docTypeFilter;
      const matchesQuery =
        !term ||
        [doc.file_name, doc.doc_type, partnerById.get(doc.partner_id) ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesType && matchesQuery;
    });
  }, [docs, docTypeFilter, partnerById, query]);

  const selectedDoc = useMemo(
    () => filteredDocs.find((doc) => doc.id === selectedId) ?? filteredDocs[0] ?? null,
    [filteredDocs, selectedId],
  );

  useEffect(() => {
    if (!selectedDoc) {
      setPreviewUrl(null);
      setPreviewName("");
      setPreviewLoading(false);
      setDraft({ file_name: "", doc_type: "" });
      return;
    }
    setSelectedId(selectedDoc.id);
    setDraft({
      file_name: selectedDoc.file_name,
      doc_type: selectedDoc.doc_type,
    });
  }, [selectedDoc]);

  const openPreview = async (doc: DocRow) => {
    setPreviewUrl(null);
    setPreviewName(doc.file_name);
    setPreviewLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from("partner-documents")
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

  const deleteDoc = async (doc: DocRow) => {
    setDeletingId(doc.id);
    try {
      const [blobRes, docRes] = await Promise.all([
        supabase.storage.from("partner-documents").remove([doc.file_path]),
        supabase.from("partner_documents").delete().eq("id", doc.id),
      ]);
      if (blobRes.error || docRes.error) {
        throw blobRes.error ?? docRes.error;
      }
      toast.success("Document removed");
      if (selectedId === doc.id) {
        setSelectedId(null);
        setPreviewUrl(null);
        setPreviewLoading(false);
        setEditOpen(false);
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete document");
    } finally {
      setDeletingId(null);
    }
  };

  const docTypes = useMemo(() => ["all", ...new Set(docs.map((doc) => doc.doc_type))], [docs]);
  const docTypeOptions = useMemo(() => uniqueStrings(docs.map((doc) => doc.doc_type)), [docs]);

  const saveMetadata = async () => {
    if (!selectedDoc) return;
    const fileName = draft.file_name.trim();
    const docType = draft.doc_type.trim();
    if (!fileName || !docType) {
      toast.error("File name and document type are required");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("partner_documents")
        .update({
          file_name: fileName,
          doc_type: docType,
        })
        .eq("id", selectedDoc.id);
      if (error) throw error;
      toast.success("Document metadata updated");
      setEditOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update document metadata");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Workspace
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Onboarding documents</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Manage onboarding compliance files, preview uploads, and remove old records when you
            need to reset the workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {source === "empty" ? "No documents found" : "Live docs"}
          </Badge>
          <Button
            variant="outline"
            onClick={() => {
              setRefreshing(true);
              void load();
            }}
            disabled={loading || refreshing}
          >
            {loading || refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
          <CsvExportButton
            label="Export CSV"
            filenameStem="livey-documents"
            columns={DOC_EXPORT_COLUMNS}
            loadRows={async () =>
              filteredDocs.map((doc) => ({
                partner_name: partnerById.get(doc.partner_id) ?? doc.partner_id,
                doc_type: doc.doc_type,
                file_name: doc.file_name,
                file_path: doc.file_path,
                mime_type: doc.mime_type,
                size_bytes: doc.size_bytes,
                created_at: doc.created_at,
              }))
            }
            variant="outline"
          />
        </div>
      </div>

      <div>
        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Onboarding document library</CardTitle>
                <CardDescription>Search and inspect uploaded onboarding files.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <LookupCombobox
                  fieldName={LOOKUP_FIELDS.documentType}
                  label="Document type"
                  value={docTypeFilter === "all" ? "" : docTypeFilter}
                  onValueChange={(value) => setDocTypeFilter(value || "all")}
                  placeholder="All document types"
                  clearLabel="All document types"
                  allowClear
                  options={docTypeOptions}
                  triggerClassName="w-44"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading documents...
              </div>
            ) : filteredDocs.length === 0 ? (
              <div className="p-8 text-sm text-muted-foreground">
                No matching documents are available.
              </div>
            ) : (
              <div className="divide-y">
                {filteredDocs.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => {
                      setSelectedId(doc.id);
                      void openPreview(doc);
                      setEditOpen(true);
                    }}
                    className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-muted/40 ${
                      selectedDoc?.id === doc.id ? "bg-muted/40" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium">{doc.file_name}</div>
                        <Badge variant="outline">{doc.doc_type}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {partnerById.get(doc.partner_id) ?? doc.partner_id}
                      </div>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
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
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedDoc ? `Edit ${selectedDoc.file_name}` : "Edit document"}
            </DialogTitle>
            <DialogDescription>
              Update document metadata without keeping the details panel inline on the page.
            </DialogDescription>
          </DialogHeader>

          {selectedDoc ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Partner
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {partnerById.get(selectedDoc.partner_id) ?? "Unknown"}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground">
                    Size
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {selectedDoc.size_bytes
                      ? `${Math.round(selectedDoc.size_bytes / 1024)} KB`
                      : "Unknown"}
                  </div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="doc_file_name">File name</Label>
                  <Input
                    id="doc_file_name"
                    value={draft.file_name}
                    onChange={(e) =>
                      setDraft((current) => ({ ...current, file_name: e.target.value }))
                    }
                    placeholder="Partner agreement.pdf"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="doc_type">Document type</Label>
                  <LookupCombobox
                    fieldName={LOOKUP_FIELDS.documentType}
                    label="Document type"
                    value={draft.doc_type}
                    onValueChange={(value) =>
                      setDraft((current) => ({ ...current, doc_type: value }))
                    }
                    placeholder="Select or create document type"
                    options={docTypeOptions}
                  />
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
                      title={previewName || selectedDoc.file_name}
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
                  onClick={() => void openPreview(selectedDoc)}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Refresh preview
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void deleteDoc(selectedDoc)}
                  disabled={deletingId === selectedDoc.id}
                >
                  {deletingId === selectedDoc.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete file
                </Button>
                <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void saveMetadata()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save metadata
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
