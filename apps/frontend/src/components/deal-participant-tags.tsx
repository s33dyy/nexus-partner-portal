import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LookupCombobox } from "@/components/lookup-combobox";
import { LOOKUP_FIELDS } from "@/lib/lookup-fields";
import {
  tagDealParticipant,
  untagDealParticipant,
} from "@/integrations/local/participant-commands";
import { toast } from "sonner";
import { Loader2, Plus, Tags, X } from "lucide-react";
import { supabase } from "@/integrations/local/client";
import type { DropdownOption } from "@/lib/dropdown-sources";

type ParticipantRow = {
  id: string;
  participant_type: string;
  source: string;
  reason: string;
  valid_to: string | null;
  provenance: Record<string, unknown> | null;
};

function participantLabel(participantType: string) {
  return participantType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function taggedPersonLabel(participant: ParticipantRow) {
  const name = participant.provenance?.participantUserName;
  return typeof name === "string" && name ? name : null;
}

const EMPTY_DRAFT = {
  participantType: "primary_owner",
  personId: "",
  personLabel: "",
  reason: "",
};

export function DealParticipantTags({ dealId }: { dealId: string }) {
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState<ParticipantRow[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("deal_participants")
        .select("id, participant_type, source, reason, valid_to, provenance")
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

  const handleAddTag = async () => {
    if (!draft.personId) {
      toast.error("Select who you're tagging");
      return;
    }
    if (!draft.reason.trim()) {
      toast.error("Add a reason for this tag");
      return;
    }
    setSaving(true);
    try {
      const res = await tagDealParticipant({
        dealId,
        participantUserId: draft.personId,
        participantUserName: draft.personLabel || null,
        participantType: draft.participantType,
        reason: draft.reason.trim(),
      });
      if (!res.ok) throw new Error(res.failure.message);
      toast.success(
        `Tagged ${draft.personLabel || "participant"} — a task was added to their queue`,
      );
      setDraft(EMPTY_DRAFT);
      setFormOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to tag participant");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Tags className="w-4 h-4" /> Participants
        </h3>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setFormOpen((open) => !open)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Tag participant
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tags.length === 0 && !loading ? (
          <span className="text-sm text-muted-foreground italic">No participants tagged.</span>
        ) : (
          tags.map((tag) => (
            <Badge key={tag.id} variant="secondary" className="flex items-center gap-1 pr-1 border">
              {participantLabel(tag.participant_type)}
              {taggedPersonLabel(tag) ? ` · ${taggedPersonLabel(tag)}` : ""}
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

      {formOpen && (
        <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <div className="space-y-1.5">
            <Label>Participant type</Label>
            <LookupCombobox
              fieldName={LOOKUP_FIELDS.participantType}
              label="Participant type"
              value={draft.participantType}
              onValueChange={(value) =>
                setDraft((current) => ({ ...current, participantType: value }))
              }
              placeholder="Select participant type"
              options={["primary_owner", "collaborator", "approver", "observer", "support_contact"]}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Person</Label>
            <LookupCombobox
              fieldName={LOOKUP_FIELDS.dealOwner}
              source="poc"
              label="Person"
              value={draft.personLabel}
              onValueChange={(value) => setDraft((current) => ({ ...current, personLabel: value }))}
              onSelectionChange={(selection: DropdownOption | null) =>
                setDraft((current) => ({
                  ...current,
                  personId: selection?.id ?? "",
                  personLabel: selection?.label ?? current.personLabel,
                }))
              }
              placeholder="Search for a colleague"
              allowCreate={false}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea
              value={draft.reason}
              onChange={(e) => setDraft((current) => ({ ...current, reason: e.target.value }))}
              placeholder="Why is this person being tagged?"
              rows={2}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleAddTag()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Tag participant
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
