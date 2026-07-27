import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Trophy,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { CsvExportButton } from "@/components/csv-export-button";
import { AccessDeniedPage } from "@/components/route-placeholder";
import { LookupCombobox } from "@/components/lookup-combobox";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase, uploadRewardImage } from "@/integrations/local/client";
import { type CsvColumn } from "@/lib/csv-export";
import { formatDateLabel, formatDateTimeLabel } from "@/lib/date-utils";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import {
  buildManualRewardAdjustmentEvent,
  calculateOutstandingRewardPoints,
  validateRewardCatalogImportRows,
} from "@/lib/reward-admin";
import {
  type RewardCatalogRecord,
  type RewardPointEventRecord,
  type RewardRedemptionRecord,
} from "@/lib/rewards";
import { useAuth } from "@/hooks/use-auth";
import { recordAuditEvent, recordNotification } from "@/lib/workflow-events";

type RewardForm = {
  title: string;
  description: string;
  image_path: string;
  category: string;
  points_cost: string;
  stock: string;
  availability: string;
};

const EMPTY_FORM: RewardForm = {
  title: "",
  description: "",
  image_path: "",
  category: "Merchandise",
  points_cost: "500",
  stock: "1",
  availability: "available",
};

const REWARD_CATALOG_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "title", header: "Title" },
  { key: "description", header: "Description" },
  { key: "image_path", header: "Image Path" },
  { key: "category", header: "Category" },
  { key: "points_cost", header: "Points Cost" },
  { key: "stock", header: "Stock" },
  { key: "availability", header: "Availability" },
  { key: "is_seed", header: "Is Seed" },
  { key: "created_at", header: "Created At" },
  { key: "updated_at", header: "Updated At" },
];

const REWARD_REDEMPTION_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "reward_title", header: "Reward" },
  { key: "reward_category", header: "Category" },
  { key: "user_id", header: "User ID" },
  { key: "partner_id", header: "Partner ID" },
  { key: "shipping_name", header: "Shipping Name" },
  { key: "shipping_address", header: "Shipping Address" },
  { key: "notes", header: "Notes" },
  { key: "points_cost", header: "Points Cost" },
  { key: "status", header: "Status" },
  { key: "approved_by", header: "Approved By" },
  { key: "approved_at", header: "Approved At" },
  { key: "created_at", header: "Created At" },
  { key: "updated_at", header: "Updated At" },
];

export const Route = createFileRoute("/_authenticated/admin/rewards")({
  component: AdminRewardsPage,
});

function AdminRewardsPage() {
  const { hasRole, profile } = useAuth();
  const [catalog, setCatalog] = useState<RewardCatalogRecord[]>([]);
  const [redemptions, setRedemptions] = useState<RewardRedemptionRecord[]>([]);
  const [events, setEvents] = useState<RewardPointEventRecord[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; full_name: string; email: string; partner_id: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<RewardForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [importingCatalog, setImportingCatalog] = useState(false);
  const [adjustingPoints, setAdjustingPoints] = useState(false);
  const [adjustmentDraft, setAdjustmentDraft] = useState({
    userId: "",
    pointsDelta: "",
    reason: "",
  });
  const rewardImageInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [catalogRes, redemptionRes, pointRes, userRes] = await Promise.all([
        supabase.from("reward_catalog_items").select("*").order("created_at", { ascending: false }),
        supabase.from("reward_redemptions").select("*").order("created_at", { ascending: false }),
        supabase.from("reward_point_events").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("id, full_name, email, partner_id").order("full_name", { ascending: true }),
      ]);
      if (catalogRes.error || redemptionRes.error || pointRes.error || userRes.error) {
        throw catalogRes.error ?? redemptionRes.error ?? pointRes.error ?? userRes.error;
      }
      const catalogRows = (catalogRes.data as RewardCatalogRecord[] | null) ?? [];
      const redemptionRows = (redemptionRes.data as RewardRedemptionRecord[] | null) ?? [];
      const pointRows = (pointRes.data as RewardPointEventRecord[] | null) ?? [];
      setCatalog(catalogRows);
      setRedemptions(redemptionRows);
      setEvents(pointRows);
      setUsers(
        ((userRes.data as Array<{ id: string; full_name: string; email: string; partner_id: string | null }> | null) ?? []).filter(
          (user) => Boolean(user.email),
        ),
      );
      setSource(catalogRows.length || redemptionRows.length || pointRows.length ? "database" : "empty");
      setSelectedId((current) => current ?? catalogRows[0]?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load rewards");
      setCatalog([]);
      setRedemptions([]);
      setEvents([]);
      setUsers([]);
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

  const filteredRedemptions = useMemo(() => {
    const term = query.trim().toLowerCase();
    return redemptions.filter((redemption) => {
      const reward = catalog.find((item) => item.id === redemption.reward_id);
      const matchesQuery =
        !term ||
        [reward?.title, reward?.category, redemption.status, redemption.shipping_name]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesQuery;
    });
  }, [catalog, query, redemptions]);

  const selectedItem = useMemo(
    () => catalog.find((item) => item.id === selectedId) ?? null,
    [catalog, selectedId],
  );
  const outstandingPoints = useMemo(() => calculateOutstandingRewardPoints(events), [events]);

  useEffect(() => {
    if (!selectedItem) return;
    setDraft({
      title: selectedItem.title,
      description: selectedItem.description,
      image_path: selectedItem.image_path ?? "",
      category: selectedItem.category,
      points_cost: String(selectedItem.points_cost),
      stock: String(selectedItem.stock),
      availability: selectedItem.availability,
    });
  }, [selectedItem]);

  if (!hasRole("super_admin")) {
    return <AccessDeniedPage title="Rewards" roleLabel="Super Admin" />;
  }

  const saveItem = async () => {
    if (!selectedItem) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("reward_catalog_items")
        .update({
          title: draft.title.trim(),
          description: draft.description.trim(),
          image_path: draft.image_path.trim() || null,
          category: draft.category.trim() || "Merchandise",
          points_cost: Number(draft.points_cost) || 0,
          stock: Number(draft.stock) || 0,
          availability: draft.availability.trim() || "available",
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedItem.id);
      if (error) throw error;
      toast.success("Reward updated");
      setEditOpen(false);
      await recordAuditEvent(supabase, {
        actorName: profile?.full_name ?? "LIVEY Admin",
        actorRole: "super_admin",
        action: "reward_update",
        targetType: "reward",
        targetName: selectedItem.title,
        outcome: "updated",
        details: `Updated ${selectedItem.title} in the reward catalog`,
        severity: "low",
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save reward");
    } finally {
      setSaving(false);
    }
  };

  const addItem = async () => {
    if (!draft.title.trim() || !draft.description.trim()) {
      toast.error("Title and description are required");
      return;
    }
    setCreating(true);
    try {
      const { error } = await supabase.from("reward_catalog_items").insert({
        id: crypto.randomUUID(),
        title: draft.title.trim(),
        description: draft.description.trim(),
        image_path: draft.image_path.trim() || null,
        category: draft.category.trim() || "Merchandise",
        points_cost: Number(draft.points_cost) || 0,
        stock: Number(draft.stock) || 0,
        availability: draft.availability.trim() || "available",
        is_seed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success("Reward added");
      await recordAuditEvent(supabase, {
        actorName: profile?.full_name ?? "LIVEY Admin",
        actorRole: "super_admin",
        action: "reward_create",
        targetType: "reward",
        targetName: draft.title.trim(),
        outcome: "created",
        details: `Created reward catalog item ${draft.title.trim()}`,
        severity: "low",
      });
      setDraft(EMPTY_FORM);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add reward");
    } finally {
      setCreating(false);
    }
  };

  const deleteItem = async (item: RewardCatalogRecord) => {
    setDeletingId(item.id);
    try {
      const { error } = await supabase.from("reward_catalog_items").delete().eq("id", item.id);
      if (error) throw error;
      toast.success("Reward deleted");
      if (selectedId === item.id) {
        setEditOpen(false);
      }
      await recordAuditEvent(supabase, {
        actorName: profile?.full_name ?? "LIVEY Admin",
        actorRole: "super_admin",
        action: "reward_delete",
        targetType: "reward",
        targetName: item.title,
        outcome: "deleted",
        details: `Deleted reward catalog item ${item.title}`,
        severity: "medium",
      });
      if (selectedId === item.id) {
        setSelectedId(null);
        setDraft(EMPTY_FORM);
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete reward");
    } finally {
      setDeletingId(null);
    }
  };

  const handleRewardImageUpload = async (file: File) => {
    setUploadingImage(true);
    try {
      const result = await uploadRewardImage({
        file,
        folder: "reward-catalog",
      });
      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? "Image upload failed");
      }
      setDraft((current) => ({ ...current, image_path: result.data.secure_url }));
      toast.success("Reward image uploaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Image upload failed");
    } finally {
      setUploadingImage(false);
    }
  };

  const approveRedemption = async (redemption: RewardRedemptionRecord) => {
    const reward = catalog.find((item) => item.id === redemption.reward_id) ?? null;
    setProcessingId(redemption.id);
    try {
      const now = new Date().toISOString();
      const updateRes = await supabase
        .from("reward_redemptions")
        .update({
          status: "approved",
          approved_by: profile?.id ?? null,
          approved_at: now,
          updated_at: now,
        })
        .eq("id", redemption.id);
      if (updateRes.error) throw updateRes.error;

      const pointsRes = await supabase.from("reward_point_events").insert({
        id: crypto.randomUUID(),
        user_id: redemption.user_id,
        partner_id: redemption.partner_id,
        source_type: "redemption",
        source_id: redemption.id,
        points_delta: -Math.abs(redemption.points_cost),
        reason: `Redeemed ${reward?.title ?? "reward"}`,
        approved_by: profile?.id ?? null,
        approved_at: now,
        is_seed: false,
        created_at: now,
      });
      if (pointsRes.error) throw pointsRes.error;
      await recordNotification(supabase, {
        userId: redemption.user_id,
        partnerId: redemption.partner_id,
        title: "Reward redemption approved",
        message: `${reward?.title ?? "Your reward"} was approved by LIVEY.`,
        type: "reward_redemption",
      });
      await recordAuditEvent(supabase, {
        actorName: profile?.full_name ?? "LIVEY Admin",
        actorRole: "super_admin",
        action: "reward_redemption_approved",
        targetType: "redemption",
        targetName: reward?.title ?? redemption.id,
        outcome: "approved",
        details: `Approved redemption request for ${reward?.title ?? "reward"}`,
        severity: "medium",
      });

      toast.success("Redemption approved");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to approve redemption");
    } finally {
      setProcessingId(null);
    }
  };

  const rejectRedemption = async (redemption: RewardRedemptionRecord) => {
    const reward = catalog.find((item) => item.id === redemption.reward_id) ?? null;
    setProcessingId(redemption.id);
    try {
      const { error } = await supabase
        .from("reward_redemptions")
        .update({
          status: "rejected",
          approved_by: profile?.id ?? null,
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", redemption.id);
      if (error) throw error;
      await recordNotification(supabase, {
        userId: redemption.user_id,
        partnerId: redemption.partner_id,
        title: "Reward redemption rejected",
        message: `Your redemption request for ${reward?.title ?? "a reward"} was rejected.`,
        type: "reward_redemption",
      });
      await recordAuditEvent(supabase, {
        actorName: profile?.full_name ?? "LIVEY Admin",
        actorRole: "super_admin",
        action: "reward_redemption_rejected",
        targetType: "redemption",
        targetName: reward?.title ?? redemption.id,
        outcome: "rejected",
        details: `Rejected redemption request for ${reward?.title ?? "reward"}`,
        severity: "medium",
      });
      toast.success("Redemption rejected");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reject redemption");
    } finally {
      setProcessingId(null);
    }
  };

  const importCatalogFile = async (file: File) => {
    setImportingCatalog(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const firstSheet = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheet];
      const rawRows = (XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Array<Record<string, unknown>>) ?? [];
      const validation = validateRewardCatalogImportRows(rawRows);

      if (!validation.ok) {
        throw new Error(
          `Catalog import rejected. ${validation.errors
            .slice(0, 3)
            .map((error) => `Row ${error.rowNumber}: ${error.message}`)
            .join(" | ")}`,
        );
      }

      const now = new Date().toISOString();
      const { error } = await supabase.from("reward_catalog_items").insert(
        validation.rows.map((row) => ({
          id: globalThis.crypto.randomUUID(),
          ...row,
          is_seed: false,
          created_at: now,
          updated_at: now,
        })),
      );
      if (error) throw error;

      toast.success(`Imported ${validation.rows.length} catalog items`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Catalog import failed");
    } finally {
      setImportingCatalog(false);
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  };

  const saveAdjustment = async () => {
    const user = users.find((entry) => entry.id === adjustmentDraft.userId) ?? null;
    const pointsDelta = Number.parseInt(adjustmentDraft.pointsDelta, 10);
    if (!user || !Number.isFinite(pointsDelta) || pointsDelta === 0 || !adjustmentDraft.reason.trim()) {
      toast.error("Choose a user, enter a non-zero point adjustment, and add a reason");
      return;
    }

    setAdjustingPoints(true);
    try {
      const payload = buildManualRewardAdjustmentEvent({
        userId: user.id,
        partnerId: user.partner_id,
        pointsDelta,
        reason: adjustmentDraft.reason,
        actorId: profile?.id ?? null,
      });
      const { error } = await supabase.from("reward_point_events").insert(payload);
      if (error) throw error;

      toast.success("Manual points adjustment saved");
      setAdjustmentDraft({ userId: "", pointsDelta: "", reason: "" });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save points adjustment");
    } finally {
      setAdjustingPoints(false);
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
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Rewards manager</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Super admins can manage the reward catalog and approve redemption requests from one
            screen.
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
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Catalog items" value={String(catalog.length)} hint="Published rewards" />
        <Metric
          label="Pending redemptions"
          value={String(
            redemptions.filter((redemption) => redemption.status === "requested").length,
          )}
          hint="Awaiting approval"
        />
        <Metric
          label="Approved redemptions"
          value={String(
            redemptions.filter((redemption) => redemption.status === "approved").length,
          )}
          hint="Fulfilled requests"
        />
        <Metric
          label="Outstanding points"
          value={String(outstandingPoints)}
          hint="Current ledger balance"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Reward catalog</CardTitle>
                <CardDescription>Create, edit, and remove marketplace items.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search rewards and requests"
                    className="pl-8"
                  />
                </div>
                <CsvExportButton
                  label="Export catalog"
                  filenameStem="livey-reward-catalog"
                  columns={REWARD_CATALOG_EXPORT_COLUMNS}
                  loadRows={async () =>
                    catalog.map((item) => ({
                      title: item.title,
                      description: item.description,
                      image_path: item.image_path,
                      category: item.category,
                      points_cost: item.points_cost,
                      stock: item.stock,
                      availability: item.availability,
                      is_seed: item.is_seed,
                      created_at: item.created_at,
                      updated_at: item.updated_at,
                    }))
                  }
                  variant="outline"
                />
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".csv,.xlsx"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void importCatalogFile(file);
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => importInputRef.current?.click()}
                  disabled={importingCatalog}
                >
                  {importingCatalog ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Import catalog
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6 p-6 lg:grid-cols-[0.7fr_1.3fr]">
            <div className="space-y-3">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Catalog entries
              </div>
              <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
                {catalog.length === 0 ? (
                  <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                    No reward items exist yet. Add one below to get started.
                  </div>
                ) : (
                  catalog.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(item.id);
                        setEditOpen(true);
                      }}
                      className={`w-full rounded-lg border px-4 py-3 text-left transition ${
                        selectedId === item.id ? "border-primary bg-primary/5" : "bg-card"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{item.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {item.category} · {item.points_cost} points
                          </div>
                        </div>
                        <Badge variant="outline">{item.availability}</Badge>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Create reward</div>
                    <div className="text-xs text-muted-foreground">
                      Manage product images, costs, and catalog grouping.
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="reward_title">Title</Label>
                    <Input
                      id="reward_title"
                      value={draft.title}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, title: event.target.value }))
                      }
                      placeholder="LIVEY merch pack"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="reward_description">Description</Label>
                    <Textarea
                      id="reward_description"
                      value={draft.description}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, description: event.target.value }))
                      }
                      placeholder="Short benefit-led description"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="reward_image">Image</Label>
                    <div className="overflow-hidden rounded-xl border bg-muted/20">
                      {draft.image_path.trim() ? (
                        <img
                          src={draft.image_path}
                          alt={draft.title.trim() || "Reward preview"}
                          className="h-48 w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-48 flex-col justify-between p-4">
                          <div>
                            <div className="text-xs uppercase tracking-widest text-muted-foreground">
                              No image uploaded
                            </div>
                            <div className="mt-2 max-w-sm text-sm font-medium">
                              Upload a reward image to display it in the catalog.
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            PNG, JPG, or WEBP recommended
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        id="reward_image"
                        ref={rewardImageInputRef}
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void handleRewardImageUpload(file);
                          event.currentTarget.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={uploadingImage}
                        onClick={() => rewardImageInputRef.current?.click()}
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
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>Category</Label>
                      <LookupCombobox
                        fieldName={LOOKUP_FIELDS.rewardCategory}
                        label="Category"
                        value={draft.category}
                        onValueChange={(value) =>
                          setDraft((current) => ({ ...current, category: value }))
                        }
                        placeholder="Select or create category"
                        options={[...new Set(catalog.map((item) => item.category))]}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="reward_availability">Availability</Label>
                      <Input
                        id="reward_availability"
                        value={draft.availability}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, availability: event.target.value }))
                        }
                        placeholder="available"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="reward_points">Points cost</Label>
                      <Input
                        id="reward_points"
                        type="number"
                        min={0}
                        value={draft.points_cost}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, points_cost: event.target.value }))
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="reward_stock">Stock</Label>
                      <Input
                        id="reward_stock"
                        type="number"
                        min={0}
                        value={draft.stock}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, stock: event.target.value }))
                        }
                      />
                    </div>
                  </div>
                </div>

                <Separator className="my-5" />

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={uploadingImage}
                    onClick={() => {
                      setSelectedId(null);
                      setDraft(EMPTY_FORM);
                    }}
                  >
                    New reward
                  </Button>
                  <Button onClick={() => void addItem()} disabled={creating || uploadingImage}>
                    {creating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Create reward
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border bg-card p-5">
                <div className="text-sm font-medium">Manual points adjustment</div>
                <div className="text-xs text-muted-foreground">
                  Create a positive credit or negative debit directly in the reward ledger.
                </div>
                <div className="mt-4 grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="adjustment-user">User</Label>
                    <select
                      id="adjustment-user"
                      value={adjustmentDraft.userId}
                      onChange={(event) =>
                        setAdjustmentDraft((current) => ({ ...current, userId: event.target.value }))
                      }
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Select a user</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.full_name} ({user.email})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="adjustment-points">Points delta</Label>
                    <Input
                      id="adjustment-points"
                      type="number"
                      value={adjustmentDraft.pointsDelta}
                      onChange={(event) =>
                        setAdjustmentDraft((current) => ({
                          ...current,
                          pointsDelta: event.target.value,
                        }))
                      }
                      placeholder="Use positive or negative values"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="adjustment-reason">Reason</Label>
                    <Textarea
                      id="adjustment-reason"
                      value={adjustmentDraft.reason}
                      onChange={(event) =>
                        setAdjustmentDraft((current) => ({ ...current, reason: event.target.value }))
                      }
                      placeholder="Reason for the manual credit or debit"
                    />
                  </div>
                  <Button onClick={() => void saveAdjustment()} disabled={adjustingPoints}>
                    {adjustingPoints ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save adjustment
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                {selectedItem ? `Edit ${selectedItem.title}` : "Edit reward"}
              </DialogTitle>
              <DialogDescription>
                Update the selected reward without keeping the editor inline on the page.
              </DialogDescription>
            </DialogHeader>

            {selectedItem ? (
              <>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="reward_title_modal">Title</Label>
                    <Input
                      id="reward_title_modal"
                      value={draft.title}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, title: event.target.value }))
                      }
                      placeholder="LIVEY merch pack"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="reward_description_modal">Description</Label>
                    <Textarea
                      id="reward_description_modal"
                      value={draft.description}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, description: event.target.value }))
                      }
                      placeholder="Short benefit-led description"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="reward_image_modal">Image</Label>
                    <div className="overflow-hidden rounded-xl border bg-muted/20">
                      {draft.image_path.trim() ? (
                        <img
                          src={draft.image_path}
                          alt={draft.title.trim() || "Reward preview"}
                          className="h-48 w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-48 flex-col justify-between p-4">
                          <div>
                            <div className="text-xs uppercase tracking-widest text-muted-foreground">
                              No image uploaded
                            </div>
                            <div className="mt-2 max-w-sm text-sm font-medium">
                              Upload a reward image to display it in the catalog.
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            PNG, JPG, or WEBP recommended
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        id="reward_image_modal"
                        ref={rewardImageInputRef}
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void handleRewardImageUpload(file);
                          event.currentTarget.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={uploadingImage}
                        onClick={() => rewardImageInputRef.current?.click()}
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
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>Category</Label>
                      <LookupCombobox
                        fieldName={LOOKUP_FIELDS.rewardCategory}
                        label="Category"
                        value={draft.category}
                        onValueChange={(value) =>
                          setDraft((current) => ({ ...current, category: value }))
                        }
                        placeholder="Select or create category"
                        options={[...new Set(catalog.map((item) => item.category))]}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="reward_availability_modal">Availability</Label>
                      <Input
                        id="reward_availability_modal"
                        value={draft.availability}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, availability: event.target.value }))
                        }
                        placeholder="available"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="reward_points_modal">Points cost</Label>
                      <Input
                        id="reward_points_modal"
                        type="number"
                        min={0}
                        value={draft.points_cost}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, points_cost: event.target.value }))
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="reward_stock_modal">Stock</Label>
                      <Input
                        id="reward_stock_modal"
                        type="number"
                        min={0}
                        value={draft.stock}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, stock: event.target.value }))
                        }
                      />
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      selectedItem &&
                      setDraft({
                        title: selectedItem.title,
                        description: selectedItem.description,
                        image_path: selectedItem.image_path ?? "",
                        category: selectedItem.category,
                        points_cost: String(selectedItem.points_cost),
                        stock: String(selectedItem.stock),
                        availability: selectedItem.availability,
                      })
                    }
                  >
                    Reset form
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void saveItem()}
                    disabled={saving || uploadingImage}
                  >
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save changes
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => selectedItem && void deleteItem(selectedItem)}
                    disabled={deletingId === selectedItem?.id}
                  >
                    {deletingId === selectedItem?.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Delete reward
                  </Button>
                </div>
              </>
            ) : null}
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Redemption requests</CardTitle>
                <CardDescription>
                  Approve or reject requests from the rewards storefront.
                </CardDescription>
              </div>
              <CsvExportButton
                label="Export redemptions"
                filenameStem="livey-reward-redemptions"
                columns={REWARD_REDEMPTION_EXPORT_COLUMNS}
                loadRows={async () =>
                  filteredRedemptions.map((redemption) => {
                    const reward = catalog.find((item) => item.id === redemption.reward_id) ?? null;
                    return {
                      reward_title: reward?.title ?? "",
                      reward_category: reward?.category ?? "",
                      user_id: redemption.user_id,
                      partner_id: redemption.partner_id,
                      shipping_name: redemption.shipping_name,
                      shipping_address: redemption.shipping_address,
                      notes: redemption.notes,
                      points_cost: redemption.points_cost,
                      status: redemption.status,
                      approved_by: redemption.approved_by,
                      approved_at: redemption.approved_at,
                      created_at: redemption.created_at,
                      updated_at: redemption.updated_at,
                    };
                  })
                }
                variant="outline"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {filteredRedemptions.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                No redemption requests found.
              </div>
            ) : (
              filteredRedemptions.map((redemption) => {
                const reward = catalog.find((item) => item.id === redemption.reward_id) ?? null;
                return (
                  <div key={redemption.id} className="rounded-lg border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {reward?.title ?? "Reward request"}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {redemption.shipping_name ?? "No shipping name"} ·{" "}
                          {formatDateTimeLabel(redemption.created_at)}
                        </div>
                      </div>
                      <Badge
                        variant={
                          redemption.status === "approved"
                            ? "default"
                            : redemption.status === "requested"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {redemption.status}
                      </Badge>
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground">
                      {redemption.points_cost} points ·{" "}
                      {redemption.shipping_address ?? "No address"}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {redemption.status === "requested" && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => void approveRedemption(redemption)}
                            disabled={processingId === redemption.id}
                          >
                            {processingId === redemption.id ? (
                              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trophy className="mr-2 h-3.5 w-3.5" />
                            )}
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void rejectRedemption(redemption)}
                            disabled={processingId === redemption.id}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      <Badge variant="outline">{formatDateLabel(redemption.updated_at)}</Badge>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}
