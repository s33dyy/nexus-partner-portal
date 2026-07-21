import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AccessDeniedPage } from "@/components/route-placeholder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/local/client";
import { type AuditEventRecord } from "@/lib/portal-records";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  component: AdminAuditPage,
});

function AdminAuditPage() {
  const { hasRole } = useAuth();
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [source, setSource] = useState<"database" | "empty">("empty");
  const [query, setQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("portal_audit_events")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data as AuditEventRecord[] | null) ?? [];
      setEvents(rows);
      setSource(rows.length > 0 ? "database" : "empty");
    } catch {
      setEvents([]);
      setSource("empty");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredEvents = useMemo(() => {
    const term = query.trim().toLowerCase();
    return events.filter((event) => {
      const matchesSeverity = severityFilter === "all" || event.severity === severityFilter;
      const matchesQuery =
        !term ||
        [event.actor_name, event.action, event.target_name, event.details, event.outcome]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return matchesSeverity && matchesQuery;
    });
  }, [events, query, severityFilter]);

  const exportCsv = () => {
    const rows = [
      [
        "created_at",
        "actor_name",
        "actor_role",
        "action",
        "target_type",
        "target_name",
        "outcome",
        "severity",
        "details",
      ],
      ...filteredEvents.map((event) => [
        event.created_at,
        event.actor_name,
        event.actor_role,
        event.action,
        event.target_type,
        event.target_name,
        event.outcome,
        event.severity,
        event.details,
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "audit-log.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!hasRole("super_admin")) {
    return <AccessDeniedPage title="Audit logs" roleLabel="Super Admin" />;
  }

  const stats = {
    total: events.length,
    medium: events.filter((event) => event.severity === "medium").length,
    low: events.filter((event) => event.severity === "low").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Administration
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Audit logs</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Trace important workspace actions, approvals, and access changes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {source === "database" ? "Live Postgres data" : "Empty state"}
          </Badge>
          <Button
            variant="outline"
            onClick={() => {
              setRefreshing(true);
              void load();
            }}
            disabled={loading || refreshing}
          >
            {loading || refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={filteredEvents.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Events" value={String(stats.total)} hint="Recorded actions" />
        <Metric label="Medium" value={String(stats.medium)} hint="Needs attention" />
        <Metric label="Low" value={String(stats.low)} hint="Informational" />
      </div>

      <Card>
        <CardHeader className="space-y-4 border-b">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-base">Event stream</CardTitle>
              <CardDescription>
                Filter the live history and inspect the latest actions.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search logs"
                  className="pl-8"
                />
              </div>
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All severities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All severities</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading audit log...
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="p-8 text-sm text-muted-foreground">
              No audit records match this view.
            </div>
          ) : (
            <div className="divide-y">
              {filteredEvents.map((event) => (
                <div key={event.id} className="px-5 py-4">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium">{event.action}</div>
                        <Badge variant="outline">{event.severity}</Badge>
                        <Badge>{event.outcome}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {event.actor_name} · {event.actor_role} · {event.target_type}:{" "}
                        {event.target_name}
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {new Date(event.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">{event.details}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-5">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        <div className="text-sm text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}
