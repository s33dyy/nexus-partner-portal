import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Status pill.
 *
 * The four original variants (default/secondary/destructive/outline) were a
 * generic shadcn set, and status across this app was being expressed by
 * picking whichever of them looked closest — so "won" and "super_admin" and
 * "high priority" all rendered as the same solid indigo, and anything bad was
 * a loud solid red. The `tone` variants below are the semantic set: soft
 * tinted fills with a readable foreground, which is how a dense CRM signals
 * state without the page turning into a traffic light.
 *
 * Prefer `tone`. The legacy `variant` values are kept because ~30 call sites
 * still pass them and a blind sweep of those would have changed meaning it
 * couldn't verify.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium leading-5 whitespace-nowrap transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent tint-danger text-destructive",
        outline: "border-border bg-card text-foreground",
      },
      tone: {
        none: "",
        neutral: "border-transparent bg-secondary text-muted-foreground",
        brand: "border-transparent tint-brand text-primary",
        success: "border-transparent tint-success text-success",
        warning: "border-transparent tint-warning text-warning-foreground",
        info: "border-transparent tint-info text-info",
        danger: "border-transparent tint-danger text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
      tone: "none",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, tone, ...props }: BadgeProps) {
  // A caller that opts into `tone` gets ONLY the tone styling — otherwise the
  // default variant's solid indigo would layer underneath every tinted pill.
  return (
    <div
      className={cn(
        badgeVariants({ variant: tone && tone !== "none" ? undefined : variant, tone }),
        className,
      )}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
