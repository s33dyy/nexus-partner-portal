import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      // A 16px box cannot be a 44px tap target (product.md 4.3) without
      // becoming a comically large box, so the *hit area* grows instead: a
      // transparent 44px square centred on the box, touch widths only.
      //
      // Callers that stack checkboxes closer than 44px apart must give their
      // rows min-h-11 on touch, or these areas overlap and steal each other's
      // taps — see the audience rows in components/news-audience-picker.tsx.
      // -inset-3.5 (14px each side) grows the 16px box to a 44px hit area.
      // Insets rather than a centring translate: the transform utilities do
      // not compose onto a pseudo-element here, which left the area offset
      // down-and-right instead of centred.
      "relative after:absolute after:-inset-3.5 after:content-[''] lg:after:hidden",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("grid place-content-center text-current")}>
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
