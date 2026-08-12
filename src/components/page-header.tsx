import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The masthead every workspace route opens with.
 *
 * Sizing note: the title is 22px, not the 30px (`text-3xl`) it used to be.
 * A 30px heading is a marketing-page size; on a CRM screen whose actual
 * subject is a 40-row table it pushed the first row of real data below the
 * fold and made every page feel like a landing page rather than a tool.
 */
export function PageHeader({
  eyebrow,
  icon,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-3", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {icon}
            {eyebrow}
          </div>
        ) : null}
        <h1 className="mt-1 text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * The "there's nothing here" state for a list or table.
 *
 * An empty state that names the reason AND offers the action that fixes it
 * is the difference between a screen that looks broken and one that looks
 * ready.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-12 text-center", className)}>
      {icon ? (
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-[13px] text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/**
 * Compact KPI tile.
 *
 * Replaces the assorted bespoke "MetricCard"/"Metric" components that each
 * route grew its own copy of. Label above value (so a row of tiles scans as
 * a table of labels), value at 24px tabular, optional delta and icon.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "neutral",
  onClick,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
  onClick?: () => void;
  className?: string;
}) {
  const interactive = typeof onClick === "function";
  const Comp = interactive ? "button" : "div";

  return (
    <Comp
      type={interactive ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "group flex items-start justify-between gap-3 rounded-lg border bg-card p-4 text-left shadow-card",
        interactive &&
          "cursor-pointer transition-colors hover:border-ring/40 hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div
          className="mt-1.5 truncate text-xl font-semibold leading-tight tracking-tight sm:text-2xl"
          title={typeof value === "string" || typeof value === "number" ? String(value) : undefined}
          data-numeric
        >
          {value}
        </div>
        {hint ? <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      {icon ? (
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            tone === "neutral" && "bg-secondary text-muted-foreground",
            tone === "brand" && "tint-brand text-primary",
            tone === "success" && "tint-success text-success",
            tone === "warning" && "tint-warning text-warning-foreground",
            tone === "danger" && "tint-danger text-destructive",
          )}
        >
          {icon}
        </span>
      ) : null}
    </Comp>
  );
}

/**
 * The filter/search strip that sits above a table. Its own row inside the
 * card header rather than crammed alongside the title, which is what caused
 * the wrapping in the deals and support toolbars.
 */
export function Toolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

/** Standard vertical rhythm for a route's top-level sections. */
export function PageSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={cn("space-y-3", className)}>{children}</section>;
}
