import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { tagDealParticipant, untagDealParticipant } from "@/integrations/local/participant-commands";
import { toast } from "sonner";
import { Tags, X } from "lucide-react";

export function DealParticipantTags({ dealId }: { dealId: string }) {
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState<{id: string, label: string}[]>([]); // MVP static list

  const handleAddTag = async () => {
    setLoading(true);
    try {
      const res = await tagDealParticipant({
        dealId,
        participantUserId: "dummy-user-id", // Hardcoded for MVP layout
        participantType: "technical_presales",
        reason: "Added from deal detail panel"
      });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success("Participant tagged");
      // refresh
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveTag = async (id: string) => {
    setLoading(true);
    try {
      const res = await untagDealParticipant({ dealId, participantId: id });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success("Participant removed");
      // refresh
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium flex items-center gap-2"><Tags className="w-4 h-4" /> Participants</h3>
        <Button variant="outline" size="sm" onClick={handleAddTag} disabled={loading}>
          Tag Someone
        </Button>
      </div>
      
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 ? (
          <span className="text-sm text-muted-foreground italic">No participants tagged.</span>
        ) : (
          tags.map(tag => (
            <Badge key={tag.id} variant="secondary" className="flex items-center gap-1 pr-1 border">
              {tag.label}
              <Button variant="ghost" size="icon" className="h-4 w-4 ml-1 hover:bg-transparent rounded-full" onClick={() => handleRemoveTag(tag.id)}>
                <X className="w-3 h-3" />
              </Button>
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}
