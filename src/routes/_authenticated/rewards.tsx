import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Gift,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Trophy,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/local/client";
import { formatDateLabel, formatDateTimeLabel } from "@/lib/date-utils";
import { formatCsvDate, type CsvColumn } from "@/lib/csv-export";
import { applyPartnerScope } from "@/lib/partner-scope";
import {
  rewardProgress,
  rewardTierForPoints,
  sumRewardPoints,
  type RewardCatalogRecord,
  type RewardPointEventRecord,
  type RewardRedemptionRecord,
} from "@/lib/rewards";
import { useAuth } from "@/hooks/use-auth";
import { useRequireAccess } from "@/hooks/use-partner-access";
import { recordAuditEvent } from "@/lib/workflow-events";

export const Route = createFileRoute("/_authenticated/rewards")({
  component: RewardsPage,
});

const REWARD_CATALOG_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "title", header: "Title" },
  { key: "description", header: "Description" },
  { key: "category", header: "Category" },
  { key: "points_cost", header: "Points Cost" },
  { key: "stock", header: "Stock" },
  { key: "availability", header: "Availability" },
];

const REWARD_REDEMPTION_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "reward_title", header: "Reward" },
  { key: "status", header: "Status" },
  { key: "shipping_name", header: "Shipping Name" },
  { key: "points_cost", header: "Points Cost" },
  { key: "approved_at", header: "Approved At" },
  { key: "created_at", header: "Created At" },
];

function RewardsPage() {
  const { profile, hasRole } = useAuth();
  const access = useRequireAccess('partial');
  
  const [catalog, setCatalog] = useState<RewardCatalogRecord[]>([]);
  const [events, setEvents] = useState<RewardPointEventRecord[]>([]);
  const [redemptions, setRedemptions] = useState<RewardRedemptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [requestOpen, setRequestOpen] = useState(false);
  const [selectedReward, setSelectedReward] = useState<RewardCatalogRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [requestDraft, setRequestDraft] = useState({
    shipping_name: "",
    shipping_address: "",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const catalogQuery = supabase
        .from("reward_catalog_items")
        .select("*")
        .order("created_at", { ascending: false });
      let pointsQuery = supabase
        .from("reward_point_events")
        .select("*")
        .order("created_at", { ascending: false });
      let redemptionQuery = supabase
        .from("reward_redemptions")
        .select("*")
        .order("created_at", { ascending: false });

      pointsQuery = applyPartnerScope(pointsQuery, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
      });
      redemptionQuery = applyPartnerScope(redemptionQuery, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
      });

      const [catalogRes, pointsRes, redemptionRes] = await Promise.all([
        catalogQuery,
        pointsQuery,
        redemptionQuery,
      ]);

      if (catalogRes.error || pointsRes.error || redemptionRes.error) {
        throw catalogRes.error ?? pointsRes.error ?? redemptionRes.error;
      }

      const catalogRows = (catalogRes.data as RewardCatalogRecord[] | null) ?? [];
      const pointRows = (pointsRes.data as RewardPointEventRecord[] | null) ?? [];
      const redemptionRows = (redemptionRes.data as RewardRedemptionRecord[] | null) ?? [];

      setCatalog(catalogRows);
      setEvents(pointRows);
      setRedemptions(redemptionRows);
      setSource(
        catalogRows.length || pointRows.length || redemptionRows.length ? "database" : "empty",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load rewards");
      setCatalog([]);
      setEvents([]);
      setRedemptions([]);
      setSource("empty");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hasRole, profile?.id, profile?.partner_id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setRequestDraft((current) => ({
      ...current,
      shipping_name: current.shipping_name || profile?.full_name || "",
    }));
  }, [profile?.full_name]);

  const points = useMemo(() => sumRewardPoints(events), [events]);
  const tier = useMemo(() => rewardTierForPoints(points), [points]);
  const progress = useMemo(() => rewardProgress(points), [points]);

  const categories = useMemo(
    () => ["all", ...new Set(catalog.map((item) => item.category).filter(Boolean))],
    [catalog],
  );

  const filteredCatalog = useMemo(() => {
    const term = query.trim().toLowerCase();
    return catalog.filter((item) => {
      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
      const matchesQuery =
        !term ||
        [item.title, item.description, item.category, String(item.points_cost)]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesCategory && matchesQuery;
    });
  }, [categoryFilter, catalog, query]);

  const recentEvents = useMemo(() => events.slice(0, 6), [events]);
  const rewardById = useMemo(
    () => new Map(catalog.map((item) => [item.id, item])),
    [catalog],
  );

  const openRequestDialog = (reward: RewardCatalogRecord) => {
    setSelectedReward(reward);
    setRequestDraft({
      shipping_name: profile?.full_name ?? "",
      shipping_address: "",
      notes: "",
    });
    setRequestOpen(true);
  };

  const submitRequest = async () => {
    if (!selectedReward) return;
    if (!profile?.id) {
      toast.error("Your profile is not ready yet");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("reward_redemptions").insert({
        id: crypto.randomUUID(),
        reward_id: selectedReward.id,
        user_id: profile.id,
        partner_id: profile.partner_id,
        points_cost: selectedReward.points_cost,
        status: "requested",
        shipping_name: requestDraft.shipping_name.trim() || profile.full_name,
        shipping_address: requestDraft.shipping_address.trim(),
        notes: requestDraft.notes.trim(),
        is_seed: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      await recordAuditEvent(supabase, {
        actorName: profile?.full_name ?? "LIVEY User",
        actorRole: hasRole("super_admin")
          ? "super_admin"
          : hasRole("partner_admin")
            ? "partner_admin"
            : "partner_user",
        action: "reward_redemption_request",
        targetType: "reward",
        targetName: selectedReward.title,
        outcome: "requested",
        details: `Requested redemption for ${selectedReward.title}`,
        severity: "low",
      });
      toast.success("Redemption requested");
      setRequestOpen(false);
      setSelectedReward(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to request redemption");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Gift className="h-3.5 w-3.5" />
            Rewards
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Rewards store</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Earn points from successful deals, track your tier, and redeem rewards from the LIVEY
            catalog.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            {source === "database" ? "Live Postgres data" : "Empty state"}
          </Badge>
          {hasRole("super_admin") && (
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/rewards">
                <ShieldCheck className="mr-2 h-4 w-4" />
                Manage store
              </Link>
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
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
              label="Export store CSV"
              filename={`livey-rewards-catalog-${formatCsvDate()}.csv`}
              columns={REWARD_CATALOG_EXPORT_COLUMNS}
              loadRows={async () =>
                filteredCatalog.map((item) => ({
                  title: item.title,
                  description: item.description,
                  category: item.category,
                  points_cost: item.points_cost,
                  stock: item.stock,
                  availability: item.availability,
                }))
              }
              variant="outline"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Reward points" value={String(points)} hint={`${tier} tier`} />
        <Metric
          label="Next tier"
          value={progress.nextTier ?? "Max"}
          hint={progress.pointsToNext > 0 ? `${progress.pointsToNext} points to go` : "Top tier"}
        />
        <Metric label="Rewards" value={String(catalog.length)} hint="Catalog items" />
        <Metric label="Requests" value={String(redemptions.length)} hint="Redemption history" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader className="space-y-4 border-b">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-base">Reward catalog</CardTitle>
                <CardDescription>
                  Browse the storefront-style catalog and request a redemption when you have enough
                  points.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search rewards"
                  className="w-full max-w-xs"
                />
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category === "all" ? "All categories" : category}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {filteredCatalog.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-10 text-center">
                <ShoppingBag className="mx-auto h-10 w-10 text-muted-foreground" />
                <div className="mt-3 text-sm font-medium">No rewards yet</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Super admins can create the first catalog items from the rewards manager.
                </div>
                {hasRole("super_admin") && (
                  <Button asChild className="mt-4">
                    <Link to="/admin/rewards">
                      Open rewards manager
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {filteredCatalog.map((item) => (
                  <RewardCard
                    key={item.id}
                    item={item}
                    onRequest={() => openRequestDialog(item)}
                    canRequest={points >= item.points_cost}
                    points={points}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your standing</CardTitle>
              <CardDescription>Points earned from deal wins and approved activity.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">
                      Current tier
                    </div>
                    <div className="mt-1 text-2xl font-semibold tracking-tight">{tier}</div>
                  </div>
                  <Trophy className="h-7 w-7 text-primary" />
                </div>
                <div className="mt-4 text-4xl font-semibold tracking-tight">{points}</div>
                <div className="mt-1 text-sm text-muted-foreground">Available reward points</div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs uppercase tracking-widest text-muted-foreground">
                  <span>Tier progress</span>
                  <span>{progress.progress}%</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary transition-all"
                    style={{ width: `${progress.progress}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {progress.nextTier
                    ? `${progress.pointsToNext} points to ${progress.nextTier}`
                    : "You are at the top tier."}
                </div>
              </div>

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Deal win bonus</span>
                  <span className="font-medium">500 points</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Redemption requests</span>
                  <span className="font-medium">
                    {redemptions.filter((redemption) => redemption.status === "requested").length}
                  </span>
                </div>
              </div>

              {hasRole("super_admin") && (
                <Button asChild className="w-full">
                  <Link to="/admin/rewards">
                    Manage rewards catalog
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Recent activity</CardTitle>
              <CardDescription>Latest points and redemption events.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentEvents.length === 0 ? (
                <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  No points activity yet. Winning a deal will create the first entry.
                </div>
              ) : (
                recentEvents.map((event) => (
                  <div key={event.id} className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{event.reason}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {event.source_type.replace(/_/g, " ")} ·{" "}
                          {formatDateTimeLabel(event.created_at)}
                        </div>
                      </div>
                      <Badge variant={event.points_delta >= 0 ? "default" : "secondary"}>
                        {event.points_delta >= 0 ? "+" : ""}
                        {event.points_delta}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-base">My redemptions</CardTitle>
                  <CardDescription>Track the rewards you have requested.</CardDescription>
                </div>
                <CsvExportButton
                  label="Export redemptions"
                  filename={`livey-rewards-redemptions-${formatCsvDate()}.csv`}
                  columns={REWARD_REDEMPTION_EXPORT_COLUMNS}
                  loadRows={async () =>
                    redemptions.map((redemption) => ({
                      reward_title: rewardById.get(redemption.reward_id)?.title ?? redemption.reward_id,
                      status: redemption.status,
                      shipping_name: redemption.shipping_name,
                      points_cost: redemption.points_cost,
                      approved_at: redemption.approved_at,
                      created_at: redemption.created_at,
                    }))
                  }
                  variant="outline"
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {redemptions.length === 0 ? (
                <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  No redemption requests yet.
                </div>
              ) : (
                redemptions.slice(0, 4).map((redemption) => (
                  <div key={redemption.id} className="rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">Reward request</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {redemption.status.replace(/_/g, " ")} ·{" "}
                          {formatDateLabel(redemption.created_at)}
                        </div>
                      </div>
                      <Badge variant="outline">{redemption.points_cost} pts</Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request redemption</DialogTitle>
            <DialogDescription>
              Submit a request for the selected reward. Super admins can review and fulfill
              redemptions from the admin panel.
            </DialogDescription>
          </DialogHeader>
          {selectedReward && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-sm font-medium">{selectedReward.title}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {selectedReward.description}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="secondary">{selectedReward.category}</Badge>
                  <Badge variant="outline">{selectedReward.points_cost} points</Badge>
                </div>
              </div>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="shipping_name">Shipping name</Label>
                  <Input
                    id="shipping_name"
                    value={requestDraft.shipping_name}
                    onChange={(event) =>
                      setRequestDraft((current) => ({
                        ...current,
                        shipping_name: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="shipping_address">Shipping address</Label>
                  <Textarea
                    id="shipping_address"
                    value={requestDraft.shipping_address}
                    onChange={(event) =>
                      setRequestDraft((current) => ({
                        ...current,
                        shipping_address: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="request_notes">Notes</Label>
                  <Textarea
                    id="request_notes"
                    value={requestDraft.notes}
                    onChange={(event) =>
                      setRequestDraft((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setRequestOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void submitRequest()}
                  disabled={submitting || points < selectedReward.points_cost}
                >
                  {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Request redemption
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
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

function RewardCard({
  item,
  onRequest,
  canRequest,
  points,
}: {
  item: RewardCatalogRecord;
  onRequest: () => void;
  canRequest: boolean;
  points: number;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-primary/20 via-background to-muted">
        {item.image_path ? (
          <img src={item.image_path} alt={item.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Sparkles className="h-12 w-12 text-primary/50" />
          </div>
        )}
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{item.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">{item.description}</div>
          </div>
          <Badge variant="outline">{item.points_cost} pts</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{item.category}</Badge>
          <Badge variant={item.availability === "available" ? "default" : "outline"}>
            {item.availability}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">
          {item.stock > 0 ? `${item.stock} available` : "Out of stock"}
        </div>
        <Button
          className="w-full"
          variant={canRequest ? "default" : "outline"}
          onClick={onRequest}
          disabled={!canRequest || item.stock <= 0}
        >
          {canRequest
            ? "Request reward"
            : `Need ${Math.max(item.points_cost - points, 0)} more points`}
        </Button>
      </div>
    </div>
  );
}
