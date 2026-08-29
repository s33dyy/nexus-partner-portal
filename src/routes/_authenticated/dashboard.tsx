import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Building2,
  BarChart3,
  CheckCircle2,
  Clock,
  FileText,
  Handshake,
  Loader2,
  Megaphone,
  RefreshCw,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, StatTile } from "@/components/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NewsFeedCard } from "@/components/news-feed-card";
import { formatDateLabel } from "@/lib/date-utils";
import { applyPartnerScope } from "@/lib/partner-scope";
import { filterVisibleDeals, groupCollaboratorIdsByDeal } from "@/lib/deal-visibility";
import { filterNewsPostsForViewer, resolveNewsViewer } from "@/lib/news-targeting";
import { type NewsPostRecord } from "@/lib/portal-news-data";
import { rewardProgress, rewardTierForPoints, sumRewardPoints } from "@/lib/rewards";
import { getDashboardMetricDestination } from "@/lib/global-search";
import { matchesSelectedRegion, useRegionFilter } from "@/lib/region-filter";
import { getAgreementCtaLabel } from "@/routes/_authenticated/partner.agreement";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";
import { usePartnerAccess } from "@/hooks/use-partner-access";
import { getStatusLabel, getStatusProgress } from "@/lib/partner-status";
import { loadDashboardPipeline } from "@/integrations/local/dashboard-metrics";

type PartnerSpotlight = {
  id: string;
  company_name: string;
  tier: string;
  status: string;
  annual_turnover: string | null;
  business_focus: string[] | null;
  created_at: string;
  country?: string | null;
};

type NotificationFeedRow = {
  id: string;
  title: string;
  message: string;
  created_at: string;
};

type ActivityEventRow = {
  id: string;
  subject_type: string;
  subject_id: string;
  event_name: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type MetricTone = "neutral" | "brand" | "success" | "warning" | "danger";

type DashboardMetric = {
  id: string;
  label: string;
  value: string;
  hint: string;
  tone: MetricTone;
};

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { profile, roles, hasRole } = useAuth();
  const { selectedRegion } = useRegionFilter();
  const access = usePartnerAccess();
  const status = profile?.partner_status ?? "pending_partner_registration";
  const isPending = status === "pending_partner_registration";
  const showPartnerOnboarding = hasRole("partner_admin") && isPending;
  const roleLabel = roles.includes("super_admin")
    ? "Super Admin"
    : roles.includes("partner_admin")
      ? "Partner Admin"
      : "Partner User";

  const [metrics, setMetrics] = useState<DashboardMetric[]>([]);
  const [newsPosts, setNewsPosts] = useState<NewsPostRecord[]>([]);
  const [activityEvents, setActivityEvents] = useState<ActivityEventRow[]>([]);
  const [spotlights, setSpotlights] = useState<PartnerSpotlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      // Only load deals/customers if user has deal access (approved status)
      const hasDealAccess = access.canAccessDeals;

      let dealQuery = hasDealAccess
        ? supabase
            .from("portal_deals")
            .select("id, stage, status, country")
            .order("updated_at", { ascending: false })
        : null;
      let customerQuery = hasDealAccess
        ? supabase.from("portal_customers").select("id, country")
        : null;
      let partnerQuery = supabase
        .from("partners")
        .select(
          "id, company_name, tier, status, annual_turnover, business_focus, created_at, country",
        )
        .order("created_at", { ascending: false });
      let notificationQuery = supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false });
      let rewardQuery = supabase
        .from("reward_point_events")
        .select("id, user_id, partner_id, points_delta, reason, created_at")
        .order("created_at", { ascending: false });

      if (dealQuery) {
        dealQuery = applyPartnerScope(dealQuery, {
          isSuperAdmin: hasRole("super_admin"),
          partnerId: profile?.partner_id ?? null,
          userId: profile?.id ?? null,
        });
      }
      if (customerQuery) {
        customerQuery = applyPartnerScope(customerQuery, {
          isSuperAdmin: hasRole("super_admin"),
          partnerId: profile?.partner_id ?? null,
          userId: profile?.id ?? null,
        });
      }
      notificationQuery = applyPartnerScope(notificationQuery, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
      });
      rewardQuery = applyPartnerScope(rewardQuery, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
      });
      if (!hasRole("super_admin") && profile?.partner_id) {
        partnerQuery = partnerQuery.eq("id", profile.partner_id);
      } else if (!hasRole("super_admin") && profile?.id) {
        partnerQuery = partnerQuery.eq("owner_user_id", profile.id);
      }

      const pipelinePromise = hasDealAccess
        ? loadDashboardPipeline(selectedRegion)
        : Promise.resolve({
            ok: true as const,
            metrics: { pipelineValueUsd: 0, openDealCount: 0, missingDtpCount: 0 },
          });

      const [
        dealsRes,
        customersRes,
        partnersRes,
        newsRes,
        notifRes,
        rewardRes,
        collaboratorRes,
        activityRes,
        pipelineRes,
      ] = await Promise.allSettled([
        dealQuery ?? Promise.resolve({ data: [], error: null }),
        customerQuery ?? Promise.resolve({ data: [], error: null }),
        partnerQuery,
        supabase.from("portal_news_posts").select("*").order("created_at", { ascending: false }),
        notificationQuery,
        rewardQuery,
        supabase.from("portal_deal_collaborators").select("deal_id, user_id"),
        supabase
          .from("domain_activity_events")
          .select("id, subject_type, subject_id, event_name, payload, created_at")
          .order("created_at", { ascending: false })
          .limit(30),
        pipelinePromise,
      ]);

      const dealResult =
        dealsRes.status === "fulfilled" ? dealsRes.value : { data: [], error: dealsRes.reason };
      const customerResult =
        customersRes.status === "fulfilled"
          ? customersRes.value
          : { data: [], error: customersRes.reason };
      const partnerResult =
        partnersRes.status === "fulfilled"
          ? partnersRes.value
          : { data: [], error: partnersRes.reason };
      const newsResult =
        newsRes.status === "fulfilled" ? newsRes.value : { data: [], error: newsRes.reason };
      const notifResult =
        notifRes.status === "fulfilled" ? notifRes.value : { data: [], error: notifRes.reason };
      const rewardResult =
        rewardRes.status === "fulfilled" ? rewardRes.value : { data: [], error: rewardRes.reason };
      const collaboratorResult =
        collaboratorRes.status === "fulfilled"
          ? collaboratorRes.value
          : { data: [], error: collaboratorRes.reason };
      const activityResult =
        activityRes.status === "fulfilled"
          ? activityRes.value
          : { data: [], error: activityRes.reason };
      const pipelineResult =
        pipelineRes.status === "fulfilled"
          ? pipelineRes.value
          : {
              ok: false as const,
              code: "QUERY_FAILED" as const,
              message: "Pipeline metrics could not be loaded",
            };

      const partialFailures = [
        dealResult.error,
        customerResult.error,
        partnerResult.error,
        newsResult.error,
        notifResult.error,
        rewardResult.error,
        collaboratorResult.error,
        pipelineResult.ok ? null : pipelineResult.message,
      ].filter(Boolean);
      if (partialFailures.length > 0) {
        console.error("Dashboard load encountered partial failures", partialFailures);
      }

      const collaboratorIdsByDeal = groupCollaboratorIdsByDeal(
        (collaboratorResult.data as Array<{ deal_id: string; user_id: string }> | null) ?? [],
      );
      const dealRows = filterVisibleDeals(
        (
          (dealResult.data as Array<{
            id: string;
            amount: string;
            amount_usd?: number | null;
            stage: string;
            status: string;
            user_id: string | null;
            is_hidden_to_team: boolean;
            country?: string | null;
          }> | null) ?? []
        ).map((deal) => ({
          ...deal,
          is_hidden_to_team: Boolean(deal.is_hidden_to_team),
        })),
        collaboratorIdsByDeal,
        {
          viewerUserId: profile?.id ?? null,
          viewerRole: hasRole("super_admin")
            ? "super_admin"
            : hasRole("partner_admin")
              ? "partner_admin"
              : "partner_user",
          isSuperAdmin: hasRole("super_admin"),
          isPartnerAdmin: hasRole("partner_admin"),
        },
      );
      const customerRows =
        (customerResult.data as Array<{ id: string; country?: string | null }> | null) ?? [];
      const partnerRows = (partnerResult.data as PartnerSpotlight[] | null) ?? [];
      const regionFilteredDealRows = dealRows.filter((deal) =>
        matchesSelectedRegion(deal.country, selectedRegion),
      );
      const regionFilteredCustomerRows = customerRows.filter((customer) =>
        matchesSelectedRegion(customer.country, selectedRegion),
      );
      const regionFilteredPartnerRows = partnerRows.filter((partner) =>
        matchesSelectedRegion(partner.country, selectedRegion),
      );
      // Audience targeting is enforced here, not merely displayed in admin:
      // a post aimed at India + one partner must not reach anyone else, or the
      // tags on the publish form would be decoration.
      //
      // partnerRows is already scoped to the viewer's own partner for
      // non-admins (see partnerQuery above), so [0] is that partner.
      const newsRows = filterNewsPostsForViewer(
        (newsResult.data as NewsPostRecord[] | null) ?? [],
        resolveNewsViewer({
          partnerId: profile?.partner_id ?? partnerRows[0]?.id ?? null,
          partnerCountry: partnerRows[0]?.country ?? null,
        }),
        { isSuperAdmin: hasRole("super_admin") },
      );
      const notifRows = (notifResult.data as NotificationFeedRow[] | null) ?? [];
      const rewardRows =
        (rewardResult.data as Array<{
          id: string;
          user_id: string | null;
          partner_id: string | null;
          points_delta: number;
          reason: string;
          created_at: string;
        }> | null) ?? [];
      const activityRows = (activityResult.data as ActivityEventRow[] | null) ?? [];
      const rewardPoints = sumRewardPoints(rewardRows);
      const rewardTier = rewardTierForPoints(rewardPoints);
      const rewardProgressState = rewardProgress(rewardPoints);

      // Merge system notifications into activity feed, keep editorial news separate
      const mergedActivity: ActivityEventRow[] = [
        ...activityRows,
        ...notifRows.map((n) => ({
          id: n.id,
          subject_type: "notification",
          subject_id: n.id,
          event_name: n.title,
          payload: { message: n.message } as Record<string, unknown>,
          created_at: n.created_at,
        })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const pipelineMetric = pipelineResult.ok ? pipelineResult.metrics : null;
      const openDeals = regionFilteredDealRows.filter(
        (deal) => !["won", "lost"].includes(deal.stage),
      ).length;
      const wonDeals = regionFilteredDealRows.filter((deal) => deal.stage === "won").length;
      const approvedPartners = regionFilteredPartnerRows.filter(
        (partner) => partner.status === "approved",
      ).length;
      const totalFocusAreas = regionFilteredPartnerRows.reduce(
        (sum, partner) => sum + (partner.business_focus?.length ?? 0),
        0,
      );

      const pipelineDashboardMetric: DashboardMetric = {
        id: "pipeline",
        label: "Pipeline value",
        value: pipelineMetric
          ? `$${pipelineMetric.pipelineValueUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
          : "Unavailable",
        hint: pipelineMetric
          ? pipelineMetric.missingDtpCount > 0
            ? `Open opportunities at current DTP · ${pipelineMetric.missingDtpCount} missing DTP`
            : "Open opportunities at current DTP"
          : "Unable to load scoped Pipeline",
        tone: pipelineMetric ? "brand" : "warning",
      };

      // Build metrics based on access level
      const fullMetrics: DashboardMetric[] = [
        pipelineDashboardMetric,
        {
          id: "deals",
          label: "Open deals",
          value: String(openDeals),
          hint: `${wonDeals} won in this cycle`,
          tone: "success",
        },
        {
          id: "partners",
          label: "Approved partners",
          value: String(approvedPartners),
          hint: "Ready for active collaboration",
          tone: "warning",
        },
        {
          id: "customers",
          label: "Customers",
          value: String(regionFilteredCustomerRows.length),
          hint: `${totalFocusAreas} focus areas mapped`,
          tone: "neutral",
        },
        {
          id: "rewards",
          label: "Reward points",
          value: String(rewardPoints),
          hint: `${rewardTier} tier · ${rewardProgressState.pointsToNext} to next`,
          tone: "success",
        },
      ];

      const partialMetrics: DashboardMetric[] = [
        {
          id: "rewards",
          label: "Reward Points",
          value: String(rewardPoints),
          hint: `${rewardTier} tier · ${rewardProgressState.pointsToNext} to next`,
          tone: "success",
        },
        {
          id: "news",
          label: "News Posts",
          value: String(newsRows.length),
          hint: "Latest LIVEY updates",
          tone: "neutral",
        },
        {
          id: "profile",
          label: "Profile Status",
          value: getStatusLabel(status),
          hint: `${getStatusProgress(status)}% complete`,
          tone: "brand",
        },
      ];

      setMetrics(access.canAccessDeals ? fullMetrics : partialMetrics);
      setNewsPosts(newsRows);
      setActivityEvents(mergedActivity);
      setSpotlights(regionFilteredPartnerRows.slice(0, 3));
      setSource(
        dealRows.length ||
          customerRows.length ||
          partnerRows.length ||
          newsRows.length ||
          mergedActivity.length ||
          rewardRows.length
          ? "database"
          : "empty",
      );
    } catch {
      setMetrics([]);
      setNewsPosts([]);
      setSpotlights([]);
      setSource("empty");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [access.canAccessDeals, hasRole, profile?.id, profile?.partner_id, status, selectedRegion]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const feedEmpty = newsPosts.length === 0;
  const activityEmpty = activityEvents.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${roleLabel} · Overview`}
        icon={<Activity className="h-3.5 w-3.5" />}
        title={`Welcome back, ${profile?.full_name?.split(" ")[0] ?? "Partner"}`}
        description={`Here's what's happening across ${profile?.company_name ?? "your workspace"} today.`}
        actions={
          <>
            <Badge tone={source === "database" ? "success" : "neutral"} className="gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              {source === "database" ? "Live Postgres data" : "Empty state"}
            </Badge>
            {hasRole("super_admin") && (
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/news">
                  <Megaphone className="mr-2 h-4 w-4" />
                  Publish news
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRefreshing(true);
                void loadDashboard();
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
          </>
        }
      />

      {(access.isPartialApproval || access.isPendingAgreement || access.isSignedPendingReview) && (
        <Card className="border-warning/50">
          <CardContent className="flex flex-wrap items-center gap-4 p-5">
            <span className="tint-warning flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-warning-foreground">
              <AlertCircle className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {access.isSignedPendingReview
                  ? "Agreement Under Review"
                  : "Partner Agreement Required"}
              </p>
              <p className="text-[13px] text-muted-foreground">
                {access.isPartialApproval &&
                  "Your partner profile has been partially approved. Open the agreement page to sign with Zoho Sign."}
                {access.isPendingAgreement &&
                  "Your Zoho Sign agreement is ready. Open the agreement page to launch the sign button."}
                {access.isSignedPendingReview &&
                  "Zoho Sign has completed the signature. The super admin is reviewing the signed agreement before granting full access."}
              </p>
            </div>
            {!access.isSignedPendingReview && (
              <Button asChild variant="default" size="sm">
                <Link to="/partner/agreement">{getAgreementCtaLabel(status)}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div
        className={
          metrics.length > 3
            ? "grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5"
            : "grid grid-cols-2 gap-4 lg:grid-cols-3"
        }
      >
        {metrics.length > 0 ? (
          metrics.map((metric) => {
            const destination = getDashboardMetricDestination(metric.id, hasRole("super_admin"));
            const MetricIcon = iconForMetric(metric.label);
            const tile = (
              <StatTile
                label={metric.label}
                value={metric.value}
                hint={metric.hint}
                icon={<MetricIcon className="h-4 w-4" />}
                tone={metric.tone}
                className={
                  destination
                    ? "h-full transition-colors hover:border-ring/40 hover:bg-secondary/40"
                    : "h-full"
                }
              />
            );

            return destination ? (
              <Link key={metric.id} to={destination} className="block">
                {tile}
              </Link>
            ) : (
              <div key={metric.id}>{tile}</div>
            );
          })
        ) : (
          <Card className="col-span-2 lg:col-span-3">
            <CardContent className="p-0">
              <EmptyState
                icon={<Activity className="h-5 w-5" />}
                title="No workspace data yet"
                description="Create partners, customers, or deals to populate the overview."
              />
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle>Feed</CardTitle>
                <CardDescription>
                  LIVEY editorial updates and system activity events.
                </CardDescription>
              </div>
              <Badge tone="success" className="gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Live
              </Badge>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="news">
                <TabsList className="mb-4">
                  <TabsTrigger value="news">News</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                </TabsList>
                <TabsContent value="news">
                  {feedEmpty ? (
                    <EmptyState
                      icon={<Megaphone className="h-5 w-5" />}
                      title="No news posts yet"
                      description="LIVEY admins can publish photo updates from the admin news page."
                      action={
                        hasRole("super_admin") ? (
                          <Button asChild size="sm">
                            <Link to="/admin/news">Publish news</Link>
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <ScrollArea className="h-[28rem] pr-4">
                      <div className="space-y-4">
                        {newsPosts.map((post, index) => (
                          <div key={post.id}>
                            <NewsFeedCard post={post} />
                            {index < newsPosts.length - 1 && <Separator className="my-4" />}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </TabsContent>
                <TabsContent value="activity">
                  {activityEmpty ? (
                    <EmptyState
                      icon={<Activity className="h-5 w-5" />}
                      title="No activity events yet"
                      description="System events land here as records change across the workspace."
                    />
                  ) : (
                    <ScrollArea className="h-[28rem] pr-4">
                      <div className="divide-y">
                        {activityEvents.map((event) => (
                          <div key={event.id} className="flex items-start gap-3 py-2.5">
                            <div className="tint-brand mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-primary">
                              <Activity className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] font-medium">
                                {event.event_name
                                  .replace(/_/g, " ")
                                  .replace(/^./, (c) => c.toUpperCase())}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {event.subject_type} &middot; {formatDateLabel(event.created_at)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Partner spotlight</CardTitle>
              <CardDescription>Active partner records in the live workspace.</CardDescription>
            </CardHeader>
            <CardContent className={spotlights.length > 0 ? "space-y-3" : "p-0"}>
              {spotlights.length > 0 ? (
                spotlights.map((partner) => <SpotlightRow key={partner.id} partner={partner} />)
              ) : (
                <EmptyState
                  icon={<Building2 className="h-5 w-5" />}
                  title="No partner spotlight rows yet"
                  description="Approved partner records appear here as they join the workspace."
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Your profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {profile?.full_name
                      ?.split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase() ?? "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{profile?.full_name}</div>
                  <div className="truncate text-xs text-muted-foreground">{profile?.email}</div>
                </div>
              </div>
              <Separator />
              <Row label="Company" value={profile?.company_name ?? "—"} />
              <Row label="Phone" value={profile?.phone ?? "—"} />
              <Row label="Role" value={roleLabel} />
              <Row label="Status" value={getStatusLabel(status)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {access.canAccessDeals && (
                <>
                  <QuickAction to="/deals" icon={Handshake} label="Register a deal" />
                  <QuickAction to="/pipeline" icon={Sparkles} label="Open pipeline" />
                  <QuickAction to="/customers" icon={Users} label="Reserve a customer" />
                  <QuickAction to="/analytics" icon={BarChart3} label="View analytics" />
                </>
              )}
              {access.canAccessRewards && (
                <QuickAction to="/rewards" icon={Trophy} label="View rewards" />
              )}
              {access.canAccessDealDocuments && (
                <QuickAction to="/deal-documents" icon={FileText} label="Deal documents" />
              )}
              {hasRole("partner_admin") && (
                <QuickAction to="/partner/onboarding" icon={Building2} label="Partner onboarding" />
              )}
              {hasRole("super_admin") && (
                <QuickAction to="/admin/news" icon={Megaphone} label="Publish news" />
              )}
              {access.canAccessSettings && (
                <QuickAction to="/settings" icon={FileText} label="Settings" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-4 w-4" /> Getting started
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-[13px]">
              <Step done label="Create your account" />
              {hasRole("partner_admin") ? (
                <>
                  <Step
                    done={
                      access.isPartialApproval ||
                      access.isPendingAgreement ||
                      access.isSignedPendingReview ||
                      access.isApproved
                    }
                    label="Submit partner registration"
                  />
                  <Step
                    done={
                      access.isPartialApproval ||
                      access.isPendingAgreement ||
                      access.isSignedPendingReview ||
                      access.isApproved
                    }
                    label="LIVEY partial approval"
                  />
                  <Step
                    done={
                      access.isPendingAgreement || access.isSignedPendingReview || access.isApproved
                    }
                    label="Sign agreement"
                  />
                  <Step done={access.isApproved} label="Full approval" />
                </>
              ) : (
                <>
                  <Step done label="Partner admin setup" />
                  <Step done label="Workspace access granted" />
                </>
              )}
              <Step label="Register your first deal" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function partnerStatusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  const normalized = status.toLowerCase();
  if (normalized.includes("approved") && !normalized.includes("partial")) return "success";
  if (normalized.includes("rejected") || normalized.includes("suspended")) return "danger";
  if (
    normalized.includes("pending") ||
    normalized.includes("partial") ||
    normalized.includes("review")
  )
    return "warning";
  return "neutral";
}

function SpotlightRow({ partner }: { partner: PartnerSpotlight }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-medium">{partner.company_name}</div>
            <Badge variant="outline" className="capitalize">
              {partner.tier}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            {partner.annual_turnover ?? "Turnover not set"}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={partnerStatusTone(partner.status)} className="capitalize">
            {partner.status}
          </Badge>
          <div className="text-xs text-muted-foreground">{formatDateLabel(partner.created_at)}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(partner.business_focus ?? []).slice(0, 3).map((focus) => (
          <Badge key={focus} variant="outline">
            {focus}
          </Badge>
        ))}
        {(partner.business_focus ?? []).length === 0 && (
          <span className="text-xs text-muted-foreground">No focus areas yet.</span>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[60%] truncate text-right font-medium">{value}</span>
    </div>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-11 items-center justify-between rounded-md border bg-card px-3 py-2 text-[13px] transition-colors hover:border-ring/40 hover:bg-secondary lg:min-h-0"
    >
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
    </Link>
  );
}

function Step({ label, done }: { label: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
          done ? "bg-success text-success-foreground" : "bg-secondary text-muted-foreground"
        }`}
      >
        {done ? <CheckCircle2 className="h-3 w-3" /> : "•"}
      </div>
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

function iconForMetric(label: string) {
  switch (label) {
    case "Pipeline value":
      return Sparkles;
    case "Open deals":
      return Handshake;
    case "Approved partners":
      return Trophy;
    case "Customers":
      return Users;
    case "Reward points":
    case "Reward Points":
      return Trophy;
    case "News Posts":
      return Megaphone;
    case "Profile Status":
      return Building2;
    default:
      return Activity;
  }
}
