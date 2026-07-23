import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, RefreshCw, Search, ShieldCheck, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { CsvExportButton } from "@/components/csv-export-button";
import { AccessDeniedPage } from "@/components/route-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase, uploadRewardImage } from "@/integrations/local/client";
import { formatDateLabel } from "@/lib/date-utils";
import { formatCsvDate, type CsvColumn } from "@/lib/csv-export";
import { hasNewsImage, type NewsPostRecord } from "@/lib/portal-news-data";
import { useAuth } from "@/hooks/use-auth";

type NewsForm = {
  title: string;
  caption: string;
  image_path: string;
  image_alt: string;
  posted_by_name: string;
  posted_by_role: string;
};

const EMPTY_FORM: NewsForm = {
  title: "",
  caption: "",
  image_path: "",
  image_alt: "",
  posted_by_name: "LIVEY Admin",
  posted_by_role: "super_admin",
};

const NEWS_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "title", header: "Title" },
  { key: "caption", header: "Caption" },
  { key: "image_path", header: "Image Path" },
  { key: "image_alt", header: "Image Alt" },
  { key: "posted_by_name", header: "Posted By" },
  { key: "posted_by_role", header: "Posted By Role" },
  { key: "created_at", header: "Created At" },
  { key: "updated_at", header: "Updated At" },
];

export const Route = createFileRoute("/_authenticated/admin/news")({
  component: AdminNewsPage,
});

function AdminNewsPage() {
  const { hasRole, profile } = useAuth();
  const [posts, setPosts] = useState<NewsPostRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [draft, setDraft] = useState<NewsForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const createFileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("portal_news_posts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data as NewsPostRecord[] | null) ?? [];
      setPosts(rows);
      setSource(rows.length > 0 ? "database" : "empty");
      setSelectedId((current) => current ?? rows[0]?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load posts");
      setPosts([]);
      setSource("empty");
      setSelectedId(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredPosts = useMemo(() => {
    const term = query.trim().toLowerCase();
    return posts.filter((post) =>
      !term
        ? true
        : [post.title, post.caption, post.posted_by_name, post.posted_by_role]
            .join(" ")
            .toLowerCase()
            .includes(term),
    );
  }, [posts, query]);

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedId) ?? null,
    [posts, selectedId],
  );

  useEffect(() => {
    if (!selectedPost) return;
    setDraft({
      title: selectedPost.title,
      caption: selectedPost.caption,
      image_path: selectedPost.image_path ?? "",
      image_alt: selectedPost.image_alt ?? "",
      posted_by_name: selectedPost.posted_by_name,
      posted_by_role: selectedPost.posted_by_role,
    });
  }, [selectedPost]);

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      posted_by_name: profile?.full_name ? profile.full_name : current.posted_by_name,
      posted_by_role: hasRole("super_admin") ? "super_admin" : current.posted_by_role,
    }));
  }, [hasRole, profile?.full_name]);

  if (!hasRole("super_admin")) {
    return <AccessDeniedPage title="News feed" roleLabel="Super Admin" />;
  }

  const createPost = async () => {
    if (!draft.title.trim() || !draft.caption.trim()) {
      toast.error("Title and caption are required");
      return;
    }
    setCreating(true);
    try {
      const payload = {
        id: crypto.randomUUID(),
        title: draft.title.trim(),
        caption: draft.caption.trim(),
        image_path: draft.image_path.trim(),
        image_alt: draft.image_alt.trim(),
        posted_by_name: draft.posted_by_name.trim() || "LIVEY Admin",
        posted_by_role: draft.posted_by_role.trim() || "super_admin",
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        is_seed: false,
      };
      const { error } = await supabase.from("portal_news_posts").insert(payload);
      if (error) throw error;
      toast.success("News post published");
      setDraft(EMPTY_FORM);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to publish news post");
    } finally {
      setCreating(false);
    }
  };

  const savePost = async () => {
    if (!selectedPost) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("portal_news_posts")
        .update({
          title: draft.title.trim(),
          caption: draft.caption.trim(),
          image_path: draft.image_path.trim(),
          image_alt: draft.image_alt.trim(),
          posted_by_name: draft.posted_by_name.trim() || "LIVEY Admin",
          posted_by_role: draft.posted_by_role.trim() || "super_admin",
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedPost.id);
      if (error) throw error;
      toast.success("News post updated");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update news post");
    } finally {
      setSaving(false);
    }
  };

  const deletePost = async (post: NewsPostRecord) => {
    setDeletingId(post.id);
    try {
      const { error } = await supabase.from("portal_news_posts").delete().eq("id", post.id);
      if (error) throw error;
      toast.success("News post deleted");
      if (selectedId === post.id) {
        setSelectedId(null);
        setDraft(EMPTY_FORM);
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete news post");
    } finally {
      setDeletingId(null);
    }
  };

  const uploadImage = async (file: File) => {
    setUploadingImage(true);
    try {
      const result = await uploadRewardImage({
        file,
        folder: "news",
      });
      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? "Image upload failed");
      }
      setDraft((current) => ({ ...current, image_path: result.data.secure_url }));
      toast.success("Image uploaded successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image upload failed");
    } finally {
      setUploadingImage(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Administration
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">News feed</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Publish updates with optional images. Text-only posts render like a social feed card.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {source === "database" ? "Live Postgres data" : "Empty state"}
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
            filename={`livey-news-${formatCsvDate()}.csv`}
            columns={NEWS_EXPORT_COLUMNS}
            loadRows={async () =>
              filteredPosts.map((post) => ({
                title: post.title,
                caption: post.caption,
                image_path: post.image_path,
                image_alt: post.image_alt,
                posted_by_name: post.posted_by_name,
                posted_by_role: post.posted_by_role,
                created_at: post.created_at,
                updated_at: post.updated_at,
              }))
            }
            variant="outline"
          />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Published posts</CardTitle>
                <CardDescription>
                  Admin-authored posts that appear on partner dashboards.
                </CardDescription>
              </div>
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search posts"
                  className="pl-8"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading news posts...
              </div>
            ) : filteredPosts.length === 0 ? (
              <div className="p-8 text-sm text-muted-foreground">
                No posts yet. Publish the first product update on the right.
              </div>
            ) : (
              <div className="divide-y">
                {filteredPosts.map((post) => (
                  <div
                    key={post.id}
                    className={`grid gap-4 px-5 py-4 lg:grid-cols-[180px_1fr] ${
                      selectedPost?.id === post.id ? "bg-muted/30" : ""
                    }`}
                  >
                    <button
                      onClick={() => setSelectedId(post.id)}
                      className="overflow-hidden rounded-xl border bg-background text-left"
                    >
                      {hasNewsImage(post.image_path) ? (
                        <img
                          src={post.image_path ?? ""}
                          alt={post.image_alt ?? post.title}
                          className="h-40 w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-40 w-full flex-col justify-between bg-gradient-to-br from-primary/5 via-background to-background p-4 text-left">
                          <div>
                            <div className="text-xs uppercase tracking-widest text-muted-foreground">
                              Text update
                            </div>
                            <div className="mt-2 max-h-14 overflow-hidden text-sm font-medium">
                              {post.title}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">{post.posted_by_name}</div>
                        </div>
                      )}
                    </button>
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{formatDateLabel(post.created_at)}</Badge>
                        <Badge>{post.posted_by_role.replace(/_/g, " ")}</Badge>
                      </div>
                      <div>
                        <div className="text-base font-medium">{post.title}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{post.caption}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{post.posted_by_name}</span>
                        <span>•</span>
                        <span>
                          {hasNewsImage(post.image_path) ? "Image attached" : "No image attached"}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setSelectedId(post.id)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => void deletePost(post)}
                          disabled={deletingId === post.id}
                        >
                          {deletingId === post.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                          )}
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Edit post</CardTitle>
              <CardDescription>
                {selectedPost ? `Editing ${selectedPost.title}` : "Select a post to edit."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              {selectedPost ? (
                <>
                  <div className="overflow-hidden rounded-xl border">
                    {hasNewsImage(draft.image_path) ? (
                      <img
                        src={draft.image_path}
                        alt={draft.image_alt || draft.title || "LIVEY update"}
                        className="h-56 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-56 w-full flex-col justify-between bg-gradient-to-br from-primary/5 via-background to-background p-5">
                        <div className="space-y-2">
                          <div className="text-xs uppercase tracking-widest text-muted-foreground">
                            Text-only preview
                          </div>
                          <div className="text-lg font-semibold">
                            {draft.title || "Untitled post"}
                          </div>
                          <div className="whitespace-pre-line text-sm text-muted-foreground">
                            {draft.caption || "This post will render without an image."}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {draft.posted_by_name || "LIVEY Admin"}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Title">
                      <Input
                        value={draft.title}
                        onChange={(e) =>
                          setDraft((current) => ({ ...current, title: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Image">
                      <div className="space-y-2">
                        <div className="overflow-hidden rounded-xl border bg-muted/20">
                          {draft.image_path.trim() ? (
                            <img
                              src={draft.image_path}
                              alt={draft.image_alt || draft.title || "LIVEY update"}
                              className="h-48 w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-48 flex-col justify-between p-4">
                              <div>
                                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                                  No image uploaded
                                </div>
                                <div className="mt-2 max-w-sm text-sm font-medium">
                                  Upload an image to display it in the post preview.
                                </div>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                PNG, JPG, or WEBP recommended
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="inline-flex items-center gap-2">
                          <input
                            id="news_image"
                            type="file"
                            className="hidden"
                            accept="image/*"
                            ref={editFileInputRef}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadImage(file);
                              e.currentTarget.value = "";
                            }}
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={uploadingImage}
                            onClick={() => editFileInputRef.current?.click()}
                          >
                            {uploadingImage ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Upload className="mr-2 h-4 w-4" />
                            )}
                            {draft.image_path.trim() ? "Replace image" : "Upload image"}
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            Uploads go straight to Cloudinary and save into this field.
                          </span>
                        </div>
                      </div>
                    </Field>
                    <Field label="Caption" className="md:col-span-2">
                      <Textarea
                        value={draft.caption}
                        onChange={(e) =>
                          setDraft((current) => ({ ...current, caption: e.target.value }))
                        }
                        rows={8}
                      />
                    </Field>
                    <Field label="Alt text">
                      <Input
                        value={draft.image_alt}
                        onChange={(e) =>
                          setDraft((current) => ({ ...current, image_alt: e.target.value }))
                        }
                      />
                    </Field>
                    <Field label="Posted by">
                      <Input
                        value={draft.posted_by_name}
                        onChange={(e) =>
                          setDraft((current) => ({ ...current, posted_by_name: e.target.value }))
                        }
                      />
                    </Field>
                  </div>
                  <Button onClick={() => void savePost()} disabled={saving || uploadingImage}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save changes
                  </Button>
                </>
              ) : (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  No post selected.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Publish post</CardTitle>
              <CardDescription>
                Create a new update with an optional image attachment.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Title">
                  <Input
                    value={draft.title}
                    onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))}
                    placeholder="Upgrade your video presence instantly"
                  />
                </Field>
                <Field label="Image">
                  <div className="space-y-2">
                    <div className="overflow-hidden rounded-xl border bg-muted/20">
                      {draft.image_path.trim() ? (
                        <img
                          src={draft.image_path}
                          alt={draft.image_alt || draft.title || "LIVEY update"}
                          className="h-48 w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-48 flex-col justify-between p-4">
                          <div>
                            <div className="text-xs uppercase tracking-widest text-muted-foreground">
                              No image uploaded
                            </div>
                            <div className="mt-2 max-w-sm text-sm font-medium">
                              Upload an image to display it in the post preview.
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            PNG, JPG, or WEBP recommended
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="inline-flex items-center gap-2">
                      <input
                        id="news_image_create"
                        type="file"
                        className="hidden"
                        accept="image/*"
                        ref={createFileInputRef}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadImage(file);
                          e.currentTarget.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={uploadingImage}
                        onClick={() => createFileInputRef.current?.click()}
                      >
                        {uploadingImage ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="mr-2 h-4 w-4" />
                        )}
                        {draft.image_path.trim() ? "Replace image" : "Upload image"}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Uploads go straight to Cloudinary and save into this field.
                      </span>
                    </div>
                  </div>
                </Field>
                <Field label="Caption" className="md:col-span-2">
                  <Textarea
                    rows={8}
                    value={draft.caption}
                    onChange={(e) =>
                      setDraft((current) => ({ ...current, caption: e.target.value }))
                    }
                    placeholder="Write the caption that partners will see."
                  />
                </Field>
                <Field label="Alt text">
                  <Input
                    value={draft.image_alt}
                    onChange={(e) =>
                      setDraft((current) => ({ ...current, image_alt: e.target.value }))
                    }
                    placeholder="LIVEY webcam promotion"
                  />
                </Field>
                <Field label="Posted by">
                  <Input
                    value={draft.posted_by_name}
                    onChange={(e) =>
                      setDraft((current) => ({ ...current, posted_by_name: e.target.value }))
                    }
                    placeholder="LIVEY Admin"
                  />
                </Field>
              </div>
              <Button onClick={() => void createPost()} disabled={creating || uploadingImage}>
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                Publish post
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: import("react").ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
