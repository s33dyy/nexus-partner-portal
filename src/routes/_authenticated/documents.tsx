import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, Loader2, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/local/client";

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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [docsRes, partnersRes] = await Promise.all([
        supabase
          .from("partner_documents")
          .select(
            "id, partner_id, uploaded_by, doc_type, file_name, file_path, mime_type, size_bytes, created_at",
          )
          .order("created_at", { ascending: false }),
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
  };

  useEffect(() => {
    void load();
  }, []);

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
      return;
    }
    setSelectedId(selectedDoc.id);
  }, [selectedDoc]);

  const openPreview = async (doc: DocRow) => {
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
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete document");
    } finally {
      setDeletingId(null);
    }
  };

  const docTypes = useMemo(() => ["all", ...new Set(docs.map((doc) => doc.doc_type))], [docs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Workspace
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Manage compliance files, preview seeded uploads, and remove test records when you need
            to reset the workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {source === "empty" ? "No documents found" : "Seeded documents"}
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
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Document library</CardTitle>
                <CardDescription>Search and inspect uploaded partner files.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search files"
                    className="pl-8"
                  />
                </div>
                <Select value={docTypeFilter} onValueChange={setDocTypeFilter}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="All document types" />
                  </SelectTrigger>
                  <SelectContent>
                    {docTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type === "all" ? "All document types" : type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                    onClick={() => void openPreview(doc)}
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

        <div className="space-y-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Preview</CardTitle>
              <CardDescription>
                {previewName || "Pick a document to preview it in-browser."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {previewUrl ? (
                <div className="space-y-3">
                  <iframe
                    title={previewName}
                    src={previewUrl}
                    className="h-80 w-full rounded-lg border bg-background"
                  />
                  <Button asChild variant="outline">
                    <a href={previewUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open in new tab
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Select a document to see the preview here.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Selected file</CardTitle>
              <CardDescription>Actions for the current document.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedDoc ? (
                <>
                  <div className="grid gap-3 text-sm md:grid-cols-2">
                    <Meta label="File" value={selectedDoc.file_name} />
                    <Meta label="Type" value={selectedDoc.doc_type} />
                    <Meta
                      label="Partner"
                      value={partnerById.get(selectedDoc.partner_id) ?? "Unknown"}
                    />
                    <Meta
                      label="Size"
                      value={
                        selectedDoc.size_bytes
                          ? `${Math.round(selectedDoc.size_bytes / 1024)} KB`
                          : "Unknown"
                      }
                    />
                  </div>
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    <Button
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
                    <Button variant="outline" onClick={() => void openPreview(selectedDoc)}>
                      <Upload className="mr-2 h-4 w-4" />
                      Refresh preview
                    </Button>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No document selected.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
