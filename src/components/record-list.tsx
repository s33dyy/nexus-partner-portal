import * as React from "react";
import { ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
 *
 * The width is sized to the COLLAPSED pill, not the expanded card: the point
 * of the pill is that more stages fit on screen at once. Names truncate at
 * this width, so anything a card shows collapsed must also appear in full in
 * its expanded body.
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
        "flex w-[196px] shrink-0 flex-col rounded-lg border bg-secondary/40 sm:w-[212px]",
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

/**
 * Loading placeholder shaped like the rows it replaces.
 *
 * Replaces the "Loading deals…" spinner-and-sentence pattern. A skeleton that
 * matches the real row's geometry means the layout doesn't jump when data
 * lands, and the screen reads as "filling in" rather than "empty and busy" —
 * which is most of what makes an app feel fast rather than merely be fast.
 */
export function RecordListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="relative flex items-center gap-3 overflow-hidden rounded-md border bg-card px-3 py-2.5 pl-4"
        >
          <span className="absolute inset-y-0 left-0 w-[3px] bg-muted-foreground/15" />
          <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            {/* Widths vary per row so the block doesn't read as a striped
                pattern, which is what makes a skeleton look like a bug. */}
            <Skeleton className="h-3.5" style={{ width: `${38 + ((index * 13) % 34)}%` }} />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="hidden h-3.5 w-16 shrink-0 sm:block" />
          <Skeleton className="hidden h-5 w-20 shrink-0 rounded-md sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Soft tinted fill for a board card's collapsed pill, per tone. */
const TONE_TINT: Record<StatusTone, string> = {
  none: "bg-secondary text-foreground",
  neutral: "bg-secondary text-foreground",
  brand: "tint-brand text-primary",
  success: "tint-success text-success",
  warning: "tint-warning text-warning-foreground",
  info: "tint-info text-info",
  danger: "tint-danger text-destructive",
};

/**
 * A board card that reads as a coloured pill until you look at it.
 *
 * Collapsed it is one tinted row — owner, name, amount — so a column of ten
 * scans as a colour-coded list rather than ten paragraphs. Hover, keyboard
 * focus, or a tap reveals the metadata and the stage actions.
 *
 * Three things this has to get right, none of which hover-only CSS does:
 *
 *  1. TOUCH. There is no hover on a phone, so a pure `group-hover` reveal
 *     would make the actions unreachable on exactly the device where the
 *     board is hardest to use. Tapping the pill pins it open, and pinning is
 *     independent of hover so it survives the pointer leaving.
 *  2. KEYBOARD. `has-[:focus-visible]` means tabbing into the card opens it,
 *     so the action buttons are reachable without a mouse and never receive
 *     focus while invisible. It is deliberately NOT `focus-within`: a click
 *     also leaves focus on the header button, so focus-within would hold the
 *     card open after the tap that was meant to close it. `:focus-visible`
 *     fires for keyboard focus and not for a pointer click, which is exactly
 *     the distinction needed. Matching on the wrapper via `:has()` rather
 *     than the button keeps it open while focus is on the actions inside.
 *  3. LAYOUT SHIFT. The reveal animates grid-template-rows 0fr -> 1fr rather
 *     than toggling display, which gives a real height transition without
 *     hard-coding a pixel height that would clip longer content.
 */
export function BoardCard({
  tone = "neutral",
  title,
  amount,
  owner,
  details,
  actions,
  className,
}: {
  tone?: StatusTone;
  title: React.ReactNode;
  amount?: React.ReactNode;
  owner?: string | null;
  details?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const [pinned, setPinned] = React.useState(false);
  const hasMore = Boolean(details || actions);

  return (
    <div
      className={cn(
        "group relative overflow-hidden border transition-[border-radius,box-shadow,background-color] duration-150",
        pinned
          ? "rounded-xl bg-card shadow-card"
          : "rounded-full bg-card hover:rounded-xl hover:shadow-card has-[:focus-visible]:rounded-xl",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={hasMore ? pinned : undefined}
        onClick={() => hasMore && setPinned((value) => !value)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
          TONE_TINT[tone],
          hasMore && "cursor-pointer",
        )}
      >
        {owner !== undefined ? <OwnerAvatar name={owner} size="xs" /> : null}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</span>
        {amount ? (
          <span className="shrink-0 text-[13px] font-semibold" data-numeric>
            {amount}
          </span>
        ) : null}
        {hasMore ? (
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 opacity-50 transition-transform",
              pinned ? "rotate-180" : "group-hover:translate-y-0.5",
            )}
            aria-hidden="true"
          />
        ) : null}
      </button>

      {hasMore ? (
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-200 ease-out",
            pinned
              ? "grid-rows-[1fr]"
              : "grid-rows-[0fr] group-hover:grid-rows-[1fr] group-has-[:focus-visible]:grid-rows-[1fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="space-y-2 border-t px-3 py-2">
              {details}
              {actions ? (
                <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
