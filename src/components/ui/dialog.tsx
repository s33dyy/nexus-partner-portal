"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-foreground/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Phone: a bottom sheet. product.md section 4.3 asks that modals which
        // exceed the viewport become full-height sheets with sticky header and
        // footer actions, and a centred box on a 375px screen did the opposite
        // — the title scrolled away and Save sat below the fold of a long form.
        // svh, not vh: vh ignores the mobile browser chrome, so the last ~90px
        // of the sheet (which is where the actions are) sat under the URL bar.
        "fixed inset-x-0 bottom-0 z-50 grid max-h-[92svh] gap-4 overflow-y-auto rounded-t-xl border bg-card p-4 shadow-elevated",
        "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        // sm and up: the centred box it has always been. The boundary is `sm`
        // because every caller already expresses its width as `sm:max-w-*`,
        // so those overrides keep applying exactly where they used to.
        "sm:inset-x-auto sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:w-full sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%]",
        "sm:max-h-[calc(100vh-2rem)] sm:rounded-lg sm:p-6",
        "sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0",
        "sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    >
      {children}
      {/* z-20 to clear the sticky header, and a 44px touch target that shrinks
          back to the icon-sized affordance once a pointer is doing the aiming. */}
      <DialogPrimitive.Close className="absolute right-2 top-2 z-20 grid size-11 place-content-center rounded-sm opacity-70 ring-offset-background cursor-pointer transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground sm:right-4 sm:top-4 sm:size-auto">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Left-aligned: on a sheet the title starts at the same edge as the
      // fields under it, where centring it just looked like a stray alert.
      "flex flex-col space-y-1.5 text-left",
      // Sticky inside the sheet's own scroll container, so a long form keeps
      // saying what it is. The negative margins let the backdrop span the
      // sheet's padding, otherwise content scrolls visibly up the gutters.
      // -top-4, not top-0: sticky pins against the sheet's PADDING box, so
      // top-0 parked the backdrop 16px below the sheet's edge and scrolled
      // content showed through the strip above it.
      "sticky -top-4 z-10 -mx-4 -mt-4 bg-card px-4 pb-2 pt-4",
      // Reserved room for the close target, which floats over this corner.
      // It has to come AFTER px-4: cn() merges Tailwind classes, and a px-*
      // written earlier in the list silently swallows a pr-* written before it.
      "pr-14",
      "sm:static sm:mx-0 sm:mt-0 sm:bg-transparent sm:p-0",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      // The actions stay on screen rather than at the end of a long scroll.
      // -bottom-4 for the same reason the header uses -top-4.
      "sticky -bottom-4 z-10 -mx-4 -mb-4 gap-2 bg-card px-4 pb-4 pt-2",
      "sm:static sm:mx-0 sm:mb-0 sm:gap-0 sm:bg-transparent sm:p-0",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
