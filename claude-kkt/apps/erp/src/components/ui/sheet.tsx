import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useDirtyClose } from "./dirty-close";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export type SheetSize = "sm" | "md" | "lg" | "xl" | "full";

const SIZES: Readonly<Record<SheetSize, string>> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  full: "sm:max-w-full",
};

export interface SheetContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  size?: SheetSize;
  side?: "right" | "left";
  hideClose?: boolean;
  /** The hosted form's dirty flag (e.g. react-hook-form `formState.isDirty`); omitted = any edit inside counts as dirty. */
  dirty?: boolean;
  /** false = never ask before closing (read-only drawers). */
  guardUnsaved?: boolean;
}

/** Right-side drawer: full height, flex column (header / scrollable body / sticky footer). */
export function SheetContent({
  className,
  children,
  size = "md",
  side = "right",
  hideClose = false,
  dirty,
  guardUnsaved = true,
  onEscapeKeyDown,
  onInteractOutside,
  onInputCapture,
  onChangeCapture,
  ...props
}: SheetContentProps) {
  // A sheet hosting a form asks before Esc / outside click / the close button throw its edits away (audit v3 H3).
  const guard = useDirtyClose({ dirty, guard: guardUnsaved });
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-navy-950/55 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex h-dvh w-full flex-col border-border bg-card shadow-pop outline-none",
          side === "right"
            ? "right-0 border-l data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right"
            : "left-0 border-r data-[state=open]:animate-slide-in-left data-[state=closed]:animate-slide-out-left",
          SIZES[size],
          className,
        )}
        {...props}
        onEscapeKeyDown={(event) => {
          onEscapeKeyDown?.(event);
          guard.intercept(event);
        }}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          guard.intercept(event);
        }}
        onInputCapture={(event) => {
          onInputCapture?.(event);
          guard.trackEdit(event);
        }}
        onChangeCapture={(event) => {
          onChangeCapture?.(event);
          guard.trackEdit(event);
        }}
        data-dirty={guard.dirty ? "true" : undefined}
      >
        {children}
        {guard.elements}
        {!hideClose && (
          <DialogPrimitive.Close
            className="absolute right-3 top-3.5 rounded-sm p-1 text-ink-subtle transition-colors hover:bg-navy-50 hover:text-navy-950 focus-ring"
            aria-label="Close"
            onClick={guard.intercept}
          >
            <X className="size-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex shrink-0 flex-col gap-0.5 border-b border-border px-5 py-3.5 pr-12", className)}
      {...props}
    />
  );
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("font-display text-lg font-bold text-navy-950", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-xs text-ink-subtle", className)} {...props} />;
}

export function SheetBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin", className)} {...props} />;
}

/** Sticky footer (always visible at the bottom of the drawer). */
export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-card px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: SheetSize;
}

/** One-call drawer with header, scrollable body and sticky footer. */
export function Drawer({ open, onOpenChange, title, description, children, footer, size }: DrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size={size}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? (
            <SheetDescription>{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">{title}</SheetDescription>
          )}
        </SheetHeader>
        <SheetBody>{children}</SheetBody>
        {footer && <SheetFooter>{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}
