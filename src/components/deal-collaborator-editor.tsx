import { useMemo, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  applyPresetCollaboratorSplits,
  buildPresetCollaboratorSplits,
  rebalanceCollaboratorSplits,
  type DealCollaboratorDraft,
} from "@/lib/deal-collaboration";

export type DealCollaboratorMember = {
  id: string;
  full_name: string;
  email: string;
  portal_role?: string | null;
};

type DealCollaboratorEditorProps = {
  title?: string;
  collaborators: DealCollaboratorDraft[];
  availableMembers: DealCollaboratorMember[];
  hiddenToTeam: boolean;
  rewardRatePercent?: number;
  showRewardRate?: boolean;
  allowEditRewardRate?: boolean;
  allowEditCollaborators?: boolean;
  disabled?: boolean;
  onCollaboratorsChange: (collaborators: DealCollaboratorDraft[]) => void;
  onHiddenToTeamChange?: (hidden: boolean) => void;
  onRewardRateChange?: (percent: number) => void;
};

export function DealCollaboratorEditor({
  title = "Invite team",
  collaborators,
  availableMembers,
  hiddenToTeam,
  rewardRatePercent = 5,
  showRewardRate = false,
  allowEditRewardRate = false,
  allowEditCollaborators = true,
  disabled = false,
  onCollaboratorsChange,
  onHiddenToTeamChange,
  onRewardRateChange,
}: DealCollaboratorEditorProps) {
  const [selectedMemberId, setSelectedMemberId] = useState("");

  const collaboratorById = useMemo(
    () =>
      new Map(collaborators.map((collaborator) => [collaborator.userId, collaborator] as const)),
    [collaborators],
  );
  const memberById = useMemo(
    () => new Map(availableMembers.map((member) => [member.id, member] as const)),
    [availableMembers],
  );
  const availableToAdd = useMemo(
    () => availableMembers.filter((member) => !collaboratorById.has(member.id)),
    [availableMembers, collaboratorById],
  );

  const addCollaborator = () => {
    if (!selectedMemberId) return;
    if (collaborators.length >= 4) return;
    const ids = [...collaborators.map((entry) => entry.userId), selectedMemberId];
    onCollaboratorsChange(applyPresetCollaboratorSplits(ids));
    setSelectedMemberId("");
  };

  const removeCollaborator = (userId: string) => {
    const remaining = collaborators
      .filter((collaborator) => collaborator.userId !== userId)
      .map((collaborator, index) => ({ ...collaborator, sortOrder: index }));
    onCollaboratorsChange(
      remaining.length > 0
        ? applyPresetCollaboratorSplits(remaining.map((item) => item.userId))
        : [],
    );
  };

  const updateSplit = (userId: string, value: number) => {
    const ordered = [...collaborators].sort((left, right) => left.sortOrder - right.sortOrder);
    const next = ordered.map((collaborator) => ({ ...collaborator }));
    const index = next.findIndex((collaborator) => collaborator.userId === userId);
    if (index < 0) return;

    next[index] = { ...next[index], splitPercent: Math.max(0, Math.min(100, value)) };
    onCollaboratorsChange(rebalanceCollaboratorSplits(next));
  };

  const orderedCollaborators = useMemo(
    () => [...collaborators].sort((left, right) => left.sortOrder - right.sortOrder),
    [collaborators],
  );
  const totalSplit = orderedCollaborators.reduce(
    (sum, collaborator) => sum + Number(collaborator.splitPercent || 0),
    0,
  );
  const maxReached = orderedCollaborators.length >= 4;

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">
            Invite existing team members and split the reward between up to four people.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{orderedCollaborators.length}/4 collaborators</Badge>
          <Badge variant={Math.round(totalSplit) === 100 ? "secondary" : "destructive"}>
            {Math.round(totalSplit)}%
          </Badge>
        </div>
      </div>

      {showRewardRate ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Reward rate">
            <Input
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={rewardRatePercent}
              onChange={(event) => onRewardRateChange?.(Number(event.target.value) || 0)}
              disabled={disabled || !allowEditRewardRate}
            />
          </Field>
          <div className="rounded-md border bg-background/80 p-3 text-xs text-muted-foreground">
            RNR is calculated as a percentage of the deal amount. Super admins can adjust this per
            deal from the review flow.
          </div>
        </div>
      ) : null}

      {onHiddenToTeamChange ? (
        <div className="flex items-center justify-between rounded-md border bg-background/80 px-3 py-2">
          <div>
            <div className="text-sm font-medium">Hide from team</div>
            <div className="text-xs text-muted-foreground">
              Only the creator, invited collaborators, partner admins, and super admins can see
              hidden deals.
            </div>
          </div>
          <Switch
            checked={hiddenToTeam}
            onCheckedChange={onHiddenToTeamChange}
            disabled={disabled}
          />
        </div>
      ) : null}

      {allowEditCollaborators ? (
        <div className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <Field className="flex-1" label="Add collaborator">
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedMemberId}
                onChange={(event) => setSelectedMemberId(event.target.value)}
                disabled={disabled || maxReached || availableToAdd.length === 0}
              >
                <option value="">Choose a team member</option>
                {availableToAdd.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name} · {member.email}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              type="button"
              variant="outline"
              onClick={addCollaborator}
              disabled={disabled || maxReached || !selectedMemberId}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add
            </Button>
          </div>

          {orderedCollaborators.length === 0 ? (
            <div className="rounded-md border border-dashed bg-background/60 p-4 text-sm text-muted-foreground">
              Add at least one collaborator to define the reward split.
            </div>
          ) : (
            <div className="space-y-2">
              {orderedCollaborators.map((collaborator, index) => {
                const member = memberById.get(collaborator.userId);
                return (
                  <div
                    key={collaborator.userId}
                    className="flex flex-col gap-3 rounded-md border bg-background/80 p-3 md:flex-row md:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {member?.full_name ?? collaborator.userId}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {member?.email ?? "No email available"}
                        {member?.portal_role ? ` · ${member.portal_role}` : ""}
                      </div>
                    </div>
                    <Field label="Split %" className="w-full md:max-w-24">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={collaborator.splitPercent}
                        onChange={(event) =>
                          updateSplit(collaborator.userId, Number(event.target.value) || 0)
                        }
                        disabled={disabled}
                      />
                    </Field>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">#{index + 1}</Badge>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeCollaborator(collaborator.userId)}
                        disabled={disabled}
                        aria-label={`Remove ${member?.full_name ?? "collaborator"}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            Preset splits:{" "}
            {buildPresetCollaboratorSplits(
              Math.min(Math.max(orderedCollaborators.length, 1), 4),
            ).join(" / ")}
          </div>
        </div>
      ) : null}

      {!allowEditCollaborators ? (
        <div className="space-y-3">
          {orderedCollaborators.length === 0 ? (
            <div className="rounded-md border border-dashed bg-background/60 p-4 text-sm text-muted-foreground">
              Collaborators are locked for this record.
            </div>
          ) : (
            <div className="space-y-2">
              {orderedCollaborators.map((collaborator, index) => {
                const member = memberById.get(collaborator.userId);
                return (
                  <div
                    key={collaborator.userId}
                    className="flex flex-col gap-3 rounded-md border bg-background/80 p-3 md:flex-row md:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {member?.full_name ?? collaborator.userId}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {member?.email ?? "No email available"}
                        {member?.portal_role ? ` · ${member.portal_role}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">#{index + 1}</Badge>
                      <Badge>{collaborator.splitPercent}%</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Collaborator editing is locked for this record.
          </div>
        </div>
      ) : null}

      <Separator />

      <div className="text-xs text-muted-foreground">
        Deals can include up to 4 team members. The first collaborator gets the leading preset
        split, and the editor keeps the total at 100%.
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
