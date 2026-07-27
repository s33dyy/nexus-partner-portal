import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { CsvExportButton } from "@/components/csv-export-button";
import { AccessDeniedPage } from "@/components/route-placeholder";
import { LookupCombobox } from "@/components/lookup-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/local/client";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import { type CsvColumn } from "@/lib/csv-export";
import { type AuditEventRecord } from "@/lib/portal-records";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  component: AdminAuditPage,
});

const AUDIT_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "created_at", header: "Created At" },
  { key: "actor_name", header: "Actor" },
  { key: "actor_role", header: "Actor Role" },
  { key: "action", header: "Action" },
  { key: "target_type", header: "Target Type" },
  { key: "target_name", header: "Target" },
  { key: "outcome", header: "Outcome" },
  { key: "severity", header: "Severity" },
  { key: "details", header: "Details" },
];

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
          <CsvExportButton
            label="Export CSV"
            filenameStem="livey-audit-events"
            columns={AUDIT_EXPORT_COLUMNS}
            loadRows={async () =>
              filteredEvents.map((event) => ({
                created_at: event.created_at,
                actor_name: event.actor_name,
                actor_role: event.actor_role,
                action: event.action,
                target_type: event.target_type,
                target_name: event.target_name,
                outcome: event.outcome,
                severity: event.severity,
                details: event.details,
              }))
            }
            variant="outline"
          />
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
              <LookupCombobox
                fieldName={LOOKUP_FIELDS.auditSeverity}
                label="Severity"
                value={severityFilter === "all" ? "" : severityFilter}
                onValueChange={(value) => setSeverityFilter(value || "all")}
                placeholder="All severities"
                clearLabel="All severities"
                allowClear
                options={["low", "medium", "high"]}
                triggerClassName="w-44"
              />
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
