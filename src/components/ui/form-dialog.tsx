import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The single way this app asks for new records.
 *
 * Before this existed, every create surface was hand-rolled: some were
 * inline Cards on the page (deals, tickets, teammates), some were Dialogs,
 * and no two agreed on where the submit button lived, whether Escape
 * discarded a half-typed draft, whether Enter submitted, or whether the busy
 * state disabled anything. FormDialog fixes the shape once:
 *
 *  - It is a real <form>, so Enter submits and browser validation works.
 *  - Submitting is disabled (and spinner-labelled) while `busy`.
 *  - Closing while busy is blocked, so a half-committed write can't have its
 *    UI yanked out from under it.
 *  - Cancel and the X do the same thing, and both run `onCancel`.
 *
 * It intentionally does NOT own form state. Every caller in this codebase
 * already keeps its draft in useState alongside validation that talks to a
 * named command; forcing them all onto react-hook-form would have been a
 * rewrite of the validation layer, not a UI change.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  trigger,
  children,
  onSubmit,
  onCancel,
  busy = false,
  submitLabel = "Save",
  busyLabel,
  cancelLabel = "Cancel",
  submitDisabled = false,
  submitVariant = "default",
  size = "md",
  footerNote,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** Optional trigger button rendered inside the Dialog (asChild). */
  trigger?: React.ReactNode;
  children: React.ReactNode;
  onSubmit: () => void | Promise<void>;
  onCancel?: () => void;
  busy?: boolean;
  submitLabel?: string;
  busyLabel?: string;
  cancelLabel?: string;
  submitDisabled?: boolean;
  /**
   * Destructive for confirmations that close or discard something — marking a
   * deal lost, for instance. The default stays primary so the ordinary create
   * path can't accidentally style itself as dangerous.
   */
  submitVariant?: "default" | "destructive";
  size?: "md" | "lg" | "xl";
  footerNote?: React.ReactNode;
}) {
  const handleOpenChange = (next: boolean) => {
    // A submit in flight owns the dialog until it resolves — closing here
    // would strand the spinner and hide whatever error came back.
    if (busy && !next) return;
    if (!next) onCancel?.();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        className={cn(
          size === "lg" && "sm:max-w-2xl",
          size === "xl" && "sm:max-w-4xl",
          "max-h-[calc(100dvh-2rem)]",
        )}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || submitDisabled) return;
            void onSubmit();
          }}
          className="contents"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          <div className="grid gap-4 py-1">{children}</div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div className="text-xs text-muted-foreground sm:self-center">{footerNote}</div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => handleOpenChange(false)}
              >
                {cancelLabel}
              </Button>
              <Button type="submit" variant={submitVariant} disabled={busy || submitDisabled}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {busy ? (busyLabel ?? submitLabel) : submitLabel}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A labelled field. Wraps any control (Input, Select, Textarea, a combobox)
 * so label association, the required marker, hint text, and error styling
 * are consistent rather than re-invented per form.
 */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Responsive field grid. Single column on mobile — a two-up form on a phone
 * produces inputs too narrow to read what you typed.
 */
export function FieldGrid({
  columns = 2,
  className,
  children,
}: {
  columns?: 1 | 2 | 3;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Spans the full width of a FieldGrid, for textareas and long text. */
export function FieldSpan({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("sm:col-span-2 lg:col-span-3", className)}>{children}</div>;
}

/**
 * A titled group of fields inside a longer form, so a 20-field create
 * surface reads as three or four short forms instead of one wall.
 */
export function FieldSection({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
