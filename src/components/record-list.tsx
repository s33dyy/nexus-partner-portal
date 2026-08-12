import * as React from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/lib/status-tone";

/**
 * The record-list vocabulary shared by Deals, Pipeline, Tasks and Customers.
 *
 * Every CRM this app was benchmarked against expresses a list of records the
 * same way: a coloured accent down the left edge carrying the record's state,
 * the name, an owner avatar, and the state repeated as a pill. Before this,
 * each route hand-rolled its own row markup, so the same deal looked
 * different on Deals, Pipeline and the dashboard.
 *
 * Responsiveness is the other half of the job. A table cannot survive 375px,
 * so RecordRow is a two-column flex on desktop that reflows to a stacked
 * card on mobile — the same component, no duplicated mobile markup to drift
 * out of sync.
 */

/**
 * Solid background for the accent bar and group dot, per tone.
 *
 * `none` is Badge's "no tone selected" sentinel rather than a colour, so it
 * renders the same neutral grey as an unrecognised status — the accent bar
 * must always paint something, or rows lose their left edge entirely.
 */
const TONE_SOLID: Record<StatusTone, string> = {
  none: "bg-muted-foreground/35",
  neutral: "bg-muted-foreground/35",
  brand: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  danger: "bg-destructive",
};

/**
 * Initials chip for a record's owner.
 *
 * Deliberately initials, not a photo: this app has no avatar upload for
 * team members, so a photo slot would render as a broken image or a generic
 * silhouette on every row.
 */
export function OwnerAvatar({
  name,
  className,
  size = "sm",
}: {
  name: string | null | undefined;
  className?: string;
  size?: "xs" | "sm";
}) {
  const initials =
    (name ?? "")
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase() || "—";

  return (
    <span
      title={name ?? undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-secondary font-medium text-muted-foreground ring-1 ring-border",
        size === "xs" ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]",
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** `● Pipeline    4` — the section header above a group of records. */
export function GroupHeader({
  label,
  count,
  tone = "neutral",
  actions,
  className,
}: {
  label: string;
  count?: number;
  tone?: StatusTone;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 px-1 py-2", className)}>
      <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE_SOLID[tone])} aria-hidden="true" />
      <h3 className="text-[13px] font-semibold capitalize">{label}</h3>
      {typeof count === "number" ? (
        <span
          className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
          data-numeric
        >
          {count}
        </span>
      ) : null}
      {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}

/**
 * One record.
 *
 * `trailing` is the right-hand cluster (status pill, amount, actions). On
 * mobile it wraps beneath the title rather than being squeezed, which is what
 * every mobile CRM screenshot does.
 */
export function RecordRow({
  tone = "neutral",
  title,
  subtitle,
  meta,
  trailing,
  owner,
  onClick,
  selected,
  className,
}: {
  tone?: StatusTone;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  owner?: string | null;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}) {
  const interactive = typeof onClick === "function";
  const Comp = interactive ? "button" : "div";

  return (
    <Comp
      type={interactive ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "relative flex w-full flex-col gap-2 overflow-hidden rounded-md border bg-card px-3 py-2.5 pl-4 text-left transition-colors sm:flex-row sm:items-center sm:gap-3",
        interactive && "cursor-pointer hover:border-ring/40 hover:bg-secondary/50",
        selected && "border-ring/50 bg-secondary/60",
        className,
      )}
    >
      {/* The accent bar. Absolute so it spans the full row height including
          the wrapped mobile layout. */}
      <span
        className={cn("absolute inset-y-0 left-0 w-[3px]", TONE_SOLID[tone])}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {owner !== undefined ? <OwnerAvatar name={owner} size="xs" /> : null}
          <span className="truncate text-[13px] font-medium">{title}</span>
        </div>
        {subtitle ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
        {meta ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {meta}
          </div>
        ) : null}
      </div>

      {trailing ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{trailing}</div>
      ) : null}
    </Comp>
  );
}

/** Wraps a run of RecordRows so they share consistent vertical rhythm. */
export function RecordList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-col gap-1.5", className)}>{children}</div>;
}

/**
 * A kanban column.
 *
 * Horizontal scroll is the deliberate mobile behaviour for a board — the
 * alternative (stacking columns vertically) stops it being a board at all.
 * The parent supplies `overflow-x-auto`; each column keeps a fixed min-width
 * so columns stay readable rather than compressing to nothing.
 */
export function BoardColumn({
  label,
  count,
  tone = "neutral",
  onAdd,
  addLabel = "Add",
  children,
  className,
}: {
  label: string;
  count: number;
  tone?: StatusTone;
  onAdd?: () => void;
  addLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-[280px] shrink-0 flex-col rounded-lg border bg-secondary/40 sm:w-[300px]",
        className,
      )}
    >
      <GroupHeader
        label={label}
        count={count}
        tone={tone}
        className="border-b bg-card/60 px-3 py-2.5"
        actions={
          onAdd ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`${addLabel} in ${label}`}
              onClick={onAdd}
            >
              <Plus className="h-4 w-4" />
            </Button>
          ) : null
        }
      />
      <div className="flex min-h-24 flex-col gap-2 p-2">{children}</div>
    </div>
  );
}
