import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // bg-card, not bg-transparent: inputs now sit on both white cards
          // and the grey canvas, and a transparent field on grey looks
          // disabled. Focus is a 2px brand ring with the border going brand
          // too — a 1px ring was almost invisible against the new border.
          "flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-base shadow-card transition-[color,box-shadow,border-color] file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
