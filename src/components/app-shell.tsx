import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AudioLines, Bell, ChevronDown, LogOut, RefreshCcw, ShieldCheck, User } from "lucide-react";

import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette, CommandPaletteHint } from "@/components/command-palette";
import { AssistantPanel } from "@/components/assistant-panel";
import { SoftphonePanel } from "@/components/softphone-panel";
import { DailyDigestDialog } from "@/components/daily-digest-dialog";
import { AgreementPendingBanner } from "@/components/agreement-pending-banner";
import { RegionFilterSelect } from "@/components/region-filter-select";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";
import { usePartnerAccess } from "@/hooks/use-partner-access";
import { buildShellContextSummary } from "@/components/app-shell.utils";
import { cn } from "@/lib/utils";

const statusLabel: Record<string, string> = {
  pending_partner_registration: "Partner Registration Pending",
  submitted: "Application Submitted",
  under_review: "Under Review",
  need_more_info: "Info Requested",
  partial_approval: "Partial Approval",
  pending_agreement: "Agreement Pending",
  signed_pending_review: "Signed - Awaiting Review",
  approved: "Approved Partner",
  rejected: "Application Rejected",
};

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium capitalize">{value}</dd>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, user, roles, activeContext, assignment, signOut, refresh, can } = useAuth();
  const access = usePartnerAccess();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const initials =
    profile?.full_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ?? "U";

  const status = profile?.partner_status ?? "pending_partner_registration";
  const contextSummary = buildShellContextSummary({ assignment, activeContext });
  const contextLabel = activeContext
    ? `${contextSummary.roleLabel}${activeContext.workingScope ? ` · ${contextSummary.scopeLabel}` : ""}`
    : contextSummary.title;

  useEffect(() => {
    let active = true;
    const loadUnreadCount = async () => {
      let query = supabase.from("notifications").select("id, read").eq("read", false);
      if (profile?.partner_id) {
        query = query.eq("partner_id", profile.partner_id);
      }
      if (profile?.id && !profile?.partner_id) {
        query = query.eq("user_id", profile.id);
      }
      if (access.isLiveyInternal) {
        query = supabase.from("notifications").select("id, read").eq("read", false);
      }
      const { data } = await query;
      if (active) {
        setUnreadCount(Array.isArray(data) ? data.length : 0);
      }
    };
    void loadUnreadCount();
    return () => {
      active = false;
    };
  }, [profile?.id, profile?.partner_id, roles]);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth", replace: true });
  };

  const isAgreementAttention =
    status === "partial_approval" ||
    status === "pending_agreement" ||
    status === "signed_pending_review";

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {isAgreementAttention && <AgreementPendingBanner />}
        {/*
          The governed-context readout used to be a bordered panel holding
          four badges and a wrapping description sentence, occupying most of
          the top bar on every screen. It is diagnostic information a user
          checks occasionally, not continuously — so it collapses to one chip
          that states the role and turns amber when something actually needs
          attention, with the full detail (scope, tenant, assignment status,
          and the explanatory copy) one click away in a popover.
        */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card px-3 sm:px-4">
          <SidebarTrigger className="shrink-0" />

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-live="polite"
                className={cn(
                  "flex h-11 min-w-0 shrink items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors hover:bg-secondary lg:h-auto",
                  contextSummary.state === "ready"
                    ? "border-border text-muted-foreground"
                    : "border-transparent tint-warning text-warning-foreground",
                )}
              >
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate capitalize">{contextLabel}</span>
                <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 space-y-3">
              <div>
                <p className="text-sm font-semibold capitalize">{contextSummary.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {contextSummary.description}
                </p>
              </div>
              <dl className="space-y-1.5 text-xs">
                <ContextRow label="Role" value={contextSummary.roleLabel} />
                <ContextRow label="Scope" value={contextSummary.scopeLabel} />
                <ContextRow label="Assignment" value={contextSummary.statusLabel} />
                {contextSummary.tenantLabel ? (
                  <ContextRow label="Tenant" value={contextSummary.tenantLabel} />
                ) : null}
              </dl>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => void refresh()}
              >
                <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                Refresh context
              </Button>
            </PopoverContent>
          </Popover>

          <CommandPaletteHint onClick={() => setPaletteOpen(true)} />

          {/* shrink-0: the children are fixed 44px tap targets, so letting this
              wrapper shrink does not shrink them — it just lets them spill past
              the right edge. The context chip to the left is the shrinkable
              one, and truncating a role label is the graceful degradation here.
              What makes shrink-0 affordable is that the optional chrome below
              is deferred to xl/2xl; revealing all of it at lg is what once made
              every page scroll sideways between 1024 and 1440. */}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {/* Region scoping is a desktop affordance — on a phone it ate a
                third of the bar. Reachable from the context popover instead.
                xl, not lg: at 1024-1279 the 256px rail is back but the window
                is not much wider, and this control plus the status badge were
                what tipped the header past the viewport. */}
            <div className="hidden shrink-0 xl:block">
              <RegionFilterSelect />
            </div>
            <Badge
              tone={
                status === "approved" ? "success" : status === "rejected" ? "danger" : "warning"
              }
              className="hidden shrink-0 2xl:inline-flex"
            >
              {statusLabel[status]}
            </Badge>
            <span className="mx-0.5 hidden h-5 w-px shrink-0 bg-border xl:block" />
            {/* Six 44px targets do not fit in a 375px header. The briefing is
                the one that moves: it opens itself once per slot anyway, so
                this button is only ever a manual re-open — and it stays
                reachable from the account menu below. */}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Open briefing"
              className="hidden shrink-0 lg:inline-flex 2xl:h-9 2xl:w-auto 2xl:gap-1.5 2xl:px-2"
              onClick={() => setDigestOpen(true)}
            >
              <AudioLines className="h-4 w-4" />
              <span className="hidden 2xl:inline">Briefing</span>
            </Button>
            <AssistantPanel open={assistantOpen} onOpenChange={setAssistantOpen} />
            {can("calls", "read") && <SoftphonePanel />}
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label="Notifications"
            >
              <Link to="/notifications" className="relative">
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-11 min-w-11 shrink-0 gap-2 px-1 sm:px-2 lg:h-9 lg:min-w-0"
                >
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-[14ch] truncate text-sm font-medium xl:inline">
                    {profile?.full_name ?? user?.email}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{profile?.full_name}</span>
                    <span className="text-xs text-muted-foreground">{user?.email}</span>
                    <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {roles.join(", ") || "no role"}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/settings">
                    <User className="mr-2 h-4 w-4" /> Profile & settings
                  </Link>
                </DropdownMenuItem>
                {/* Mirrors the header button, which is hidden below lg so the
                    remaining controls can each hold a 44px target. */}
                <DropdownMenuItem className="lg:hidden" onClick={() => setDigestOpen(true)}>
                  <AudioLines className="mr-2 h-4 w-4" /> Briefing
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 md:p-6">{children}</main>
      </SidebarInset>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <DailyDigestDialog
        open={digestOpen}
        onOpenChange={setDigestOpen}
        onOpenAssistant={() => setAssistantOpen(true)}
      />
    </SidebarProvider>
  );
}
