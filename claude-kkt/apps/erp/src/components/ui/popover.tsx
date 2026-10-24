import { Popover as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverAnchor = Primitive.Anchor;
export const PopoverClose = Primitive.Close;

export function PopoverContent({ className, align = "start", sideOffset = 6, ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "z-50 w-72 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-card p-3 text-ink shadow-pop outline-none animate-slide-down",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
