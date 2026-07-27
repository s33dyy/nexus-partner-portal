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
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { NewsFeedCard } from "@/components/news-feed-card";
import { formatDateLabel } from "@/lib/date-utils";
import { applyPartnerScope } from "@/lib/partner-scope";
import { filterVisibleDeals, groupCollaboratorIdsByDeal } from "@/lib/deal-visibility";
import { type NewsPostRecord } from "@/lib/portal-news-data";
import { rewardProgress, rewardTierForPoints, sumRewardPoints } from "@/lib/rewards";
import { getDashboardMetricDestination } from "@/lib/global-search";
import { getAgreementCtaLabel } from "@/routes/_authenticated/partner.agreement";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";
import { usePartnerAccess } from "@/hooks/use-partner-access";
import { getStatusLabel, getStatusProgress } from "@/lib/partner-status";

type PartnerSpotlight = {
  id: string;
  company_name: string;
  tier: string;
  status: string;
  annual_turnover: string | null;
  business_focus: string[] | null;
  created_at: string;
};

type NotificationFeedRow = {
  id: string;
  title: string;
  message: string;
  created_at: string;
};

type DashboardMetric = {
  id: string;
  label: string;
  value: string;
  hint: string;
  tone: "default" | "primary" | "success" | "warning" | "info";
};

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { profile, roles, hasRole } = useAuth();
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
            .select("id, amount, stage, status")
            .order("updated_at", { ascending: false })
        : null;
      let customerQuery = hasDealAccess ? supabase.from("portal_customers").select("id") : null;
      let partnerQuery = supabase
        .from("partners")
        .select("id, company_name, tier, status, annual_turnover, business_focus, created_at")
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

      const queries = [
        dealQuery,
        customerQuery,
        partnerQuery,
        supabase.from("portal_news_posts").select("*").order("created_at", { ascending: false }),
        notificationQuery,
        rewardQuery,
      ];

      const [dealsRes, customersRes, partnersRes, newsRes, notifRes, rewardRes, collaboratorRes] =
        await Promise.all([
          ...queries.map((q) => q ?? Promise.resolve({ data: [], error: null })),
          supabase.from("portal_deal_collaborators").select("deal_id, user_id"),
        ]);

      if (
        dealsRes.error ||
        customersRes.error ||
        partnersRes.error ||
        newsRes.error ||
        notifRes.error ||
        rewardRes.error ||
        collaboratorRes.error
      ) {
        throw (
          dealsRes.error ??
          customersRes.error ??
          partnersRes.error ??
          newsRes.error ??
          notifRes.error ??
          rewardRes.error ??
          collaboratorRes.error
        );
      }

      const collaboratorIdsByDeal = groupCollaboratorIdsByDeal(
        (collaboratorRes.data as Array<{ deal_id: string; user_id: string }> | null) ?? [],
      );
      const dealRows = filterVisibleDeals(
        (
          (dealsRes.data as Array<{
            id: string;
            amount: string;
            stage: string;
            status: string;
            user_id: string | null;
            is_hidden_to_team: boolean;
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
      const customerRows = (customersRes.data as Array<{ id: string }> | null) ?? [];
      const partnerRows = (partnersRes.data as PartnerSpotlight[] | null) ?? [];
      const newsRows = (newsRes.data as NewsPostRecord[] | null) ?? [];
      const notifRows = (notifRes.data as NotificationFeedRow[] | null) ?? [];
      const rewardRows =
        (rewardRes.data as Array<{
          id: string;
          user_id: string | null;
          partner_id: string | null;
          points_delta: number;
          reason: string;
          created_at: string;
        }> | null) ?? [];
      const rewardPoints = sumRewardPoints(rewardRows);
      const rewardTier = rewardTierForPoints(rewardPoints);
      const rewardProgressState = rewardProgress(rewardPoints);

      const combinedNews = [
        ...newsRows,
        ...notifRows.map((n) => ({
          id: n.id,
          title: n.title,
          caption: n.message,
          image_path: "",
          image_alt: "",
          posted_by_name: "System",
          posted_by_role: "Notification",
          created_at: n.created_at,
          updated_at: n.created_at,
          is_seed: false,
        })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const pipeline = dealRows.reduce((sum, deal) => {
        const value = Number.parseFloat(String(deal.amount).replace(/[^0-9.]/g, ""));
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);
      const openDeals = dealRows.filter((deal) => !["won", "lost"].includes(deal.stage)).length;
      const wonDeals = dealRows.filter((deal) => deal.stage === "won").length;
      const approvedPartners = partnerRows.filter(
        (partner) => partner.status === "approved",
      ).length;
      const totalFocusAreas = partnerRows.reduce(
        (sum, partner) => sum + (partner.business_focus?.length ?? 0),
        0,
      );

      // Build metrics based on access level
      const fullMetrics: DashboardMetric[] = [
        {
          id: "pipeline",
          label: "Pipeline value",
          value: `$${pipeline.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
          hint: "Across all live opportunity rows",
          tone: "primary",
        },
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
          value: String(customerRows.length),
          hint: `${totalFocusAreas} focus areas mapped`,
          tone: "info",
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
          value: String(combinedNews.length),
          hint: "Latest LIVEY updates",
          tone: "info",
        },
        {
          id: "profile",
          label: "Profile Status",
          value: getStatusLabel(status),
          hint: `${getStatusProgress(status)}% complete`,
          tone: "primary",
        },
      ];

      setMetrics(access.canAccessDeals ? fullMetrics : partialMetrics);
      setNewsPosts(combinedNews);
      setSpotlights(partnerRows.slice(0, 3));
      setSource(
        dealRows.length ||
          customerRows.length ||
          partnerRows.length ||
          combinedNews.length ||
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
  }, [access.canAccessDeals, hasRole, profile?.id, profile?.partner_id, status]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const feedEmpty = newsPosts.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Activity className="h-3 w-3" /> {roleLabel} · Overview
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome back, {profile?.full_name?.split(" ")[0] ?? "Partner"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Here's what's happening across {profile?.company_name ?? "your workspace"} today.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1">
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
        </div>
      </div>

      {(access.isPartialApproval || access.isPendingAgreement || access.isSignedPendingReview) && (
        <Card className="border-amber-500/40 bg-amber-500/5 mb-6">
          <CardContent className="flex items-center gap-4 p-4">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">
                {access.isSignedPendingReview
                  ? "Agreement Under Review"
                  : "Partner Agreement Required"}
              </p>
              <p className="text-sm text-muted-foreground">
                {access.isPartialApproval &&
                  "Your partner profile has been partially approved. Open the agreement page to sign with Zoho Sign."}
                {access.isPendingAgreement &&
                  "Your Zoho Sign agreement is ready. Open the agreement page to launch the sign button."}
                {access.isSignedPendingReview &&
                  "Zoho Sign has completed the signature. The super admin is reviewing the signed agreement before granting full access."}
              </p>
            </div>
            {!access.isSignedPendingReview && (
              <Button asChild variant="default">
                <Link to="/partner/agreement">{getAgreementCtaLabel(status)}</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.length > 0 ? (
          metrics.map((metric) => (
            <Kpi
              key={metric.id}
              to={getDashboardMetricDestination(metric.id, hasRole("super_admin"))}
              label={metric.label}
              value={metric.value}
              hint={metric.hint}
              icon={iconForMetric(metric.label)}
              tone={metric.tone}
            />
          ))
        ) : (
          <Card className="sm:col-span-2 xl:col-span-4">
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div>
                <div className="text-sm font-medium">No workspace data yet</div>
                <div className="text-xs text-muted-foreground">
                  Create partners, customers, or deals to populate the overview.
                </div>
              </div>
              <Badge variant="outline">Empty</Badge>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">News feed</CardTitle>
                <CardDescription>
                  LIVEY updates, with images when they exist and text-only cards when they do not.
                </CardDescription>
              </div>
              <Badge variant="secondary" className="gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Live
              </Badge>
            </CardHeader>
            <CardContent>
              {feedEmpty ? (
                <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  No news posts yet. LIVEY admins can publish photo updates from the admin news
                  page.
                </div>
              ) : (
                <ScrollArea className="h-[32rem] pr-4">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Partner spotlight</CardTitle>
              <CardDescription>Active partner records in the live workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {spotlights.length > 0 ? (
                spotlights.map((partner) => <SpotlightRow key={partner.id} partner={partner} />)
              ) : (
                <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  No partner spotlight rows yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your profile</CardTitle>
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
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick actions</CardTitle>
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
              {access.canAccessDocuments && (
                <QuickAction to="/documents" icon={FileText} label="Upload documents" />
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
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" /> Getting started
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
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

function Kpi({
  to,
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  to?: string | null;
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "primary" | "success" | "warning" | "info";
}) {
  const toneClass = {
    default: "bg-muted text-foreground",
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
    info: "bg-info/15 text-info",
  }[tone];

  const content = (
    <Card className={to ? "transition-colors hover:border-primary/40 hover:bg-accent/30" : undefined}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className={`rounded-md p-1.5 ${toneClass}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );

  if (!to) {
    return content;
  }

  return <Link to={to}>{content}</Link>;
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
        <div className="text-right">
          <div className="text-sm font-medium">{partner.status}</div>
          <div className="text-xs text-muted-foreground">{formatDateLabel(partner.created_at)}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(partner.business_focus ?? []).slice(0, 3).map((focus) => (
          <Badge key={focus} variant="secondary">
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
    <div className="flex items-center justify-between text-sm">
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
      className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-accent"
    >
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </span>
      <ArrowRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}

function Step({ label, done }: { label: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
          done ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"
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
      return Trophy;
    default:
      return Activity;
  }
}
