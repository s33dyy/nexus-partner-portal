import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, LogOut, Search, User } from "lucide-react";

import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { AppSidebar } from "@/components/app-sidebar";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";

const statusLabel: Record<string, string> = {
  pending_partner_registration: "Partner Registration Pending",
  submitted: "Application Submitted",
  under_review: "Under Review",
  need_more_info: "Info Requested",
  approved: "Approved Partner",
  rejected: "Application Rejected",
};

const statusTone: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  pending_partner_registration: "outline",
  submitted: "secondary",
  under_review: "secondary",
  need_more_info: "destructive",
  approved: "default",
  rejected: "destructive",
};

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, user, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const initials =
    profile?.full_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ?? "U";

  const status = profile?.partner_status ?? "pending_partner_registration";

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
      if (roles.includes("super_admin")) {
        query = supabase.from("notifications").select("id, read").eq("read", false);
      }
      const { data } = await query;
      if (active) {
        setUnreadCount((data ?? []).length);
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

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger />
          <div className="relative hidden md:flex flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search partners, deals, customers…"
              className="pl-8 h-9 bg-muted/50 border-transparent focus-visible:bg-background"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant={statusTone[status]} className="hidden sm:inline-flex">
              {statusLabel[status]}
            </Badge>
            <Button asChild variant="ghost" size="icon" aria-label="Notifications">
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
                <Button variant="ghost" className="h-9 gap-2 px-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden md:inline text-sm font-medium">
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 lg:p-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
