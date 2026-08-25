import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Activity, Inbox, Send } from "lucide-react";

import { EmptyState, PageHeader, StatTile } from "@/components/page-header";
import { AccessDeniedPage, FeatureUnavailablePage } from "@/components/route-placeholder";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import {
  getIntegrationDeliverySnapshot,
  type IntegrationDeliverySnapshot,
} from "@/integrations/local/integration-readiness";
import { formatDateTimeLabel } from "@/lib/date-utils";

export const Route = createFileRoute("/_authenticated/admin/integrations")({
  component: AdminIntegrationsPage,
});

/**
 * Integration Operations Centre (product.md §17.3).
 *
 * Reports the durable delivery spine that actually exists — command_outbox
 * and command_inbox — and nothing else. It deliberately shows no provider
 * connection states and offers no pause/resume/disconnect controls: this
 * product has no adapter worker, so any such row or button would be a claim
 * about a system that is not running. The previous version of this page
 * asserted exactly that, with invented queue depths and a setTimeout
 * standing in for a network call.
 */
const STATUS_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  pending: "warning",
  published: "success",
  processed: "success",
  failed: "danger",
  dead_letter: "danger",
  ignored: "neutral",
};

function StatusCounts({ counts }: { counts: Array<{ status: string; count: number }> }) {
  if (counts.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No rows yet.</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {counts.map((entry) => (
        <Badge key={entry.status} tone={STATUS_TONE[entry.status] ?? "neutral"}>
          {entry.status} · {entry.count}
        </Badge>
      ))}
    </div>
  );
}

function AdminIntegrationsPage() {
  const { hasRole, surfaces } = useAuth();
  const [snapshot, setSnapshot] = useState<IntegrationDeliverySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const enabled = surfaces.integrationOperationsCentre;
  const isSuperAdmin = hasRole("super_admin");

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setSnapshot(await getIntegrationDeliverySnapshot());
    } catch (error) {
      console.error("Failed to load integration delivery snapshot", error);
      setSnapshot(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // No query is issued while the surface is off or the caller is not
    // authorised, so a hidden page is hidden in the network tab too.
    if (!enabled || !isSuperAdmin) {
      setLoading(false);
      return;
    }
    void load();
  }, [enabled, isSuperAdmin, load]);

  if (!enabled) {
    return (
      <FeatureUnavailablePage
        title="Integration operations centre"
        description="Integration operations are not enabled in this workspace."
      />
    );
  }

  if (!isSuperAdmin) {
    return <AccessDeniedPage title="Integration operations centre" roleLabel="Super Admin" />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Operations Centre"
        icon={<Activity className="h-3.5 w-3.5" />}
        title="Integration delivery"
        description="Outbound and inbound durable delivery state. Correlation and status only — never secrets or provider payloads."
      />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : failed || !snapshot ? (
        <Card>
          <EmptyState
            title="Delivery state is unavailable"
            description="The delivery tables could not be read. Nothing is inferred in their absence."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Outbound envelopes"
              value={snapshot.outbox.total}
              icon={<Send className="h-4 w-4" />}
            />
            <StatTile
              label="Oldest pending outbound"
              value={
                snapshot.outbox.oldestPendingAt
                  ? formatDateTimeLabel(snapshot.outbox.oldestPendingAt)
                  : "—"
              }
              tone={snapshot.outbox.oldestPendingAt ? "warning" : "neutral"}
            />
            <StatTile
              label="Inbound envelopes"
              value={snapshot.inbox.total}
              icon={<Inbox className="h-4 w-4" />}
            />
            <StatTile
              label="Highest attempt count"
              value={snapshot.outbox.maxAttemptCount}
              tone={snapshot.outbox.maxAttemptCount > 0 ? "warning" : "neutral"}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Outbound (command_outbox)</CardTitle>
                <CardDescription>
                  Envelopes written transactionally by domain commands, awaiting an adapter worker.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <StatusCounts counts={snapshot.outbox.byStatus} />
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Emitting events
                  </div>
                  {snapshot.recentEventNames.length === 0 ? (
                    <p className="mt-1.5 text-[13px] text-muted-foreground">None recorded yet.</p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {snapshot.recentEventNames.map((name) => (
                        <Badge key={name} variant="outline" className="font-mono text-[10px]">
                          {name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Inbound (command_inbox)</CardTitle>
                <CardDescription>
                  Verified provider events durably received before any domain processing.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <StatusCounts counts={snapshot.inbox.byStatus} />
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Oldest unprocessed
                  </div>
                  <div className="mt-1.5 text-[13px]">
                    {snapshot.inbox.oldestUnprocessedAt
                      ? formatDateTimeLabel(snapshot.inbox.oldestUnprocessedAt)
                      : "—"}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
