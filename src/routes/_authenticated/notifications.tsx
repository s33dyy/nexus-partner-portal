import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2, CheckCircle2 } from "lucide-react";

import { CsvExportButton } from "@/components/csv-export-button";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";
import { type CsvColumn } from "@/lib/csv-export";
import { formatDateTimeLabel } from "@/lib/date-utils";
import { applyPartnerScope } from "@/lib/partner-scope";

export const Route = createFileRoute("/_authenticated/notifications")({
  component: NotificationsPage,
});

type NotificationRecord = {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
};

const NOTIFICATION_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "title", header: "Title" },
  { key: "message", header: "Message" },
  { key: "type", header: "Type" },
  { key: "read", header: "Read" },
  { key: "created_at", header: "Created At" },
];

function NotificationsPage() {
  const { profile, hasRole } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false });

      query = applyPartnerScope(query, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
      });

      const { data, error } = await query;
      if (error) throw error;
      setNotifications(data as NotificationRecord[]);
    } catch (e) {
      console.error("Failed to load notifications", e);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [hasRole, profile?.id, profile?.partner_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const markAsRead = async (id: string) => {
    try {
      await supabase.from("notifications").update({ read: true }).eq("id", id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch (e) {
      console.error("Failed to mark as read", e);
    }
  };

  const markAllAsRead = async () => {
    try {
      let query = supabase.from("notifications").update({ read: true }).eq("read", false);
      query = applyPartnerScope(query, {
        isSuperAdmin: hasRole("super_admin"),
        partnerId: profile?.partner_id ?? null,
        userId: profile?.id ?? null,
      });
      await query;
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (e) {
      console.error("Failed to mark all as read", e);
    }
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Updates"
        icon={<Bell className="h-3.5 w-3.5" />}
        title="Notifications"
        description="Stay updated on partner approvals and important alerts."
        actions={
          <>
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={markAllAsRead}>
                Mark all as read
              </Button>
            )}
            <CsvExportButton
              label="Export CSV"
              filenameStem="livey-notifications"
              columns={NOTIFICATION_EXPORT_COLUMNS}
              loadRows={async () =>
                notifications.map((notification) => ({
                  title: notification.title,
                  message: notification.message,
                  type: notification.type,
                  read: notification.read,
                  created_at: notification.created_at,
                }))
              }
              variant="outline"
            />
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>
            You have {unreadCount} unread notification{unreadCount !== 1 && "s"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState
              icon={<Bell className="h-5 w-5" />}
              title="No notifications to show"
              description="Partner approvals and important alerts will land here as they happen."
            />
          ) : (
            <div className="divide-y">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex w-full items-start justify-between gap-4 px-5 py-4 transition ${
                    n.read ? "opacity-70 bg-background" : "bg-muted/10 font-medium"
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md tint-brand text-primary">
                      <Bell className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm">{n.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground break-words">
                        {n.message}
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {formatDateTimeLabel(n.created_at)}
                      </div>
                    </div>
                  </div>
                  {!n.read && (
                    <Button variant="ghost" size="sm" onClick={() => void markAsRead(n.id)}>
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Read
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
