import * as React from "react";
import { Trophy, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toDateInputValue } from "@/lib/date-utils";

/**
 * The one place a deal is closed, from every surface.
 *
 * product.md §9.15 makes closing a deal a decision with required inputs, not a
 * button:
 *
 *  - "Selecting Won requires an outcome date, a PO Upload Now or Submit Later
 *    choice ... before the deal can leave Negotiation."
 *  - "Ordinary Lost requires a loss reason."
 *
 * Both Pipeline and Deals previously had a "move forward" action that, from
 * Negotiation, called markDealWon with neither an outcome date nor a PO choice
 * — so the canonical last step of the pipeline was the one step that captured
 * nothing, and Lost was unreachable without going to the Deals detail panel.
 * Leaving Negotiation now always asks which outcome it is.
 *
 * `initialOutcome` distinguishes the two ways in. Opened from an explicit
 * "Mark won"/"Mark lost" the answer is already known and the dialog goes
 * straight to that outcome's fields. Opened from "Move forward" out of
 * Negotiation it is null, and the choice itself is the first question — with
 * no default, because defaulting to Won is exactly the silent auto-win this
 * replaces.
 *
 * The component owns the draft. Callers keep only `open`, which stops the same
 * four useState declarations from being copied into every route that can close
 * a deal.
 */

export type DealOutcome = "won" | "lost";
export type DealPoChoice = "now" | "later";

export type DealOutcomeSubmission =
  | { outcome: "won"; outcomeDate: string; poChoice: DealPoChoice }
  | { outcome: "lost"; reason: string };

export function DealOutcomeDialog({
  open,
  onOpenChange,
  dealName,
  dealSubtitle,
  initialOutcome = null,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealName: string;
  dealSubtitle?: string;
  /** null asks which outcome it is; a value skips straight to that outcome. */
  initialOutcome?: DealOutcome | null;
  busy?: boolean;
  onConfirm: (submission: DealOutcomeSubmission) => void | Promise<void>;
}) {
  const [outcome, setOutcome] = React.useState<DealOutcome | null>(initialOutcome);
  const [outcomeDate, setOutcomeDate] = React.useState("");
  const [poChoice, setPoChoice] = React.useState<DealPoChoice>("later");
  const [reason, setReason] = React.useState("");

  // Reset on every open rather than on close: a dialog closed mid-edit would
  // otherwise flash its stale draft for a frame the next time it opens.
  React.useEffect(() => {
    if (!open) return;
    setOutcome(initialOutcome);
    setOutcomeDate(toDateInputValue(new Date().toISOString()) || "");
    setPoChoice("later");
    setReason("");
  }, [open, initialOutcome]);

  const lossReasonMissing = outcome === "lost" && !reason.trim();
  // Won needs a date; the server defaults a blank one to today, but §9.15 asks
  // the closer to state it, so the dialog does not submit without it.
  const outcomeDateMissing = outcome === "won" && !outcomeDate;

  const submit = () => {
    if (outcome === "won") {
      void onConfirm({ outcome: "won", outcomeDate, poChoice });
    } else if (outcome === "lost") {
      void onConfirm({ outcome: "lost", reason: reason.trim() });
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        outcome === "won"
          ? "Mark deal won"
          : outcome === "lost"
            ? "Mark deal lost"
            : "Close this deal"
      }
      description={
        outcome === "won"
          ? "Record the outcome date and whether the PO is ready now or will follow (product.md §9.15)."
          : outcome === "lost"
            ? "A reason is required so the pipeline keeps a real record of why this deal was lost."
            : "Negotiation is the last open stage. Choose the outcome this deal actually reached."
      }
      busy={busy}
      submitLabel={outcome === "lost" ? "Confirm lost" : "Confirm won"}
      busyLabel="Saving..."
      submitVariant={outcome === "lost" ? "destructive" : "default"}
      submitDisabled={outcome === null || lossReasonMissing || outcomeDateMissing}
      onSubmit={submit}
    >
      <div className="grid gap-1 text-sm">
        <div className="font-medium">{dealName}</div>
        {dealSubtitle ? <div className="text-muted-foreground">{dealSubtitle}</div> : null}
      </div>

      <Field label="Outcome" required>
        <div className="grid grid-cols-2 gap-2">
          <OutcomeChoice
            selected={outcome === "won"}
            tone="won"
            icon={<Trophy className="h-4 w-4" />}
            label="Won"
            hint="Closed with a purchase"
            onSelect={() => setOutcome("won")}
          />
          <OutcomeChoice
            selected={outcome === "lost"}
            tone="lost"
            icon={<XCircle className="h-4 w-4" />}
            label="Lost"
            hint="Did not close"
            onSelect={() => setOutcome("lost")}
          />
        </div>
      </Field>

      {outcome === "won" ? (
        <>
          <Field label="Outcome date" htmlFor="deal_outcome_date" required>
            <Input
              id="deal_outcome_date"
              type="date"
              value={outcomeDate}
              onChange={(event) => setOutcomeDate(event.target.value)}
            />
          </Field>
          <Field
            label="Purchase order"
            required
            hint={
              poChoice === "now"
                ? "The deal closes Won now; submit the PO in the Outcome Review panel right after."
                : "The deal closes Won with the PO pending. Rewards are only released once the PO is reviewed and approved."
            }
          >
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={poChoice === "now" ? "default" : "outline"}
                onClick={() => setPoChoice("now")}
              >
                Upload now
              </Button>
              <Button
                type="button"
                size="sm"
                variant={poChoice === "later" ? "default" : "outline"}
                onClick={() => setPoChoice("later")}
              >
                Submit later
              </Button>
            </div>
          </Field>
        </>
      ) : null}

      {outcome === "lost" ? (
        <Field label="Loss reason" htmlFor="deal_loss_reason" required>
          <Textarea
            id="deal_loss_reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Partner went with a competitor, budget cut, project cancelled..."
            rows={4}
          />
        </Field>
      ) : null}
    </FormDialog>
  );
}

/** One half of the Won/Lost choice — a radio in everything but markup. */
function OutcomeChoice({
  selected,
  tone,
  icon,
  label,
  hint,
  onSelect,
}: {
  selected: boolean;
  tone: "won" | "lost";
  icon: React.ReactNode;
  label: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? tone === "won"
            ? "tint-success border-success/40 text-success"
            : "tint-danger border-destructive/40 text-destructive"
          : "bg-card hover:bg-secondary",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        {icon}
        {label}
      </span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}
