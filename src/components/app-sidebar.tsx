import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Building2,
  Handshake,
  Users,
  Kanban,
  BarChart3,
  FileText,
  ShieldCheck,
  Bell,
  Settings,
  LifeBuoy,
  Image,
  Sparkles,
  Trophy,
  CheckSquare,
  GraduationCap,
  Activity,
  Boxes,
  ShieldQuestion,
  Phone,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  showDistributionNavigation,
  type DistributionAccess,
} from "@/components/distribution/distribution-navigation";
import { useAuth, type AppRole } from "@/hooks/use-auth";
import { BrandLogo } from "@/components/brand-logo";
import { usePartnerAccess } from "@/hooks/use-partner-access";

type Item = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: AppRole[];
};

const workspace: Item[] = [
  { title: "Deals", url: "/deals", icon: Handshake },
  { title: "Pipeline", url: "/pipeline", icon: Kanban },
  { title: "Tasks", url: "/tasks", icon: CheckSquare },
  { title: "Customers", url: "/customers", icon: Users },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Insight Hub", url: "/insight-hub", icon: GraduationCap },
];

/** Distribution sits beside Tasks. The two gates it needs live in
 * distribution-navigation.ts so the sidebar, the palette, Deals, and
 * Customers all read the same rule. */
function workspaceItemsFor(access: DistributionAccess): Item[] {
  if (!showDistributionNavigation(access)) return workspace;
  const items = [...workspace];
  items.splice(3, 0, { title: "Distribution", url: "/distribution", icon: Boxes });
  return items;
}

const portal: Item[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Deal Documents", url: "/deal-documents", icon: FileText },
];

const shared: Item[] = [{ title: "Rewards", url: "/rewards", icon: Trophy }];

const partnerAdmin: Item[] = [
  { title: "Company Profile", url: "/partner", icon: Building2, roles: ["partner_admin"] },
  { title: "Team", url: "/partner/team", icon: Users, roles: ["partner_admin"] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { roles, hasRole, profile, surfaces } = useAuth();
  const access = usePartnerAccess();

  const visible = (items: Item[]) =>
    items.filter((i) => !i.roles || i.roles.some((r) => roles.includes(r)));

  const { can } = useAuth();

  const isPartnerAdmin = hasRole("partner_admin");
  const canSeeWorkspace = access.canAccessDeals;
  const portalItems = [
    ...(access.canAccessDashboard ? [portal[0]] : []),
    ...(access.canAccessDealDocuments ? [portal[1]] : []),
  ];

  // Agreement page only visible to partners awaiting signature
  const partnerAdminItems: Item[] = [
    { title: "Company Profile", url: "/partner", icon: Building2, roles: ["partner_admin"] },
    { title: "Team", url: "/partner/team", icon: Users, roles: ["partner_admin"] },
    ...(access.canAccessPartnerAgreement || access.canAccessPartnerOnboarding
      ? [
          {
            title: "Sign Agreement",
            url: "/partner/agreement",
            icon: FileText,
            roles: ["partner_admin"] as AppRole[],
          },
        ]
      : []),
  ];

  const adminItems = [
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
    ...(can("rewards", "read") ? [{ title: "Rewards", url: "/admin/rewards", icon: Trophy }] : []),
    ...(can("news", "read") ? [{ title: "News Feed", url: "/admin/news", icon: Image }] : []),
    ...(can("learning", "read")
      ? [{ title: "Learning", url: "/admin/learning", icon: GraduationCap }]
      : []),
    // Two gates, both required: the role permission matrix says who *may*
    // see it, and the server-evaluated surface flag says whether the page is
    // real yet. The Integration Operations Centre is not, so this is absent
    // in every deployment until integration-operations-centre is enabled.
    ...(can("integrations", "read") && surfaces.integrationOperationsCentre
      ? [{ title: "Integrations", url: "/admin/integrations", icon: Activity }]
      : []),
    ...(can("audit", "read") ? [{ title: "Audit Logs", url: "/admin/audit", icon: FileText }] : []),
    ...(can("calls", "read") ? [{ title: "Calls", url: "/calls", icon: Phone }] : []),
  ];

  const renderGroup = (label: string, items: Item[]) => {
    const list = visible(items);
    if (!list.length) return null;
    return (
      <SidebarGroup>
        {!collapsed && (
          <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/45">
            {label}
          </SidebarGroupLabel>
        )}
        <SidebarGroupContent>
          <SidebarMenu>
            {list.map((item) => {
              const active = pathname === item.url || pathname.startsWith(item.url + "/");
              return (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border/60 px-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary/15 ring-1 ring-sidebar-border/60">
            <BrandLogo variant="icon" className="h-6 w-6 rounded object-cover" />
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-col leading-tight">
              <BrandLogo variant="wordmark" className="h-4 w-auto max-w-[130px] object-contain" />
              <span className="mt-0.5 text-[9px] uppercase tracking-[0.14em] text-sidebar-foreground/50">
                Partner Portal
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {access.canAccessRewards ? renderGroup("Rewards", visible(shared)) : null}
        {portalItems.length > 0 ? renderGroup("Portal", portalItems) : null}
        {!canSeeWorkspace && isPartnerAdmin
          ? renderGroup("Getting started", [
              { title: "Onboarding", url: "/partner/onboarding", icon: Building2 },
            ])
          : null}
        {canSeeWorkspace
          ? renderGroup(
              "Workspace",
              workspaceItemsFor({
                canRead: can("distribution", "read"),
                canCreate: can("distribution", "create"),
                surfaceEnabled: surfaces.distributionCore,
              }),
            )
          : null}
        {isPartnerAdmin &&
        (access.canAccessPartnerAgreement || access.canAccessPartnerOnboarding || canSeeWorkspace)
          ? renderGroup("Company", partnerAdminItems)
          : null}
        {adminItems.length > 0 && renderGroup("Administration", adminItems)}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Notifications">
              <Link to="/notifications" className="flex items-center gap-2">
                <Bell className="h-4 w-4" />
                {!collapsed && <span>Notifications</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Settings">
              <Link to="/settings" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                {!collapsed && <span>Settings</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Support">
              <Link to="/support" className="flex items-center gap-2">
                <LifeBuoy className="h-4 w-4" />
                {!collapsed && <span>Support</span>}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
