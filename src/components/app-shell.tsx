import { type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, LogOut, Search, User } from "lucide-react";

import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AppSidebar } from "@/components/app-sidebar";
import { AgreementPendingBanner } from "@/components/agreement-pending-banner";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";
import { buildGlobalSearchResults } from "@/lib/global-search";
import type { GlobalSearchResult } from "@/lib/portal-records";

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

const statusTone: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  pending_partner_registration: "outline",
  submitted: "secondary",
  under_review: "secondary",
  need_more_info: "destructive",
  partial_approval: "secondary",
  pending_agreement: "secondary",
  signed_pending_review: "secondary",
  approved: "default",
  rejected: "destructive",
};

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, user, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
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
        setUnreadCount(Array.isArray(data) ? data.length : 0);
      }
    };
    void loadUnreadCount();
    return () => {
      active = false;
    };
  }, [profile?.id, profile?.partner_id, roles]);

  useEffect(() => {
    let active = true;
    const isSuperAdmin = roles.includes("super_admin");
    const trimmedQuery = searchQuery.trim();

    if (!isSuperAdmin || trimmedQuery.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return () => {
        active = false;
      };
    }

    setSearching(true);

    const timeoutId = window.setTimeout(() => {
      void Promise.all([
        supabase
          .from("portal_deals")
          .select("id, account_name, company_name, stage")
          .order("updated_at", { ascending: false }),
        supabase
          .from("partners")
          .select("id, company_name, status, tier")
          .order("updated_at", { ascending: false }),
        supabase
          .from("portal_catalog_items")
          .select("id, product_name, category, partner_tier")
          .order("updated_at", { ascending: false }),
      ])
        .then(([dealsRes, partnersRes, catalogRes]) => {
          if (!active) {
            return;
          }

          setSearchResults(
            buildGlobalSearchResults(trimmedQuery, {
              deals:
                (dealsRes.data as Array<{
                  id: string;
                  account_name: string;
                  company_name?: string | null;
                  stage: string;
                }> | null) ?? [],
              partners:
                (partnersRes.data as Array<{
                  id: string;
                  company_name: string;
                  status: string;
                  tier: string;
                }> | null) ?? [],
              catalogItems:
                (catalogRes.data as Array<{
                  id: string;
                  product_name: string;
                  category: string;
                  partner_tier: string;
                }> | null) ?? [],
            }),
          );
        })
        .finally(() => {
          if (active) {
            setSearching(false);
          }
        });
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [roles, searchQuery]);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth", replace: true });
  };

  const showSearchResults = roles.includes("super_admin") && searchQuery.trim().length >= 2;
  const selectSearchResult = (href: string) => {
    setSearchQuery("");
    setSearchResults([]);
    navigate({ to: href });
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger />
          <Popover open={showSearchResults}>
            <PopoverAnchor asChild>
              <div className="relative hidden md:flex flex-1 max-w-md">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={
                    roles.includes("super_admin")
                      ? "Search deals, partners, catalog..."
                      : "Search partners, deals, customers…"
                  }
                  className="pl-8 h-9 bg-muted/50 border-transparent focus-visible:bg-background"
                />
              </div>
            </PopoverAnchor>
            <PopoverContent align="start" className="hidden w-[420px] p-0 md:block">
              <Command shouldFilter={false}>
                <CommandList>
                  {searching ? (
                    <div className="px-4 py-3 text-sm text-muted-foreground">Searching…</div>
                  ) : (
                    <CommandEmpty>No matching deals, partners, or catalog items.</CommandEmpty>
                  )}
                  {searchResults.map((group) => (
                    <CommandGroup key={group.group} heading={group.group}>
                      {group.items.map((item) => (
                        <CommandItem key={item.id} value={`${group.group}-${item.id}`} onSelect={() => selectSearchResult(item.href)}>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{item.title}</span>
                            <span className="text-xs text-muted-foreground">{item.subtitle}</span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
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
