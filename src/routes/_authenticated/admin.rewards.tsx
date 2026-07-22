import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Search, ShieldCheck, Trash2, Trophy } from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedPage } from "@/components/route-placeholder";
import { LookupCombobox } from "@/components/lookup-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/local/client";
import { formatDateLabel, formatDateTimeLabel } from "@/lib/date-utils";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { type RewardCatalogRecord, type RewardRedemptionRecord } from "@/lib/rewards";
import { useAuth } from "@/hooks/use-auth";

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

export const Route = createFileRoute("/_authenticated/admin/rewards")({
  component: AdminRewardsPage,
});

function AdminRewardsPage() {
  const { hasRole, profile } = useAuth();
  const [catalog, setCatalog] = useState<RewardCatalogRecord[]>([]);
  const [redemptions, setRedemptions] = useState<RewardRedemptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RewardForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [catalogRes, redemptionRes] = await Promise.all([
        supabase.from("reward_catalog_items").select("*").order("created_at", { ascending: false }),
        supabase.from("reward_redemptions").select("*").order("created_at", { ascending: false }),
      ]);
      if (catalogRes.error || redemptionRes.error) {
        throw catalogRes.error ?? redemptionRes.error;
      }
      const catalogRows = (catalogRes.data as RewardCatalogRecord[] | null) ?? [];
      const redemptionRows = (redemptionRes.data as RewardRedemptionRecord[] | null) ?? [];
      setCatalog(catalogRows);
      setRedemptions(redemptionRows);
      setSource(catalogRows.length || redemptionRows.length ? "database" : "empty");
      setSelectedId((current) => current ?? catalogRows[0]?.id ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load rewards");
      setCatalog([]);
      setRedemptions([]);
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

      toast.success("Redemption approved");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to approve redemption");
    } finally {
      setProcessingId(null);
    }
  };

  const rejectRedemption = async (redemption: RewardRedemptionRecord) => {
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
      toast.success("Redemption rejected");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reject redemption");
    } finally {
      setProcessingId(null);
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
                      onClick={() => setSelectedId(item.id)}
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
                    <div className="text-sm font-medium">
                      {selectedItem ? "Edit reward" : "Create reward"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Manage product images, costs, and catalog grouping.
                    </div>
                  </div>
                  {selectedItem && (
                    <Badge variant="secondary">{selectedItem.points_cost} pts</Badge>
                  )}
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
                    <Label htmlFor="reward_image">Image URL</Label>
                    <Input
                      id="reward_image"
                      value={draft.image_path}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, image_path: event.target.value }))
                      }
                      placeholder="/news/livey-wc350-qhd.png"
                    />
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
                    onClick={() => {
                      setSelectedId(null);
                      setDraft(EMPTY_FORM);
                    }}
                  >
                    New reward
                  </Button>
                  <Button onClick={() => void addItem()} disabled={creating}>
                    {creating ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Create reward
                  </Button>
                  <Button onClick={() => void saveItem()} disabled={saving || !selectedItem}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save changes
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => selectedItem && void deleteItem(selectedItem)}
                    disabled={deletingId === selectedItem?.id || !selectedItem}
                  >
                    {deletingId === selectedItem?.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Redemption requests</CardTitle>
            <CardDescription>
              Approve or reject requests from the rewards storefront.
            </CardDescription>
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
