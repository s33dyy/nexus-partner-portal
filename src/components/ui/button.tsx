import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-card hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-card hover:bg-destructive/90",
        // Secondary actions sit on white cards, so the outline button's own
        // fill must be the card colour, not the (now grey) page background —
        // otherwise every toolbar button reads as a hole punched in the card.
        outline: "border border-input bg-card shadow-card hover:bg-secondary hover:text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "hover:bg-secondary hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // Mobile-first: below lg every button clears the 44x44 CSS-pixel tap
      // target product.md section 4.3 requires, then drops back to the denser
      // desktop sizes at lg — the same boundary where the sidebar stops being
      // a drawer (hooks/use-mobile.tsx). Touch density and pointer density are
      // different problems; this is the one place to solve both at once.
      //
      // `sm` is 44 tall on touch just like `default`: a smaller *label* is a
      // legitimate hierarchy choice, a smaller *target* is not.
      size: {
        default: "h-11 px-4 py-2 lg:h-9 lg:px-3.5",
        sm: "h-11 rounded-md px-3.5 text-xs lg:h-8 lg:px-3",
        lg: "h-11 rounded-md px-6 lg:h-10",
        icon: "size-11 lg:size-9",
        "icon-sm": "size-11 lg:size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
