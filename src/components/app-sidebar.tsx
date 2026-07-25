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
import { useAuth, type AppRole } from "@/hooks/use-auth";
import { BrandLogo } from "@/components/brand-logo";

type Item = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: AppRole[];
};

const workspace: Item[] = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Deals", url: "/deals", icon: Handshake },
  { title: "Pipeline", url: "/pipeline", icon: Kanban },
  { title: "Customers", url: "/customers", icon: Users },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "Documents", url: "/documents", icon: FileText },
];

const shared: Item[] = [{ title: "Rewards", url: "/rewards", icon: Trophy }];

const partnerAdmin: Item[] = [
  { title: "Company Profile", url: "/partner", icon: Building2, roles: ["partner_admin"] },
  { title: "Team", url: "/partner/team", icon: Users, roles: ["partner_admin"] },
];

const admin: Item[] = [
  { title: "Partner Approvals", url: "/admin/partners", icon: ShieldCheck, roles: ["super_admin"] },
  { title: "Deal Approvals", url: "/admin/deals", icon: Handshake, roles: ["super_admin"] },
  { title: "Users & Roles", url: "/admin/users", icon: Users, roles: ["super_admin"] },
  { title: "Tiers & Products", url: "/admin/catalog", icon: Sparkles, roles: ["super_admin"] },
  { title: "Rewards", url: "/admin/rewards", icon: Trophy, roles: ["super_admin"] },
  { title: "News Feed", url: "/admin/news", icon: Image, roles: ["super_admin"] },
  { title: "Audit Logs", url: "/admin/audit", icon: FileText, roles: ["super_admin"] },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { roles, hasRole, profile } = useAuth();

  const visible = (items: Item[]) =>
    items.filter((i) => !i.roles || i.roles.some((r) => roles.includes(r)));
  const isApprovedPartner = profile?.partner_status === "approved";
  const isPendingAgreement = profile?.partner_status === "pending_agreement";
  const canSeeWorkspace = hasRole("super_admin") || isApprovedPartner || isPendingAgreement;

  // Agreement page only visible to partners awaiting signature
  const partnerAdminItems: Item[] = [
    { title: "Company Profile", url: "/partner", icon: Building2, roles: ["partner_admin"] },
    { title: "Team", url: "/partner/team", icon: Users, roles: ["partner_admin"] },
    ...(isPendingAgreement
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

  const renderGroup = (label: string, items: Item[]) => {
    const list = visible(items);
    if (!list.length) return null;
    return (
      <SidebarGroup>
        {!collapsed && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
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
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sidebar-primary/10 ring-1 ring-sidebar-border/70">
            <BrandLogo variant="icon" className="h-7 w-7 rounded-md object-cover" />
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <BrandLogo variant="wordmark" className="h-5 w-auto max-w-[140px] object-contain" />
              <span className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
                Partner Portal
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {renderGroup("Rewards", visible(shared))}
        {!canSeeWorkspace && hasRole("partner_admin")
          ? renderGroup("Getting started", [
              { title: "Onboarding", url: "/partner/onboarding", icon: Building2 },
            ])
          : null}
        {canSeeWorkspace ? renderGroup("Workspace", workspace) : null}
        {canSeeWorkspace && hasRole("partner_admin")
          ? renderGroup("Company", partnerAdminItems)
          : null}
        {hasRole("super_admin") && renderGroup("Administration", admin)}
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
