import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Activity, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCsvDate } from "@/lib/csv-export";
import { supabase } from "@/integrations/local/client";

type ActivityEventRow = {
  id: string;
  event_name: string;
  created_at: string;
};

function humanizeEventName(eventName: string) {
  return eventName
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

export function DealActivityTimeline({ dealId }: { dealId: string }) {
  const [events, setEvents] = useState<ActivityEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("domain_activity_events")
        .select("id, event_name, created_at")
        .eq("subject_type", "deal")
        .eq("subject_id", dealId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setEvents((data as ActivityEventRow[] | null) ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Activity className="w-4 h-4" /> Activity Timeline
        </h3>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      <ScrollArea className="h-[200px] border rounded-md p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading activity...
          </div>
        ) : events.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No activity recorded for this deal yet.
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((event, index) => (
              <div key={event.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full bg-primary mt-1.5" />
                  {index !== events.length - 1 && <div className="w-px h-full bg-border my-1" />}
                </div>
                <div className="pb-4">
                  <p className="text-sm font-medium">{humanizeEventName(event.event_name)}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatCsvDate(new Date(event.created_at))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
