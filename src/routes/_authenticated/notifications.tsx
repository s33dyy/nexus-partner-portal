import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2, CheckCircle2 } from "lucide-react";

import { CsvExportButton } from "@/components/csv-export-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCsvDate, type CsvColumn } from "@/lib/csv-export";
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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <Bell className="h-3.5 w-3.5" /> Updates
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Stay updated on partner approvals and important alerts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={markAllAsRead}>
              Mark all as read
            </Button>
          )}
          <CsvExportButton
            label="Export CSV"
            filename={`livey-notifications-${formatCsvDate()}.csv`}
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
        </div>
      </div>

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
            <div className="py-16 text-center text-sm text-muted-foreground">
              No notifications to show.
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex w-full items-start justify-between gap-4 px-6 py-4 transition ${
                    n.read ? "opacity-70 bg-background" : "bg-muted/10 font-medium"
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-9 w-9 mt-1 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Bell className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm">{n.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground break-words">
                        {n.message}
                      </div>
                      <div className="mt-2 text-[11px] text-muted-foreground">
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
