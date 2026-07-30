import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Activity } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatCsvDate } from "@/lib/csv-export";

export function DealActivityTimeline({ dealId }: { dealId: string }) {
  // In MVP, we just render a static layout for the timeline, 
  // waiting for the real domain_activity_events query to be hooked up.
  const events = [
    { id: "1", event_name: "Deal Created", created_at: new Date().toISOString(), actor_name: "John Doe" },
    { id: "2", event_name: "Pricing Revision Frozen", created_at: new Date().toISOString(), actor_name: "Jane Smith" },
    { id: "3", event_name: "Deal Registration Submitted", created_at: new Date().toISOString(), actor_name: "Jane Smith" }
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium flex items-center gap-2"><Activity className="w-4 h-4" /> Activity Timeline</h3>
        <Button variant="outline" size="sm">Refresh</Button>
      </div>
      
      <ScrollArea className="h-[200px] border rounded-md p-4">
        <div className="space-y-4">
          {events.map((event, index) => (
            <div key={event.id} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5" />
                {index !== events.length - 1 && <div className="w-px h-full bg-border my-1" />}
              </div>
              <div className="pb-4">
                <p className="text-sm font-medium">{event.event_name}</p>
                <p className="text-xs text-muted-foreground">{formatCsvDate(event.created_at)} • by {event.actor_name}</p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
