import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { untagDealParticipant } from "@/integrations/local/participant-commands";
import { toast } from "sonner";
import { Loader2, Tags, X } from "lucide-react";
import { supabase } from "@/integrations/local/client";

type ParticipantRow = {
  id: string;
  participant_type: string;
  source: string;
  reason: string;
  valid_to: string | null;
};

function participantLabel(participantType: string) {
  return participantType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function DealParticipantTags({ dealId }: { dealId: string }) {
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState<ParticipantRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("deal_participants")
        .select("id, participant_type, source, reason, valid_to")
        .eq("deal_id", dealId);
      if (error) throw error;
      const rows = ((data as ParticipantRow[] | null) ?? []).filter((row) => !row.valid_to);
      setTags(rows);
    } catch {
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRemoveTag = async (id: string) => {
    setLoading(true);
    try {
      const res = await untagDealParticipant({ dealId, participantId: id });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success("Participant removed");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove participant");
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Tags className="w-4 h-4" /> Participants
        </h3>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="flex flex-wrap gap-2">
        {tags.length === 0 && !loading ? (
          <span className="text-sm text-muted-foreground italic">No participants tagged.</span>
        ) : (
          tags.map((tag) => (
            <Badge key={tag.id} variant="secondary" className="flex items-center gap-1 pr-1 border">
              {participantLabel(tag.participant_type)}
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 ml-1 hover:bg-transparent rounded-full"
                onClick={() => void handleRemoveTag(tag.id)}
              >
                <X className="w-3 h-3" />
              </Button>
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}
