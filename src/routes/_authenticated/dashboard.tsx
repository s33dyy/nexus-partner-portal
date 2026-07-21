import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  DollarSign,
  FileText,
  Handshake,
  Sparkles,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { profile, roles } = useAuth();
  const status = profile?.partner_status ?? "pending_partner_registration";
  const isPending = status === "pending_partner_registration";
  const roleLabel = roles.includes("super_admin")
    ? "Super Admin"
    : roles.includes("partner_admin")
      ? "Partner Admin"
      : "Partner User";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
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

      {/* Onboarding banner */}
      {isPending && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col md:flex-row md:items-center gap-4 p-5">
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

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Pipeline value" value="$0" hint="Add your first deal" icon={DollarSign} tone="primary" />
        <Kpi label="Deals registered" value="0" hint="Standard + Strategic" icon={Handshake} />
        <Kpi label="Win rate" value="—" hint="Awaiting first close" icon={TrendingUp} tone="success" />
        <Kpi label="Tier status" value="Registered" hint="Silver unlocks at $50k" icon={Trophy} tone="warning" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Feed */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">Activity feed</CardTitle>
              <p className="text-xs text-muted-foreground">
                Real-time updates across your partnership
              </p>
            </div>
            <Badge variant="secondary" className="gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Live
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <FeedItem
              icon={UserPlus}
              tone="info"
              title="Welcome to LIVEY Partner Portal"
              body="Your account was created successfully. Complete Step 2 to activate deal registration."
              time="Just now"
            />
            <Separator />
            <FeedItem
              icon={FileText}
              tone="warning"
              title="Documents required"
              body="Upload GST, PAN, and Company Registration to move to LIVEY Review."
              time="Pending"
            />
            <Separator />
            <FeedItem
              icon={Sparkles}
              tone="primary"
              title="Tier program is live"
              body="Silver, Gold, and Platinum tiers unlock deeper margins, MDF, and priority support."
              time="Program update"
            />
            <Separator />
            <FeedItem
              icon={CheckCircle2}
              tone="success"
              title="Client-lock is protecting you"
              body="Reserved customers are exclusively yours during the opportunity lifecycle."
              time="How it works"
            />
          </CardContent>
        </Card>

        {/* Right rail */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {profile?.full_name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() ?? "U"}
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
  tone?: "default" | "primary" | "success" | "warning";
}) {
  const toneClass = {
    default: "bg-muted text-foreground",
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
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

function FeedItem({
  icon: Icon,
  tone,
  title,
  body,
  time,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "info" | "success" | "warning" | "primary";
  title: string;
  body: string;
  time: string;
}) {
  const toneClass = {
    info: "bg-info/15 text-info",
    success: "bg-success/15 text-success",
    warning: "bg-warning/20 text-warning-foreground",
    primary: "bg-primary/10 text-primary",
  }[tone];
  return (
    <div className="flex gap-3">
      <div className={`h-8 w-8 shrink-0 rounded-md flex items-center justify-center ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium truncate">{title}</div>
          <div className="text-xs text-muted-foreground whitespace-nowrap">{time}</div>
        </div>
        <div className="text-sm text-muted-foreground">{body}</div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium truncate max-w-[60%] text-right">{value}</span>
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
      className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm hover:border-primary/40 hover:bg-accent transition-colors"
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
        className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] ${
          done ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"
        }`}
      >
        {done ? <CheckCircle2 className="h-3 w-3" /> : "•"}
      </div>
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}
