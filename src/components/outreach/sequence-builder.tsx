import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CheckSquare, Mail, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid, FieldSection } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  OUTREACH_TOKENS,
  renderOutreachTemplate,
  sequenceAutomationPercent,
  sequenceDurationDays,
  type OutreachStepType,
  type SequenceStepDraft,
} from "@/domain/contracts/outreach";

/**
 * The step editor shared by "New sequence" and "Edit steps".
 *
 * Two things it deliberately does that a plain form would not:
 *
 *  - Every text field is token-aware. Clicking a token chip inserts it at
 *    the caret of whichever field was last focused, because the alternative
 *    (typing `{{first_name}}` by hand) is how a live sequence ends up
 *    mailing a literal `{{firstname}}`.
 *  - The preview underneath renders the focused step against sample values,
 *    so the writer sees the message a recipient will see.
 */

export const EMPTY_EMAIL_STEP: SequenceStepDraft = {
  stepType: "email",
  dayOffset: 0,
  subject: "",
  body: "",
  taskTitle: "",
  taskPriority: "medium",
};

export const EMPTY_TASK_STEP: SequenceStepDraft = {
  stepType: "task",
  dayOffset: 0,
  subject: "",
  body: "",
  taskTitle: "",
  taskPriority: "medium",
};

export type SequenceSettingsDraft = {
  name: string;
  description: string;
  businessDaysOnly: boolean;
  threadAsReply: boolean;
  unenrollOnDealCreated: boolean;
};

const SAMPLE_VALUES: Record<string, string> = Object.fromEntries(
  OUTREACH_TOKENS.map((token) => [token.key, token.example]),
);

function TokenChips({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {OUTREACH_TOKENS.map((token) => (
        <button
          key={token.key}
          type="button"
          title={`${token.label} — e.g. ${token.example}`}
          onClick={() => onInsert(`{{${token.key}}}`)}
          className="rounded border border-dashed bg-secondary/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-ring/50 hover:text-foreground"
        >
          {token.key}
        </button>
      ))}
    </div>
  );
}

export function SequenceBuilder({
  settings,
  onSettingsChange,
  steps,
  onStepsChange,
  disabled = false,
  runningContacts = 0,
}: {
  settings: SequenceSettingsDraft;
  onSettingsChange: (next: SequenceSettingsDraft) => void;
  steps: SequenceStepDraft[];
  onStepsChange: (next: SequenceStepDraft[]) => void;
  disabled?: boolean;
  /** Contacts still running this sequence. The server refuses to re-cut the
   * steps while any are — surfaced up front, because finding out at Save
   * means having written the changes for nothing. */
  runningContacts?: number;
}) {
  // Which field the caret was last in, so a token chip knows where to land.
  const focusedField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  const updateStep = useCallback(
    (index: number, patch: Partial<SequenceStepDraft>) => {
      onStepsChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
    },
    [onStepsChange, steps],
  );

  const insertToken = useCallback((token: string) => {
    const field = focusedField.current;
    // isConnected, not just non-null: switching a step from email to task, or
    // deleting the step, unmounts the field the ref is holding. Writing into
    // a detached node and dispatching an input event React no longer listens
    // to made the chips look broken — a click with no effect and no message.
    if (!field || !field.isConnected) {
      focusedField.current = null;
      return;
    }
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    const next = `${field.value.slice(0, start)}${token}${field.value.slice(end)}`;

    // A React controlled input ignores a direct `.value =` assignment, so the
    // new text is pushed through the element's own value setter and an input
    // event, which is exactly the path a paste takes.
    const prototype =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(field, next);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
    const caret = start + token.length;
    field.setSelectionRange(caret, caret);
  }, []);

  const durationDays = useMemo(() => sequenceDurationDays(steps), [steps]);
  const automationPercent = useMemo(() => sequenceAutomationPercent(steps), [steps]);

  const safePreviewIndex = Math.min(previewIndex, Math.max(steps.length - 1, 0));
  const previewStep = steps[safePreviewIndex];
  const preview = useMemo(() => {
    if (!previewStep || previewStep.stepType !== "email") return null;
    return {
      subject: renderOutreachTemplate(previewStep.subject, SAMPLE_VALUES).text,
      body: renderOutreachTemplate(previewStep.body, SAMPLE_VALUES).text,
    };
  }, [previewStep]);

  return (
    <div className="space-y-5">
      {runningContacts > 0 ? (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          {runningContacts} contact{runningContacts === 1 ? " is" : "s are"} still running this
          sequence. Settings can be saved, but the steps cannot change until they finish or are
          stopped — a cadence somebody is halfway through must not shift under them.
        </p>
      ) : null}
      <FieldSection title="Sequence">
        <FieldGrid columns={2}>
          <Field label="Name" htmlFor="sequence-name" required>
            <Input
              id="sequence-name"
              value={settings.name}
              disabled={disabled}
              placeholder="Thank you for downloading"
              onChange={(event) => onSettingsChange({ ...settings, name: event.target.value })}
            />
          </Field>
          <Field label="Description" htmlFor="sequence-description">
            <Input
              id="sequence-description"
              value={settings.description}
              disabled={disabled}
              placeholder="Follow-up after a content download"
              onChange={(event) =>
                onSettingsChange({ ...settings, description: event.target.value })
              }
            />
          </Field>
        </FieldGrid>

        <div className="space-y-2.5 rounded-md border bg-secondary/30 p-3">
          <label className="flex items-start justify-between gap-3 text-[13px]">
            <span>
              <span className="font-medium">Business days only</span>
              <span className="block text-xs text-muted-foreground">
                Skip weekends when spacing the steps out.
              </span>
            </span>
            <Switch
              checked={settings.businessDaysOnly}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onSettingsChange({ ...settings, businessDaysOnly: checked })
              }
            />
          </label>
          <label className="flex items-start justify-between gap-3 text-[13px]">
            <span>
              <span className="font-medium">Thread follow-ups as replies</span>
              <span className="block text-xs text-muted-foreground">
                Later emails reuse the first subject with &ldquo;Re:&rdquo;.
              </span>
            </span>
            <Switch
              checked={settings.threadAsReply}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onSettingsChange({ ...settings, threadAsReply: checked })
              }
            />
          </label>
          <label className="flex items-start justify-between gap-3 text-[13px]">
            <span>
              <span className="font-medium">Stop when a deal is created</span>
              <span className="block text-xs text-muted-foreground">
                Unenrol a contact as soon as a deal is opened for their customer.
              </span>
            </span>
            <Switch
              checked={settings.unenrollOnDealCreated}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onSettingsChange({ ...settings, unenrollOnDealCreated: checked })
              }
            />
          </label>
        </div>
      </FieldSection>

      <FieldSection
        title={`Steps — ${steps.length} step${steps.length === 1 ? "" : "s"}, ${durationDays} day${durationDays === 1 ? "" : "s"}, ${automationPercent}% automated`}
        description="Click a token to drop it where your cursor is. Add a fallback with a pipe — {{first_name|there}} — so a missing name never sends a blank greeting."
      >
        <TokenChips onInsert={insertToken} />

        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={index} className="rounded-md border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={step.stepType === "email" ? "brand" : "info"}>
                  {step.stepType === "email" ? (
                    <Mail className="mr-1 h-3 w-3" />
                  ) : (
                    <CheckSquare className="mr-1 h-3 w-3" />
                  )}
                  Step {index + 1}
                </Badge>
                <Select
                  value={step.stepType}
                  disabled={disabled}
                  onValueChange={(value) =>
                    updateStep(index, { stepType: value as OutreachStepType })
                  }
                >
                  <SelectTrigger className="h-8 w-[160px]" aria-label={`Step ${index + 1} type`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Automated email</SelectItem>
                    <SelectItem value="task">Task reminder</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Day</span>
                  <Input
                    type="number"
                    min={0}
                    max={180}
                    aria-label={`Step ${index + 1} day offset from enrolment`}
                    className="h-8 w-20"
                    disabled={disabled}
                    value={String(step.dayOffset)}
                    onChange={(event) =>
                      updateStep(index, { dayOffset: Number(event.target.value) || 0 })
                    }
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {step.dayOffset === 0
                    ? "same day as enrolment"
                    : `${step.dayOffset} ${settings.businessDaysOnly ? "business " : ""}day${step.dayOffset === 1 ? "" : "s"} after enrolment`}
                </span>

                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Move step ${index + 1} up`}
                    disabled={disabled || index === 0}
                    onClick={() => onStepsChange(swapPreservingSchedule(steps, index, index - 1))}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Move step ${index + 1} down`}
                    disabled={disabled || index === steps.length - 1}
                    onClick={() => onStepsChange(swapPreservingSchedule(steps, index, index + 1))}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    aria-label={`Remove step ${index + 1}`}
                    disabled={disabled || steps.length === 1}
                    onClick={() => onStepsChange(steps.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {step.stepType === "email" ? (
                <div className="mt-3 space-y-2">
                  <Input
                    aria-label={`Step ${index + 1} email subject`}
                    placeholder="Subject — e.g. Welcome to the {{country}} trends report"
                    value={step.subject}
                    disabled={disabled}
                    onFocus={(event) => {
                      focusedField.current = event.currentTarget;
                      setPreviewIndex(index);
                    }}
                    onChange={(event) => updateStep(index, { subject: event.target.value })}
                  />
                  <Textarea
                    rows={5}
                    aria-label={`Step ${index + 1} email body`}
                    placeholder={"Hi {{first_name|there}},\n\nThanks for downloading…"}
                    value={step.body}
                    disabled={disabled}
                    onFocus={(event) => {
                      focusedField.current = event.currentTarget;
                      setPreviewIndex(index);
                    }}
                    onChange={(event) => updateStep(index, { body: event.target.value })}
                  />
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Input
                    className="flex-1"
                    aria-label={`Step ${index + 1} task title`}
                    placeholder="Task — e.g. Connect with {{first_name}} on LinkedIn"
                    value={step.taskTitle}
                    disabled={disabled}
                    onFocus={(event) => {
                      focusedField.current = event.currentTarget;
                    }}
                    onChange={(event) => updateStep(index, { taskTitle: event.target.value })}
                  />
                  <Select
                    value={step.taskPriority}
                    disabled={disabled}
                    onValueChange={(value) => updateStep(index, { taskPriority: value })}
                  >
                    <SelectTrigger
                      className="w-full sm:w-[130px]"
                      aria-label={`Step ${index + 1} task priority`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() =>
              onStepsChange([
                ...steps,
                { ...EMPTY_EMAIL_STEP, dayOffset: nextOffset(steps, settings.businessDaysOnly) },
              ])
            }
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Email step
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() =>
              onStepsChange([...steps, { ...EMPTY_TASK_STEP, dayOffset: lastOffset(steps) }])
            }
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Task step
          </Button>
        </div>
      </FieldSection>

      {preview ? (
        <FieldSection
          title="Preview"
          description={`Step ${safePreviewIndex + 1}, rendered against sample contact data.`}
        >
          <div className="rounded-md border bg-secondary/30 p-3 text-[13px]">
            <div className="font-medium">{preview.subject || "(no subject yet)"}</div>
            <div className="mt-2 whitespace-pre-wrap text-muted-foreground">
              {preview.body || "(no body yet)"}
            </div>
          </div>
        </FieldSection>
      ) : null}
    </div>
  );
}

/**
 * Swaps two steps but leaves each POSITION's day offset where it was.
 *
 * A naive swap moves `dayOffset` with the step, so promoting a day-2 step
 * above a day-0 step produces [2, 0] — which the server's non-decreasing rule
 * rejects on every save, with the failure only surfacing after the user has
 * finished writing. Pinning the offsets to their slots means reordering
 * always yields a schedule that saves; changing *when* a step runs is what
 * the Day field is for.
 */
export function swapPreservingSchedule(
  steps: SequenceStepDraft[],
  from: number,
  to: number,
): SequenceStepDraft[] {
  if (from === to || !steps[from] || !steps[to]) return steps;
  const next = [...steps];
  const fromOffset = next[from]!.dayOffset;
  const toOffset = next[to]!.dayOffset;
  next[from] = { ...steps[to]!, dayOffset: fromOffset };
  next[to] = { ...steps[from]!, dayOffset: toOffset };
  return next;
}

function lastOffset(steps: SequenceStepDraft[]): number {
  return steps.length === 0 ? 0 : (steps[steps.length - 1]?.dayOffset ?? 0);
}

/** A new email step defaults a couple of days after the last — close enough
 * to stay in mind, far enough not to read as a machine gun. A task step
 * defaults to the same day, which is the "email them, then remind me to
 * connect on LinkedIn" pairing that makes a cadence feel human. */
function nextOffset(steps: SequenceStepDraft[], businessDaysOnly: boolean): number {
  if (steps.length === 0) return 0;
  return lastOffset(steps) + (businessDaysOnly ? 2 : 3);
}
