import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Boxes,
  Building2,
  CheckSquare,
  FileText,
  GraduationCap,
  Handshake,
  Image,
  Kanban,
  LayoutDashboard,
  LifeBuoy,
  Phone,
  Settings,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { showDistributionNavigation } from "@/components/distribution/distribution-navigation";
import { useAuth } from "@/hooks/use-auth";
import { usePartnerAccess } from "@/hooks/use-partner-access";

/**
 * ⌘K / Ctrl-K navigator.
 *
 * The blueprint deliberately removed the free-text *record* search from the
 * shell (§ the shell shows governed context, not an unscoped search box), and
 * this does not reintroduce it: it navigates to pages, never to records, so
 * there is no query hitting the database and nothing to scope.
 *
 * Entries are built from the same capability checks the sidebar uses
 * (`can(...)` and usePartnerAccess), so the palette can never offer a
 * destination the user would be bounced out of. Duplicating the nav list
 * without those checks is the obvious shortcut and would leak the shape of
 * the admin surface to every partner user who pressed ⌘K.
 */
type PaletteItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string;
};

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { can, hasRole, surfaces } = useAuth();
  const access = usePartnerAccess();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      // Don't steal the shortcut from a browser find-in-page inside an input.
      event.preventDefault();
      onOpenChange(!open);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const groups = useMemo(() => {
    const workspace: PaletteItem[] = [
      ...(access.canAccessDeals
        ? ([
            { title: "Deals", url: "/deals", icon: Handshake, keywords: "opportunities pipeline" },
            { title: "Pipeline", url: "/pipeline", icon: Kanban, keywords: "board kanban stages" },
            { title: "Tasks", url: "/tasks", icon: CheckSquare, keywords: "todo work items" },
            // Same rule as the sidebar, from the same shared helper.
            ...(showDistributionNavigation({
              canRead: can("distribution", "read"),
              canCreate: can("distribution", "create"),
              surfaceEnabled: surfaces.distributionCore,
            })
              ? [
                  {
                    title: "Distribution",
                    url: "/distribution",
                    icon: Boxes,
                    keywords: "stock inventory requests warehouse distributor",
                  },
                ]
              : []),
            { title: "Customers", url: "/customers", icon: Users, keywords: "accounts clients" },
            { title: "Analytics", url: "/analytics", icon: BarChart3, keywords: "reports charts" },
            {
              title: "Insight Hub",
              url: "/insight-hub",
              icon: GraduationCap,
              keywords: "learning training certification",
            },
          ] as PaletteItem[])
        : []),
    ];

    const portal: PaletteItem[] = [
      ...(access.canAccessDashboard
        ? [
            {
              title: "Dashboard",
              url: "/dashboard",
              icon: LayoutDashboard,
              keywords: "home overview",
            },
          ]
        : []),
      ...(access.canAccessDealDocuments
        ? [{ title: "Deal Documents", url: "/deal-documents", icon: FileText, keywords: "files" }]
        : []),
      ...(access.canAccessRewards
        ? [{ title: "Rewards", url: "/rewards", icon: Trophy, keywords: "points store redeem" }]
        : []),
    ];

    const company: PaletteItem[] = hasRole("partner_admin")
      ? [
          { title: "Company Profile", url: "/partner", icon: Building2 },
          { title: "Team", url: "/partner/team", icon: Users, keywords: "invite teammates" },
        ]
      : [];

    const administration: PaletteItem[] = [
      ...(can("partners", "read")
        ? [{ title: "Partner Approvals", url: "/admin/partners", icon: ShieldCheck }]
        : []),
      ...(can("deals", "read")
        ? [{ title: "Deal Approvals", url: "/admin/deals", icon: Handshake }]
        : []),
      ...(can("users", "read")
        ? [
            { title: "Users & Roles", url: "/admin/users", icon: Users },
            { title: "Role Permissions", url: "/admin/roles", icon: ShieldQuestion },
          ]
        : []),
      ...(can("catalog", "read")
        ? [{ title: "Product Catalog", url: "/admin/catalog", icon: Sparkles }]
        : []),
      ...(can("rewards", "read")
        ? [{ title: "Rewards Manager", url: "/admin/rewards", icon: Trophy }]
        : []),
      ...(can("news", "read") ? [{ title: "News Feed", url: "/admin/news", icon: Image }] : []),
      ...(can("learning", "read")
        ? [{ title: "Learning", url: "/admin/learning", icon: GraduationCap }]
        : []),
      ...(can("integrations", "read") && surfaces.integrationOperationsCentre
        ? [{ title: "Integrations", url: "/admin/integrations", icon: Activity }]
        : []),
      ...(can("audit", "read")
        ? [{ title: "Audit Logs", url: "/admin/audit", icon: FileText }]
        : []),
      ...(can("calls", "read") ? [{ title: "Calls", url: "/calls", icon: Phone }] : []),
    ];

    const account: PaletteItem[] = [
      { title: "Settings", url: "/settings", icon: Settings, keywords: "profile password exports" },
      { title: "Support", url: "/support", icon: LifeBuoy, keywords: "help tickets" },
    ];

    return [
      { heading: "Workspace", items: workspace },
      { heading: "Portal", items: portal },
      { heading: "Company", items: company },
      { heading: "Administration", items: administration },
      { heading: "Account", items: account },
    ].filter((group) => group.items.length > 0);
  }, [access, can, hasRole, surfaces]);

  const go = (url: string) => {
    onOpenChange(false);
    void navigate({ to: url });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to a page…" />
      <CommandList>
        <CommandEmpty>No matching page.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.items.map((item) => (
              <CommandItem
                key={item.url}
                value={`${item.title} ${item.keywords ?? ""}`}
                onSelect={() => go(item.url)}
              >
                <item.icon className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                {item.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

/** The header affordance that advertises the palette exists. */
export function CommandPaletteHint({ onClick }: { onClick: () => void }) {
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open the command palette"
      className="hidden items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary md:flex"
    >
      <span>Jump to…</span>
      <CommandShortcut className="ml-0">{isMac ? "⌘K" : "Ctrl K"}</CommandShortcut>
    </button>
  );
}
