import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Handshake,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/local/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DEMO_FEED_ITEMS,
  DEMO_METRICS,
  DEMO_PARTNER_SPOTLIGHTS,
  type DemoFeedItem,
  type DemoMetric,
  type DemoPartnerSpotlight,
} from "@/lib/demo-content";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { profile, roles, hasRole } = useAuth();
  const status = profile?.partner_status ?? "pending_partner_registration";
  const isPending = status === "pending_partner_registration";
  const roleLabel = roles.includes("super_admin")
    ? "Super Admin"
    : roles.includes("partner_admin")
      ? "Partner Admin"
      : "Partner User";

  const [metrics, setMetrics] = useState<DemoMetric[]>([]);
  const [feedItems, setFeedItems] = useState<DemoFeedItem[]>([]);
  const [spotlights, setSpotlights] = useState<DemoPartnerSpotlight[]>([]);
  const [demoSource, setDemoSource] = useState<"database" | "fallback" | "empty">("empty");
  const [loadingDemo, setLoadingDemo] = useState(true);
  const [refreshingDemo, setRefreshingDemo] = useState(false);
  const [clearingDemo, setClearingDemo] = useState(false);

  const loadDemoContent = async () => {
    setLoadingDemo(true);
    try {
      const [metricsRes, feedRes, spotlightRes] = await Promise.all([
        supabase.from("portal_demo_metrics").select("*").order("sort_order", { ascending: true }),
        supabase
          .from("portal_demo_feed_items")
          .select("*")
          .order("sort_order", { ascending: true }),
        supabase
          .from("portal_demo_partner_spotlights")
          .select("*")
          .order("sort_order", { ascending: true }),
      ]);

      if (metricsRes.error || feedRes.error || spotlightRes.error) {
        throw metricsRes.error ?? feedRes.error ?? spotlightRes.error;
      }

      setMetrics((metricsRes.data as DemoMetric[] | null) ?? []);
      setFeedItems((feedRes.data as DemoFeedItem[] | null) ?? []);
      setSpotlights((spotlightRes.data as DemoPartnerSpotlight[] | null) ?? []);
      setDemoSource("database");
    } catch {
      setMetrics(DEMO_METRICS);
      setFeedItems(DEMO_FEED_ITEMS);
      setSpotlights(DEMO_PARTNER_SPOTLIGHTS);
      setDemoSource("fallback");
    } finally {
      setLoadingDemo(false);
      setRefreshingDemo(false);
    }
  };

  useEffect(() => {
    void loadDemoContent();
  }, []);

  const hasSeededDemoData = useMemo(() => demoSource === "database", [demoSource]);

  const effectiveMetrics = demoSource === "fallback" ? DEMO_METRICS : metrics;
  const effectiveFeedItems = demoSource === "fallback" ? DEMO_FEED_ITEMS : feedItems;
  const effectiveSpotlights = demoSource === "fallback" ? DEMO_PARTNER_SPOTLIGHTS : spotlights;

  const clearSeededDemoData = async () => {
    setClearingDemo(true);
    try {
      const results = await Promise.all([
        supabase.from("password_reset_tokens").delete(),
        supabase.from("document_blobs").delete().eq("is_seed", true),
        supabase.from("partner_review_notes").delete().eq("is_seed", true),
        supabase.from("partner_documents").delete().eq("is_seed", true),
        supabase.from("partners").delete().eq("is_seed", true),
        supabase.from("user_roles").delete().eq("is_seed", true),
        supabase.from("profiles").delete().eq("is_seed", true),
        supabase.from("portal_demo_metrics").delete().eq("is_seed", true),
        supabase.from("portal_demo_feed_items").delete().eq("is_seed", true),
        supabase.from("portal_demo_partner_spotlights").delete().eq("is_seed", true),
      ]);

      const error = results.find((result) => result.error)?.error ?? null;
      if (error) throw error;

      toast.success("Seeded demo data cleared");
      await loadDemoContent();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to clear demo data";
      toast.error(msg);
    } finally {
      setClearingDemo(false);
    }
  };

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
            Demo content
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRefreshingDemo(true);
              void loadDemoContent();
            }}
            disabled={loadingDemo || refreshingDemo}
          >
            {loadingDemo || refreshingDemo ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      {isPending && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="text-base font-medium">Complete your partner registration</div>
              <div className="text-sm text-muted-foreground">
                Step 2 of 2 — submit your business details and documents to unlock deal
                registration, pipeline, and tier benefits.
              </div>
              <div className="mt-3 flex items-center gap-3">
                <Progress value={50} className="h-1.5 w-48" />
                <span className="text-xs text-muted-foreground">50% complete</span>
              </div>
            </div>
            <Button asChild>
              <Link to="/partner/onboarding">
                Continue registration
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {effectiveMetrics.length > 0 ? (
          effectiveMetrics.map((metric) => (
            <Kpi
              key={metric.id}
              label={metric.label}
              value={metric.value}
              hint={metric.hint}
              icon={iconForMetric(metric.label)}
              tone={metric.tone}
            />
          ))
        ) : (
          <Card className="sm:col-span-2 xl:col-span-3">
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div>
                <div className="text-sm font-medium">No seeded metrics remain</div>
                <div className="text-xs text-muted-foreground">
                  Run the seed script again to repopulate the dashboard cards.
                </div>
              </div>
              <Badge variant="outline">Empty</Badge>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base">Activity feed</CardTitle>
                <CardDescription>Real-time updates across your partnership</CardDescription>
              </div>
              <Badge variant="secondary" className="gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                Live
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {effectiveFeedItems.length > 0 ? (
                effectiveFeedItems.map((item, index) => (
                  <div key={item.id}>
                    <FeedItem item={item} />
                    {index < effectiveFeedItems.length - 1 && <Separator className="my-4" />}
                  </div>
                ))
              ) : demoSource === "database" ? (
                <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  No feed items remain. Use the seeded reset file to repopulate demo content.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Partner spotlight</CardTitle>
              <CardDescription>
                A few seeded accounts and their current pipeline pulse.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {effectiveSpotlights.length > 0 ? (
                effectiveSpotlights.map((partner) => (
                  <SpotlightRow key={partner.id} partner={partner} />
                ))
              ) : demoSource === "database" ? (
                <div className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  No partner spotlights remain after cleanup.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
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
              <Row label="Status" value={statusLabel[status]} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <QuickAction to="/partner/onboarding" icon={Building2} label="Partner onboarding" />
              <QuickAction to="/deals" icon={Handshake} label="Register a deal" />
              <QuickAction to="/customers" icon={Users} label="Reserve a customer" />
              <QuickAction to="/documents" icon={FileText} label="Upload documents" />
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
              <Step label="Submit partner registration" />
              <Step label="LIVEY approval" />
              <Step label="Register your first deal" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Demo controls</CardTitle>
              <CardDescription>
                Seeded data can be cleared without touching the schema.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {hasSeededDemoData
                  ? "The current feed is coming from seeded rows in Postgres."
                  : demoSource === "fallback"
                    ? "Fallback demo content is shown because the demo tables are not available yet."
                    : "The seeded demo rows have been cleared."}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void clearSeededDemoData()}
                  disabled={!hasSeededDemoData || !hasRole("super_admin") || clearingDemo}
                >
                  {clearingDemo ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Clear seeded demo rows
                </Button>
                {!hasRole("super_admin") && <Badge variant="outline">Super Admin only</Badge>}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

const statusLabel: Record<string, string> = {
  pending_partner_registration: "Partner Registration Pending",
  submitted: "Application Submitted",
  under_review: "Under Review",
  need_more_info: "Info Requested",
  approved: "Approved",
  rejected: "Rejected",
};

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
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

  return (
    <Card>
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
}

function FeedItem({ item }: { item: DemoFeedItem }) {
  const Icon = iconForFeed(item.tone);
  const toneClass = {
    info: "bg-info/15 text-info",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
    primary: "bg-primary/10 text-primary",
    default: "bg-muted text-foreground",
  }[item.tone];

  return (
    <div className="flex gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-sm font-medium">{item.title}</div>
          <div className="whitespace-nowrap text-xs text-muted-foreground">{item.time_label}</div>
        </div>
        <div className="text-sm text-muted-foreground">{item.body}</div>
      </div>
    </div>
  );
}

function SpotlightRow({ partner }: { partner: DemoPartnerSpotlight }) {
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
            {partner.contact_name} · {partner.region}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium">{partner.pipeline_value}</div>
          <div className="text-xs text-muted-foreground">{partner.status}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>{partner.last_activity}</span>
        <span>Seeded account</span>
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

function iconForFeed(tone: DemoFeedItem["tone"]) {
  switch (tone) {
    case "success":
      return CheckCircle2;
    case "warning":
      return Trophy;
    case "info":
      return Users;
    case "primary":
      return Sparkles;
    default:
      return UserPlus;
  }
}

function iconForMetric(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("revenue") || normalized.includes("value")) return DollarSign;
  if (normalized.includes("deal")) return Handshake;
  if (normalized.includes("win")) return TrendingUp;
  if (normalized.includes("tier")) return Trophy;
  if (normalized.includes("avg")) return FileText;
  return Building2;
}
