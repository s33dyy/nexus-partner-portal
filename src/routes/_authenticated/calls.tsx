import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Phone, PhoneIncoming, PhoneOutgoing, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/page-header";
import { AccessDeniedPage } from "@/components/route-placeholder";
import { Badge } from "@/components/ui/badge";
import { resolveStatusTone } from "@/lib/status-tone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CsvExportButton } from "@/components/csv-export-button";
import { type CsvColumn } from "@/lib/csv-export";
import { formatDateTimeLabel } from "@/lib/date-utils";
import { supabase } from "@/integrations/local/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/calls")({
  component: CallsPage,
});

type CallLogRecord = {
  id: string;
  twilio_call_sid: string;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  agent_user_id: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  disposition: string | null;
  created_at: string;
};

const CALL_EXPORT_COLUMNS: CsvColumn[] = [
  { key: "direction", header: "Direction" },
  { key: "from_number", header: "From" },
  { key: "to_number", header: "To" },
  { key: "status", header: "Status" },
  { key: "duration_seconds", header: "Duration (s)" },
  { key: "disposition", header: "Disposition" },
  { key: "created_at", header: "Created At" },
];

type BadgeTone = "neutral" | "brand" | "success" | "warning" | "info" | "danger";

const STATUS_TONE: Record<string, BadgeTone> = {
  queued: "neutral",
  ringing: "info",
  "in-progress": "brand",
  completed: "success",
  busy: "danger",
  failed: "danger",
  "no-answer": "warning",
  canceled: "neutral",
};

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function CallsPage() {
  const { can, hasRole } = useAuth();
  const [calls, setCalls] = useState<CallLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("call_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      setCalls((data as CallLogRecord[] | null) ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load calls");
      setCalls([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!can("calls", "read")) {
    return <AccessDeniedPage title="Calls" roleLabel="LIVEY Support or Super Admin" />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Call Center"
        icon={<Phone className="h-3.5 w-3.5" />}
        title="Calls"
        description="Inbound and outbound call history from the LIVEY softphone."
        actions={
          <>
            <Badge tone="neutral">{hasRole("super_admin") ? "All calls" : "Your calls"}</Badge>
            <CsvExportButton
              filenameStem="livey-calls"
              columns={CALL_EXPORT_COLUMNS}
              loadRows={async () => calls}
            />
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
          </>
        }
      />

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Call history</CardTitle>
          <CardDescription>Most recent 200 calls, newest first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading calls...
            </div>
          ) : calls.length === 0 ? (
            <EmptyState
              icon={<Phone className="h-5 w-5" />}
              title="No calls logged yet"
              description="Inbound and outbound calls placed through the LIVEY softphone will appear here."
            />
          ) : (
            <div className="divide-y">
              {calls.map((call) => (
                <div
                  key={call.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    {call.direction === "inbound" ? (
                      <PhoneIncoming className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <PhoneOutgoing className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {call.direction === "inbound" ? call.from_number : call.to_number}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatDateTimeLabel(call.created_at)} ·{" "}
                        {formatDuration(call.duration_seconds)}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {call.disposition && (
                      <Badge tone={resolveStatusTone(call.disposition)}>{call.disposition}</Badge>
                    )}
                    <Badge tone={STATUS_TONE[call.status] ?? "neutral"}>{call.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
